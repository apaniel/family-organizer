"""Run real wrapper/clients/sender against canonical mocks and the approved HTTP route."""
import copy
import http.client
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from test_notes import TASK, RULE, ROOT

# Inject only at the external boundaries of the actual /opt broker clients.
SITE = r'''
import http.client,json,os,socket
from pathlib import Path
fixture=json.loads(Path(os.environ['NOTES_FIXTURE']).read_text())
def log(value):
 with open(os.environ['NOTES_CALLS'],'a') as f:f.write(json.dumps(value)+'\n')
port=int(os.environ['NOTES_TEST_PORT'])
connect=socket.socket.connect
def guarded(self,address):
 if address != ('127.0.0.1',port):raise AssertionError('Real network forbidden')
 return connect(self,address)
socket.socket.connect=guarded
request=http.client.HTTPConnection.request
class Response:
 status=200
 def __init__(self,body):self.body=body
 def read(self,*args):return json.dumps(self.body).encode()
def mock(self,method,url,body=None,headers={},**kwargs):
 if url=='/v1':
  p=json.loads(body);action=p['action'];log({'action':action,'payload':p})
  if action=='list':
   assert p=={'owner':'Dani','includeDone':False,'action':'list'}
   result={'tasks':fixture['tasks']}
  elif action=='get':
   assert p=={'id':fixture['tasks'][0]['id'],'action':'get'}
   result={'task':fixture['tasks'][0]}
  elif action=='update':
   assert set(p)=={'action','id','task'} and set(p['task'])=={'notes'}
   assert p['id']==fixture['tasks'][0]['id']
   fixture['tasks'][0].update(p['task'])
   Path(os.environ['NOTES_FIXTURE']).write_text(json.dumps(fixture))
   result={'task':fixture['tasks'][0]}
  elif action=='location_latest':
   assert p['person']=='dan'
   result=fixture['fix']
  elif action=='location':
   assert p['person']=='dan' and p['order']=='asc' and p['limit']=='200' and p['tz']=='Europe/Madrid'
   from datetime import datetime
   start=datetime.fromisoformat(p['from']).timestamp();end=datetime.fromisoformat(p['to']).timestamp()
   rows=fixture.get('locations',[fixture['fix']['location']])
   rows=[r for r in rows if start<=r['ts']<=end]
   result={'ok':True,'person':'dan','tz':'Europe/Madrid','count':len(rows),'locations':rows}
  else:raise AssertionError('No real write supported in checker test')
  self._mock=Response(result);return
 assert self.host=='127.0.0.1' and self.port==3000
 assert method=='POST' and url=='/family/private-notice'
 self.port=port
 return request(self,method,url,body,headers,**kwargs)
getresponse=http.client.HTTPConnection.getresponse
http.client.HTTPConnection.request=mock
http.client.HTTPConnection.getresponse=lambda self,*a,**k: self._mock if hasattr(self,'_mock') else getresponse(self,*a,**k)
'''


class CliTests(unittest.TestCase):
    def test_author_cli_protected_update_then_readback(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary)
            (directory/'sitecustomize.py').write_text(SITE)
            fixture=directory/'fixture.json'; fixture.write_text(json.dumps({'tasks':[TASK]}))
            calls=directory/'calls.jsonl'
            env={**os.environ,'PYTHONPATH':str(directory),'NOTES_FIXTURE':str(fixture),'NOTES_CALLS':str(calls),'NOTES_TEST_PORT':'0'}
            # On CI, point only the broker CLI constant at the exact installed-source snapshot.
            bootstrap="import sys;sys.path.insert(0,sys.argv[1]);import notes_runner;notes_runner.TASKS=sys.argv[2];import runpy;sys.argv=[sys.argv[3]]+sys.argv[4:];runpy.run_path(sys.argv[0],run_name='__main__')"
            client=Path('/opt/hermes-tasks/client.py')
            if not client.is_file(): client=ROOT/'test-fixtures/tasks_client.approved.py'
            command=[sys.executable,'-c',bootstrap,str(ROOT),str(client),str(ROOT/'author_notes.py'),
              '--id',TASK['id'],'--list-id',TASK['listId'],'--source-key',TASK['sourceKey'],
              '--name',RULE['name'],'--address',RULE['address'],'--maps-url',RULE['mapsUrl'],
              '--latitude',str(RULE['latitude']),'--longitude',str(RULE['longitude']),
              '--radius','150','--revision','2','--nearby','false']
            result=subprocess.run(command,env=env,capture_output=True,text=True,timeout=10)
            self.assertEqual(result.returncode,0,result.stderr)
            actions=[json.loads(line)['action'] for line in calls.read_text().splitlines()]
            self.assertEqual(actions,['get','update','get'])
            current=json.loads(fixture.read_text())['tasks'][0]
            self.assertEqual(current['sourceKey'],TASK['sourceKey'])
            self.assertTrue(current['notes'].startswith('Original notes retained'))

    def test_actual_cli_outside_inside_uncertain_receipt_restart_empty_disabled(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary); directory.chmod(0o700)
            site = directory/'site'; site.mkdir(); (site/'sitecustomize.py').write_text(SITE)
            fixture = directory/'fixture.json'; calls = directory/'calls.jsonl'
            config = directory/'config.json'; state = directory/'state.json'
            clients = {key: str(Path(installed) if Path(installed).is_file() else ROOT/'test-fixtures'/snapshot)
                       for key, installed, snapshot in [('tasks_client','/opt/hermes-tasks/client.py','tasks_client.approved.py'),
                                                        ('location_client','/opt/hermes-health/client.py','location_client.approved.py')]}
            config.write_text(json.dumps({**clients, 'enabled':False,'interval_seconds':300,'state':str(state),'sender':str(ROOT/'private_sender.py')}))
            def cli(extra=(), env=None):
                return subprocess.run([sys.executable,str(ROOT/'notes_runner.py'),'--config',str(config),*extra],
                                      capture_output=True,text=True,env=env,timeout=30)
            self.assertEqual(cli(['--initialize-state']).returncode,0)
            self.assertEqual(cli().returncode,0)
            self.assertFalse(calls.exists())
            server = subprocess.Popen(['node',str(ROOT/'test-fixtures/private_route.mjs')],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            try:
                port=json.loads(server.stdout.readline())['port']
                env={**os.environ,'PYTHONPATH':str(site),'NOTES_FIXTURE':str(fixture),'NOTES_CALLS':str(calls),'NOTES_TEST_PORT':str(port)}
                config.write_text(json.dumps({**clients, 'enabled':True,'interval_seconds':300,'state':str(state),'sender':str(ROOT/'private_sender.py')}))
                import time
                current_task = dict(TASK)
                at=time.time()-1
                def write(outside=False,tasks=None):
                    nonlocal at
                    at=max(at+.1,time.time()-.01)
                    fixture.write_text(json.dumps({'tasks':[current_task] if tasks is None else tasks,
                      'fix':{'ok':True,'person':'dan','location':{'lat':RULE['latitude']+(.004 if outside else 0),
                         'lon':RULE['longitude'],'h_acc':10,'ts':at,'received_at':at}}}))
                write(True)
                self.assertEqual(cli(env=env).returncode, 0)  # Arm before movement evidence.
                write(True)
                entry = directory/'entry.sh'
                entry.write_text((ROOT/'notes-cron-entry.sh').read_text().replace(
                    '/home/hermes/.hermes/hermes-agent/venv/bin/python', sys.executable).replace(
                    '/home/hermes/.hermes/local-customizations/location-runtime/current/ops/location/notes_runner.py', str(ROOT/'notes_runner.py')))
                entry.chmod(0o700)
                baseline=subprocess.run([str(entry)],env={**env,'LOCATION_NOTES_CONFIG':str(config)},capture_output=True,text=True,timeout=30)
                self.assertEqual(baseline.stdout,'')
                self.assertEqual(baseline.returncode,0,baseline.stderr)
                write()
                arrival=cli(env=env)
                self.assertEqual(arrival.returncode,1,arrival.stderr)
                self.assertIn("no success confirmed", arrival.stderr)
                self.assertEqual(next(iter(json.loads(state.read_text())['items'].values()))['delivery'],'unknown')
                connection=http.client.HTTPConnection('127.0.0.1',port,timeout=3)
                connection.request('GET','/__test/count'); self.assertEqual(json.loads(connection.getresponse().read())['sends'],1)
                connection.request('GET','/__test/count')
                original_requests=json.loads(connection.getresponse().read())['requests']
                current_task['title']='Edited title after reservation'
                connection.request('POST','/__test/receipts'); connection.getresponse().read()
                write()
                receipt=cli(env=env); self.assertEqual(receipt.returncode,0,receipt.stderr)
                self.assertEqual(next(iter(json.loads(state.read_text())['items'].values()))['delivery'],'sent')
                connection.request('GET','/__test/count')
                observed=json.loads(connection.getresponse().read())
                self.assertEqual(observed['sends'],1)
                self.assertTrue(observed['requests'])
                for request in observed['requests']:
                    self.assertEqual(request,original_requests[0])
                self.assertIn(TASK['title'], json.loads(original_requests[0]['text'])['message'])
                connection.close()
                calls.write_text(''); write(tasks=[])
                self.assertEqual(cli(env=env).returncode,0)
                actions=[json.loads(line)['action'] for line in calls.read_text().splitlines()]
                self.assertEqual(actions,['list'])
            finally:
                server.terminate(); server.communicate(timeout=5)


if __name__=='__main__':unittest.main()
