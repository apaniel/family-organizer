import tempfile, unittest, sqlite3
from pathlib import Path
from runner import Engine, cycle, PRIVATE_DESTINATION
NOW=1791187200
P={'id':'p','revision':1,'name':'Tienda','person':'Dani','latitude':0,'longitude':0,'radius':100,'timezone':'Europe/Madrid'}
R={'id':'r','revision':1,'placeId':'p','person':'Dani','target':{'kind':'task','id':'t','listId':'l'},'mode':'arrival','recurring':False,'expires':'2026-10-05','enabled':True,'confirmedAt':'2026-10-05T00:00:00Z'}
def fix(distance,t=NOW,**kw):return {'person':'Dani','latitude':distance/111195,'longitude':0,'accuracy':5,'recorded_at':t,'received_at':t,'timezone':'Europe/Madrid','version':1,**kw}
class Tests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name)/'state.db';self.e=Engine(self.path)
 def tearDown(self):self.e.close();self.tmp.cleanup()
 def step(self,f,r=R,now=None):return self.e.evaluate([P],[r],{'Dani':f},NOW if now is None else now,{'["task","l","t"]':'open'})
 def test_transition_hysteresis_restart_one_shot(self):
  self.assertEqual(self.step(fix(300)),[])
  self.assertEqual(self.step(fix(105,NOW+1),now=NOW+1),[])
  self.assertEqual(len(self.step(fix(20,NOW+2),now=NOW+2)),1)
  self.e.close();self.e=Engine(self.path)
  self.assertEqual(self.step(fix(300,NOW+3),now=NOW+3),[])
  self.assertEqual(self.step(fix(20,NOW+4),now=NOW+4),[])
 def test_first_inside_no_arrival_nearby_yes(self):
  self.assertEqual(self.step(fix(20)),[])
  self.assertEqual(len(self.step(fix(20,NOW+1),{**R,'id':'n','mode':'nearby'},NOW+1)),1)
 def test_recurring_only_new_episode(self):
  r={**R,'recurring':True};self.step(fix(300),r)
  self.assertEqual(len(self.step(fix(20,NOW+1),r,NOW+1)),1)
  self.assertEqual(self.step(fix(110,NOW+2),r,NOW+2),[])
  self.assertEqual(self.step(fix(300,NOW+3),r,NOW+3),[])
  self.assertEqual(len(self.step(fix(20,NOW+4),r,NOW+4)),1)
 def test_missing_stale_out_of_order_accuracy_owner_version(self):
  for f in [None,fix(20,NOW-1000),fix(20,accuracy=500),fix(20,person='Cris'),fix(20,version=2),fix(20,received_at=NOW-1),fix(20,timezone='bad'),fix(20,latitude=float('nan'))]:self.assertEqual(self.step(f),[])
  self.step(fix(300));self.assertEqual(self.step(fix(20,NOW-1)),[])
 def test_expiry_timezone_consent_done(self):
  for r in [{**R,'expires':'2026-10-04'},{**R,'enabled':False},{**R,'confirmedAt':None}]:self.assertEqual(self.step(fix(20),{**r,'mode':'nearby'}),[])
  # 22:30 UTC is already tomorrow in Madrid.
  from datetime import datetime
  late=datetime.fromisoformat('2026-10-05T22:30:00+00:00').timestamp()
  self.assertEqual(self.step(fix(20,late),{**R,'mode':'nearby'},late),[])
  self.assertEqual(self.e.evaluate([P],[{**R,'mode':'nearby'}],{'Dani':fix(20)},NOW,{'["task","l","t"]':'done'}),[])
 def test_durable_concurrency_and_no_completion(self):
  other=Engine(self.path)
  self.assertEqual(len(self.step(fix(20),{**R,'mode':'nearby'})),1)
  self.assertEqual(other.evaluate([P],[{**R,'mode':'nearby'}],{'Dani':fix(20)},NOW,{'["task","l","t"]':'open'}),[]);other.close()
 def test_offline_cycle_conditional_sender_bounded_retry(self):
  calls=[];meta={'places':[P],'links':[{**R,'mode':'nearby'}]};fetch=lambda:meta
  broker=lambda person,tz:fix(20)
  sender=lambda dest,msg,key:calls.append((dest,msg,key))
  status=lambda:{'["task","l","t"]':'open'}
  cycle(self.e,fetch,broker,status,sender,NOW,deliver=False)
  self.assertEqual(calls,[])
  # Preview doesn't consume transitions/episodes.
  cycle(self.e,fetch,broker,status,sender,NOW,deliver=True)
  self.assertEqual(len(calls),1);self.assertEqual(calls[0][0],PRIVATE_DESTINATION)
  cycle(self.e,fetch,broker,status,sender,NOW+1,deliver=True);self.assertEqual(len(calls),1)
  self.assertNotIn('latitude',calls[0][1])
  self.assertEqual(status(),{'["task","l","t"]':'open'})
 def test_empty_does_not_call_broker_status_sender(self):
  def forbidden(*args):raise AssertionError('idle work')
  cycle(self.e,lambda:{'places':[],'links':[]},forbidden,forbidden,forbidden,NOW)
 def test_retry_budget_cancellation_and_missing_location(self):
  self.step(fix(20),{**R,'mode':'nearby'})
  calls=[]
  def fail(*args):calls.append(args);raise OSError('temporary')
  for offset in [0,1,60,61,180,240]:self.e.deliver([R],[P],{'["task","l","t"]':'open'},fail,NOW+offset)
  self.assertEqual(len(calls),3)
  self.assertEqual(self.e.db.execute('SELECT attempts,status FROM deliveries').fetchone(),(3,'failed'))
  def forbidden(*args):raise AssertionError('missing location work')
  self.assertEqual(cycle(self.e,lambda:{'places':[P],'links':[R]},lambda *a:None,forbidden,forbidden,NOW)['available'],[])
 def test_parallel_engines_claim_once(self):
  from concurrent.futures import ThreadPoolExecutor
  def worker(_):
   e=Engine(self.path)
   try:return e.evaluate([P],[{**R,'mode':'nearby'}],{'Dani':fix(20)},NOW,{'["task","l","t"]':'open'})
   finally:e.close()
  with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(worker,[1,2]))
  self.assertEqual(sum(len(r) for r in results),1)
 def test_stale_outside_and_changed_place_cannot_fabricate_arrival(self):
  self.step(fix(300))
  self.assertEqual(self.step(fix(20,NOW+400),now=NOW+400),[])
  self.e.db.execute('DELETE FROM transitions');self.step(fix(300,NOW+401),now=NOW+401)
  self.assertEqual(self.e.evaluate([{**P,'revision':2}],[R],{'Dani':fix(20,NOW+402)},NOW+402,{'["task","l","t"]':'open'}),[])
 def test_scheduler_disabled_and_interval(self):
  from scheduled_cycle import run
  from types import SimpleNamespace
  calls=[]
  def invoke(*a,**k):calls.append(a);return SimpleNamespace(stdout='{"candidates":0}')
  self.assertEqual(run({'enabled':False},invoke,NOW),{'skipped':'disabled'})
  config={'enabled':True,'deliver':False,'interval_seconds':300,'state':str(self.path)}
  self.assertEqual(run(config,invoke,NOW),{'candidates':0})
  self.assertEqual(run(config,invoke,NOW+299),{'skipped':'interval'})
  self.assertEqual(run(config,invoke,NOW+300),{'candidates':0});self.assertEqual(len(calls),2)
  with self.assertRaises(ValueError):run({**config,'deliver':True},invoke,NOW+600)
 def test_broker_adapter_real_schema_and_ownership(self):
  from runner import broker_latest
  from unittest.mock import patch
  from types import SimpleNamespace
  payload={'ok':True,'person':'dan','location':{'lat':0,'lon':0,'h_acc':5,'ts':'2026-10-05T08:00:00Z','received_at':'2026-10-05T08:00:00Z'}}
  import json
  with patch('runner.run_process',return_value=SimpleNamespace(stdout=json.dumps(payload))) as call:
   value=broker_latest('Dani','Europe/Madrid');self.assertEqual(value['person'],'Dani');self.assertEqual(value['version'],1)
   self.assertEqual(call.call_args.args[0],[__import__('sys').executable,'/opt/hermes-health/client.py','where','dan','--tz','Europe/Madrid'])
  with patch('runner.run_process',return_value=SimpleNamespace(stdout=json.dumps({**payload,'person':'wife'}))):self.assertIsNone(broker_latest('Dani','Europe/Madrid'))
  with patch('runner.run_process',return_value=SimpleNamespace(stdout='{"ok":true,"person":"wife","location":null}')):self.assertIsNone(broker_latest('Cris','Europe/Madrid'))
 def test_scheduler_cycle_end_to_end_offline_private_states(self):
  from scheduled_cycle import run
  from types import SimpleNamespace
  import json
  sent=[];published=[]
  def invoke(*args,**kwargs):
   result=cycle(self.e,lambda:{'places':[P],'links':[{**R,'mode':'nearby'}]},lambda *a:fix(20),lambda:{'["task","l","t"]':{'status':'open','title':'Comprar pan'}},lambda *a:sent.append(a),NOW,True,published.append)
   return SimpleNamespace(stdout=json.dumps(result))
  config={'enabled':True,'deliver':True,'sender':'/reviewed/mock-sender','interval_seconds':300,'state':str(self.path)}
  self.assertEqual(run(config,invoke,NOW)['candidates'],1)
  self.assertEqual(sent[0][0],PRIVATE_DESTINATION);self.assertIn('Comprar pan',sent[0][1])
  self.assertEqual(published[0]['items'][0]['state'],'nearby')
  self.assertEqual(set(published[0]['items'][0]),{'ruleId','person','ruleRevision','placeRevision','state','observedAt','validUntil','version'})
  self.assertEqual(run(config,invoke,NOW+1),{'skipped':'interval'})
 def test_no_fresh_fix_publishes_unavailable_without_status_or_sender(self):
  published=[]
  def forbidden(*a):raise AssertionError('unexpected work')
  cycle(self.e,lambda:{'places':[P],'links':[R]},lambda *a:None,forbidden,forbidden,NOW,True,published.append)
  self.assertEqual(published[0]['items'][0]['state'],'unavailable')
 def test_recurring_edits_and_stale_gap_do_not_replay_inside_episode(self):
  r={**R,'mode':'nearby','recurring':True}
  self.assertEqual(len(self.step(fix(20),r)),1)
  self.assertEqual(self.step(fix(20,NOW+1),{**r,'revision':2},NOW+1),[])
  self.assertEqual(self.step(fix(20,NOW+400),{**r,'revision':2},NOW+400),[])
 def test_conflicting_timezones_never_fan_out_broker(self):
  calls=[]
  def broker(*args):calls.append(args);return None
  p2={**P,'id':'p2','timezone':'UTC'}
  r2={**R,'id':'r2','placeId':'p2'}
  def forbidden(*args):raise AssertionError('idle canonical read')
  cycle(self.e,lambda:{'places':[P,p2],'links':[R,r2]},broker,forbidden,forbidden,NOW)
  self.assertEqual(calls,[])
if __name__=='__main__':unittest.main()
