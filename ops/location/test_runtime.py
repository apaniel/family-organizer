"""Exercise actual subprocess boundaries with synthetic HTTP and an absolute network guard."""
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import tarfile
import time
import unittest
from unittest.mock import patch
from private_sender import send
from test_runner import P, R

ROOT = Path(__file__).resolve().parent
RUNTIME = '/home/hermes/.hermes/hermes-agent/venv/bin/python'
GUARD = r'''
import socket, urllib.request, http.client, json, os, sys, sqlite3, io, builtins
from pathlib import Path
from urllib.parse import urlparse
# Block all network, including Unix broker socket access. Real methods below are mocked.
def denied(*a, **k): raise AssertionError('Real network/broker forbidden')
socket.socket.connect=denied
socket.socket.connect_ex=denied
socket.create_connection=denied
original_open=builtins.open
original_io_open=io.open
def safe_open(file,*a,**k):
 if str(file).endswith('/.env') or str(file).endswith('/credentials.json'):
  raise AssertionError('Real credential file forbidden')
 return original_open(file,*a,**k)
def safe_io_open(file,*a,**k):
 if str(file).endswith('/.env') or str(file).endswith('/credentials.json'):
  raise AssertionError('Real credential file forbidden')
 return original_io_open(file,*a,**k)
builtins.open=safe_open
io.open=safe_io_open
import dotenv
def values(filename):
 assert filename=='/home/hermes/.hermes/profiles/familia/.env'
 assert os.environ['HERMES_HOME']=='/home/hermes/.hermes/profiles/familia'
 return {'FAMILY_DASHBOARD_CF_CLIENT_ID':'test','FAMILY_DASHBOARD_CF_CLIENT_SECRET':'test','FAMILY_DASHBOARD_SYNC_SECRET':'test'}
dotenv.dotenv_values=values
fixture=json.loads(Path(os.environ['LOCATION_TEST_FIXTURE']).read_text())
log=Path(os.environ['LOCATION_TEST_LOG'])
def record(value):
 with log.open('a') as f:f.write(json.dumps(value)+'\n')
class Response:
 def __init__(self,data,status=200):self.data=data;self.status=status
 def read(self,*a):return json.dumps(self.data).encode()
 def __enter__(self):return self
 def __exit__(self,*a):pass
def opener_open(self,req,*a,**k):
 url=urlparse(req.full_url);assert url.netloc=='apalas.apaniel.dev'
 route=url.path.removeprefix('/api/family/');record({'api':route,'method':req.method,'scope':os.environ['HERMES_HOME']})
 if route=='locations':return Response(fixture['metadata'])
 if route=='records':return Response(fixture['records'])
 if route=='location-attention':
  assert req.method=='POST';p=json.loads(req.data);assert set(p)=={'items'}
  assert all(not (set(i)&{'latitude','longitude','location','health'}) for i in p['items'])
  return Response({'ok':True})
 raise AssertionError('Unexpected canonical API route')
urllib.request.OpenerDirector.open=opener_open
def request(self,method,url,body=None,headers=None,**k):
 if sys.argv[0]=='/opt/hermes-health/client.py':
  p=json.loads(body);assert method=='POST' and url=='/v1'
  assert p['action']=='location_latest' and p['person'] in ('dan','wife')
  record({'broker':p['person'],'action':p['action']})
  self.test_response=Response(fixture['broker'][p['person']]);return
 assert self.host=='127.0.0.1' and self.port==3000
 assert method=='POST' and url=='/family/private-notice'
 p=json.loads(body);assert set(p)=={'destination','message','idempotency_key'}
 assert p['destination']=='238615548420255@lid';record({'sender':p['idempotency_key']})
 self.test_response=Response({'state':fixture.get('transport','acknowledged'),'messageId':'test-receipt'},200 if fixture.get('transport','acknowledged')=='acknowledged' else 202)
http.client.HTTPConnection.request=request
http.client.HTTPConnection.getresponse=lambda self:self.test_response
'''


def extract_release(test, source, destination):
    archive = source.with_name(source.name + '.tar')
    archive.chmod(0o644)
    destination.mkdir(mode=0o700)
    expected = {'ops', 'ops/location', 'ops/familia', 'config.json', 'ops/familia/family_mission.py', 'notes-config.json'}
    expected.update('ops/location/'+name for name in ('runner.py','state_crypto.py','requirements.txt','scheduled_cycle.py','private_sender.py','api_child.py','fixture_child.py','config.json','cron-entry.sh','cron-job.json','README.md','ACTIVATION.md','google_notes.py','notes_state.py','notes_runner.py','author_notes.py','notes-config.json','notes-cron-entry.sh','notes-cron-job.json','RELEASE-NOTES.md','presence_runner.py','presence_state.py','presence-config.example.json','presence-cron-entry.sh','PRESENCE-IMPLEMENTATION.md'))
    test.assertEqual({str(p.relative_to(source)) for p in source.rglob('*')}, expected)
    with tarfile.open(archive) as tar:
        test.assertEqual({m.name for m in tar.getmembers()}, expected)
        for member in tar.getmembers():
            test.assertFalse(Path(member.name).is_absolute())
            test.assertNotIn('..', Path(member.name).parts)
            test.assertTrue(member.isfile() or member.isdir())
            test.assertFalse(member.name.endswith(('.key','.sqlite','-wal','-shm','.lock')))
            mode = 0o700 if member.isdir() or member.name.endswith(('/cron-entry.sh', '/notes-cron-entry.sh', '/presence-cron-entry.sh')) else 0o600 if member.name in ('config.json', 'notes-config.json') else 0o644
            test.assertEqual(member.mode, mode)
            test.assertEqual((member.uid, member.gid, member.mtime), (0, 0, 0))
        tar.extractall(destination, filter='data')
        # The data filter does not restore directory modes on every Python version
        # (3.12 leaves them at the umask default), so the installer sets them itself.
        for member in tar.getmembers():
            if member.isdir():
                (destination/member.name).chmod(member.mode)
    for name in expected:
        test.assertEqual((destination/name).stat().st_mode & 0o777, (source/name).stat().st_mode & 0o777)
    return destination


class RuntimeTests(unittest.TestCase):
    @unittest.skipUnless(Path(RUNTIME).is_file() and Path('/opt/hermes-health/client.py').is_file(), 'Installed host runtime required; portable unit tests still run in CI')
    def test_actual_default_wrapper_helper_canonical_broker_and_sender_offline(self):
        with tempfile.TemporaryDirectory() as directory:
            d=Path(directory)
            (d/'sitecustomize.py').write_text(GUARD)
            # Model a download that normalizes only the uploaded tar to 0644.
            import importlib.util
            spec=importlib.util.spec_from_file_location('prepare_release',ROOT/'prepare-release.py')
            release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
            source=release.prepare(d/'source')
            staged=extract_release(self, source, d/'download')
            runtime_root=staged/'ops/location'
            now=time.time()
            rule={**R,'mode':'nearby','expires':'2099-01-01'}
            fixture={'metadata':{'places':[P,{**P,'id':'wife','person':'Cris'}],
                'links':[rule,{**rule,'id':'unconfirmed','person':'Cris','placeId':'wife','confirmedAt':None}]},
                'records':{'records':[{'kind':'task','id':'t','googleTaskListId':'l','status':'open','title':'Offline test'}],
                           'taskRefreshedAt':now,'taskAvailable':True},
                'broker':{'dan':{'ok':True,'person':'dan','location':{'lat':0,'lon':0,'h_acc':5,'ts':now,'received_at':now}},
                          'wife':{'ok':False}}}
            (d/'fixture.json').write_text(json.dumps(fixture))
            config={'enabled':True,'deliver':True,'interval_seconds':300,'state':str(d/'state.sqlite'),
                    'sender':str(runtime_root/'private_sender.py')}
            (d/'config.json').write_text(json.dumps(config))
            env={**os.environ,'HERMES_HOME':'/home/hermes/.hermes','PYTHONPATH':str(d),
                 'LOCATION_TEST_FIXTURE':str(d/'fixture.json'),'LOCATION_TEST_LOG':str(d/'log')}
            entry=runtime_root/'cron-entry.sh'
            self.assertEqual(entry.stat().st_mode & 0o777,0o700)
            # Substitute only installed paths in this temporary extracted source.
            entry.write_text(entry.read_text().replace('/home/hermes/.hermes/local-customizations/location-runtime/current',str(staged)).replace('/home/hermes/.hermes/state/location/config.json',str(d/'config.json')))
            cmd=[str(entry)]
            result=subprocess.run(cmd,env=env,capture_output=True,text=True,timeout=15)
            self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(result.stdout,'')
            lines=[json.loads(line) for line in (d/'log').read_text().splitlines()]
            self.assertEqual([v['broker'] for v in lines if 'broker'in v],['dan'])
            self.assertEqual([v['sender'] for v in lines if 'sender'in v],['r:once'])
            self.assertEqual([v['api'] for v in lines if 'api'in v],['locations','records','location-attention'])
            db=sqlite3.connect(d/'state.sqlite')
            self.assertEqual(db.execute('SELECT status FROM deliveries').fetchone(),('sent',))
            db.close()
            result=subprocess.run(cmd,env=env,capture_output=True,text=True,timeout=10)
            self.assertEqual(result.stdout,'');self.assertEqual(result.returncode,0)
            self.assertEqual(lines,[json.loads(line) for line in (d/'log').read_text().splitlines()])
            # Empty/unconfirmed cycles inspect only fresh consent, never broker/canonical/sender.
            db=sqlite3.connect(d/'state.sqlite');db.execute('DELETE FROM cache');db.commit();db.close()
            fixture['metadata']['links'][0]['confirmedAt']=None
            (d/'fixture.json').write_text(json.dumps(fixture))
            result=subprocess.run(cmd,env=env,capture_output=True,text=True,timeout=10)
            self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(result.stdout,'')
            updated=[json.loads(line) for line in (d/'log').read_text().splitlines()]
            self.assertEqual(updated[len(lines):],[{'api':'locations','method':'GET','scope':'/home/hermes/.hermes/profiles/familia'}])

    def test_sender_reconciliation_timeout_and_exact_payload(self):
        class Response:
            status=202
            def read(self,*args):return b'{"state":"uncertain","messageId":"stable"}'
        class Connection:
            def request(self,*args):pass
            def getresponse(self):return Response()
            def close(self):pass
        tick=[0]
        def sleep(value):tick[0]+=value
        body={'destination':'238615548420255@lid','message':'test','idempotency_key':'key'}
        with self.assertRaises(TimeoutError):send(body,Connection,lambda:tick[0],sleep)
        for extra in [{'destination':'group@g.us'},{'thread_id':'other'},{'message':''}]:
            with self.assertRaises(ValueError):send({**body,**extra},lambda:self.fail('Network attempted'))
        Response.status=200
        Response.read=lambda *args:b'{"state":"acknowledged","messageId":"stable"}'
        send(body,Connection)

    @unittest.skipUnless(Path(RUNTIME).is_file(), 'Installed Hermes required for canonical cron dispatch check')
    def test_actual_hermes_cron_no_agent_empty_dispatch(self):
        with tempfile.TemporaryDirectory() as directory:
            code = '''
import sys, socket
from pathlib import Path
sys.path.insert(0, '/home/hermes/.hermes/hermes-agent')
def denied(*a,**k):raise AssertionError('Live network forbidden')
socket.socket.connect=denied
from cron.jobs import create_job
import cron.scheduler as scheduler
import hermes_cli.env_loader as loader
scripts=Path(__import__('os').environ['HERMES_HOME'])/'scripts'
scripts.mkdir();(scripts/'test.sh').write_text('#!/bin/bash\\nexit 0\\n')
job=create_job(prompt=None,schedule='*/5 * * * *',name='offline',script='test.sh',no_agent=True,deliver='local',failure_deliver='local')
assert job['no_agent'] and job['deliver']=='local'
loader.load_hermes_dotenv=lambda **k:None
scheduler._run_job_script_with_claim_heartbeat=lambda *a,**k:(True,'')
scheduler._resolve_job_workdir=lambda *a:None
before=set(sys.modules)
result,prompt=scheduler._prepare_job_prompt(job,job['id'],'offline',None,None)
assert result[0] is True and prompt is None
assert result[2]==scheduler.SILENT_MARKER
assert 'run_agent' not in set(sys.modules)-before
print('no-agent silent dispatch verified')
'''
            result=subprocess.run([RUNTIME,'-c',code],env={**os.environ,'HERMES_HOME':directory},capture_output=True,text=True,timeout=15)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertIn('no-agent silent dispatch verified',result.stdout)

    def test_tar_is_deterministic_with_explicit_modes(self):
        spec=importlib.util.spec_from_file_location('prepare',ROOT/'prepare-release.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            d=Path(directory)
            a=module.prepare(d/'a'); b=module.prepare(d/'b')
            self.assertEqual((d/'a.tar').read_bytes(),(d/'b.tar').read_bytes())
            extract_release(self,a,d/'download')

    def test_release_is_disabled_and_cron_is_no_agent_local(self):
        job=json.loads((ROOT/'cron-job.json').read_text())
        self.assertEqual(job['schedule'],'*/5 * * * *');self.assertTrue(job['no_agent'])
        self.assertEqual(job['deliver'],'local');self.assertEqual(job['failure_deliver'],'local')
        spec=importlib.util.spec_from_file_location('prepare',ROOT/'prepare-release.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            release=module.prepare(Path(directory)/'new')
            release=extract_release(self, release, Path(directory)/'extracted')
            config=json.loads((release/'config.json').read_text())
            self.assertFalse(config['enabled']);self.assertFalse(config['deliver'])
            self.assertNotIn('familia/state',config['state'])
            result=subprocess.run([sys.executable,str(release/'ops/location/scheduled_cycle.py'),'--config',str(release/'config.json'),'--quiet'],capture_output=True,text=True,timeout=5)
            self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(result.stdout,'')
            with self.assertRaises(FileExistsError):module.prepare(Path(directory)/'new')
