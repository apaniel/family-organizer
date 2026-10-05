import json,os,tempfile,time,unittest,signal
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from runner import Engine,cycle,target_key,Budget,run_process
from scheduled_cycle import run
from test_runner import P,R,NOW,fix
K=target_key(R['target']);S={K:'open'}
class ReviewTests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name)/'state';self.e=Engine(self.path)
 def tearDown(self):self.e.close();self.tmp.cleanup()
 def enqueue(self,n=1):
  rules=[{**R,'id':str(i),'mode':'nearby'} for i in range(n)]
  self.e.evaluate([P],rules,{'Dani':fix(20)},NOW,S);return rules
 def test_crash_late_batch_individual_commits_and_bounded_recovery(self):
  rules=self.enqueue(2);calls=[]
  def sender(*a):
   calls.append(a[2])
   if len(calls)>1:raise SystemExit()
  with self.assertRaises(SystemExit):self.e.deliver(rules,[P],S,sender,NOW)
  self.e.close();self.e=Engine(self.path)
  self.assertEqual(self.e.db.execute('SELECT attempts,status FROM deliveries ORDER BY key').fetchall(),[(1,'sent'),(1,'claimed')])
  def crash(*a):calls.append(a[2]);raise SystemExit()
  for offset in [60,180]:
   with self.assertRaises(SystemExit):self.e.deliver(rules,[P],S,crash,NOW+offset)
  self.e.deliver(rules,[P],S,crash,NOW+250)
  self.assertEqual(len(calls),4);self.assertEqual(len(set(calls[1:])),1)
  self.assertEqual(self.e.db.execute("SELECT attempts,status FROM deliveries WHERE rule='1'").fetchone(),(3,'failed'))
 def test_concurrent_expired_claim_recovery(self):
  rules=self.enqueue();self.e.db.execute("UPDATE deliveries SET attempts=1,status='claimed',claim='dead',lease_until=?,next_try=?",(NOW,NOW))
  calls=[]
  def worker(_):
   e=Engine(self.path)
   try:e.deliver(rules,[P],S,lambda *a:calls.append(a),NOW+1)
   finally:e.close()
  with ThreadPoolExecutor(2) as pool:list(pool.map(worker,[1,2]))
  self.assertEqual(len(calls),1);self.assertEqual(self.e.db.execute('SELECT attempts,status FROM deliveries').fetchone(),(2,'sent'))
 def test_edited_place_repeated_and_outoforder_interleaved(self):
  r={**R,'mode':'nearby'};out=[];other=Engine(self.path)
  try:
   cycle(self.e,lambda:{'places':[P],'links':[r]},lambda *a:fix(20),lambda:S,lambda *a:None,NOW,True,out.append)
   for t in [NOW,NOW-1,NOW+1]:
    cycle(other,lambda:{'places':[{**P,'revision':2,'latitude':1}],'links':[r]},lambda *a:fix(20,t),lambda:S,lambda *a:None,NOW+2,True,out.append)
    self.assertNotIn(out[-1]['items'][0]['state'],['nearby','arrived'])
  finally:other.close()
 def test_physical_retention_missing_empty_and_throttle(self):
  self.enqueue();self.e.db.execute("INSERT INTO cache VALUES('targets',?,?)",(NOW,json.dumps(S)))
  def forbidden(*a):raise AssertionError('extra reads')
  for offset in [300,301,1000]:cycle(self.e,lambda:{'places':[P],'links':[R]},lambda *a:None,forbidden,forbidden,NOW+offset,True)
  self.assertEqual(self.e.db.execute('SELECT count(*) FROM fixes').fetchone()[0],0)
  self.assertEqual(self.e.db.execute("SELECT count(*) FROM cache WHERE key='targets'").fetchone()[0],0)
  cycle(self.e,lambda:{'places':[],'links':[]},forbidden,forbidden,forbidden,NOW+1001,True)
  self.e.db.execute("INSERT INTO fixes VALUES('Dani',0,0,'{}')")
  cfg={'enabled':True,'state':str(self.path),'interval_seconds':300}
  run(cfg,lambda *a,**k:type('Result',(),{'stdout':'{}'})(),NOW+1002)
  self.e.db.execute("INSERT INTO fixes VALUES('Dani',0,0,'{}')")
  self.assertEqual(run(cfg,now=NOW+1003),{'skipped':'interval'})
  self.assertEqual(self.e.db.execute('SELECT count(*) FROM fixes').fetchone()[0],0)
 def test_insufficient_budget_does_not_claim_and_cancellation_persists(self):
  rules=self.enqueue();self.e.deliver(rules,[P],S,lambda *a:self.fail(),NOW,budget=Budget(time.monotonic()+1))
  self.assertEqual(self.e.db.execute('SELECT attempts,status FROM deliveries').fetchone(),(0,'pending'))
  self.e.deliver([{**rules[0],'enabled':False}],[P],S,lambda *a:self.fail(),NOW)
  self.assertEqual(self.e.db.execute('SELECT attempts,status FROM deliveries').fetchone(),(0,'cancelled'))
 def test_structured_identity(self):
  self.assertNotEqual(target_key({'kind':'task','listId':'a:b','id':'c'}),target_key({'kind':'task','listId':'a','id':'b:c'}))
 def test_actual_wrapper_runner_sender_offline(self):
  now=time.time();r={**R,'mode':'nearby','expires':'2099-01-01'};f=fix(20,now)
  fixture=Path(self.tmp.name)/'fixture.json';fixture.write_text(json.dumps({'metadata':{'places':[P],'links':[r]},'fixes':{'Dani':f},'statuses':S}))
  sender=Path(self.tmp.name)/'sender';log=Path(self.tmp.name)/'sent'
  sender.write_text('#!/usr/bin/env python3\nimport json,sys\np=json.load(sys.stdin)\nopen('+repr(str(log))+',"w").write(json.dumps(p))\n');sender.chmod(0o700)
  result=run({'enabled':True,'deliver':True,'sender':str(sender),'offline_fixture':str(fixture),'state':str(self.path)})
  self.assertEqual(result['candidates'],1);self.assertEqual(json.loads(log.read_text())['idempotency_key'],'r:once')
  self.assertEqual(self.e.db.execute('SELECT attempts,status FROM deliveries').fetchone(),(1,'sent'))
 def test_timeout_kills_descendant(self):
  pidfile=Path(self.tmp.name)/'pid';script=Path(self.tmp.name)/'child.py'
  script.write_text('import subprocess,time\np=subprocess.Popen(["sleep","30"])\nopen('+repr(str(pidfile))+',"w").write(str(p.pid))\ntime.sleep(30)\n')
  with self.assertRaises(Exception):run_process(['python3',str(script)],timeout=.3)
  pid=int(pidfile.read_text());stat=Path('/proc')/str(pid)/'stat'
  self.assertTrue(not stat.exists() or stat.read_text().split()[2]=='Z')
 def test_wrapper_cli_timeout_cancels_runner_and_sender_descendants(self):
  import subprocess
  now=time.time();r={**R,'mode':'nearby','expires':'2099-01-01'}
  fixture=Path(self.tmp.name)/'fixture';fixture.write_text(json.dumps({'metadata':{'places':[P],'links':[r]},'fixes':{'Dani':fix(20,now)},'statuses':S}))
  pidfile=Path(self.tmp.name)/'descendant';sender=Path(self.tmp.name)/'slow-sender'
  sender.write_text('#!/usr/bin/env python3\nimport subprocess,time\np=subprocess.Popen(["sleep","90"])\nopen('+repr(str(pidfile))+',"w").write(str(p.pid))\ntime.sleep(90)\n');sender.chmod(0o700)
  cfg=Path(self.tmp.name)/'config';cfg.write_text(json.dumps({'enabled':True,'deliver':True,'state':str(self.path),'sender':str(sender),'offline_fixture':str(fixture),'budget_seconds':23}))
  result=subprocess.run(['python3',str(Path(__file__).with_name('scheduled_cycle.py')),'--config',str(cfg)],capture_output=True,text=True,timeout=28)
  self.assertIn(result.returncode,[0,1]);self.assertTrue(pidfile.exists())
  stat=Path('/proc')/pidfile.read_text()/'stat'
  self.assertTrue(not stat.exists() or stat.read_text().split()[2]=='Z')
  self.assertEqual(self.e.db.execute('SELECT attempts,status FROM deliveries').fetchone(),(1,'pending'))
 def test_wrapper_external_stop_preserves_claim_and_kills_descendants(self):
  import subprocess
  now=time.time();r={**R,'mode':'nearby','expires':'2099-01-01'}
  fixture=Path(self.tmp.name)/'fixture';fixture.write_text(json.dumps({'metadata':{'places':[P],'links':[r]},'fixes':{'Dani':fix(20,now)},'statuses':S}))
  pidfile=Path(self.tmp.name)/'descendant';sender=Path(self.tmp.name)/'sender'
  sender.write_text('#!/usr/bin/env python3\nimport subprocess,time\np=subprocess.Popen(["sleep","90"])\nopen('+repr(str(pidfile))+',"w").write(str(p.pid))\ntime.sleep(90)\n');sender.chmod(0o700)
  cfg=Path(self.tmp.name)/'config';cfg.write_text(json.dumps({'enabled':True,'deliver':True,'state':str(self.path),'sender':str(sender),'offline_fixture':str(fixture)}))
  proc=subprocess.Popen(['python3',str(Path(__file__).with_name('scheduled_cycle.py')),'--config',str(cfg)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  try:
   deadline=time.monotonic()+5
   while not pidfile.exists() and time.monotonic()<deadline:time.sleep(.02)
   self.assertTrue(pidfile.exists());proc.terminate();proc.communicate(timeout=5)
   stat=Path('/proc')/pidfile.read_text()/'stat';self.assertTrue(not stat.exists() or stat.read_text().split()[2]=='Z')
   self.assertEqual(self.e.db.execute('SELECT attempts,status FROM deliveries').fetchone(),(1,'claimed'))
  finally:
   if proc.poll() is None:proc.kill();proc.wait()
 def test_disabled_existing_state_retention_without_external_work(self):
  self.e.db.execute("INSERT INTO fixes VALUES('Dani',0,0,'{}')")
  self.assertEqual(run({'enabled':False,'state':str(self.path)},now=NOW),{'skipped':'disabled'})
  self.assertEqual(self.e.db.execute('SELECT count(*) FROM fixes').fetchone()[0],0)
 def test_stale_consumer_cannot_downgrade_newer_revision(self):
  r={**R,'mode':'nearby'}
  self.e.evaluate([{**P,'revision':2,'latitude':1}],[r],{'Dani':fix(20)},NOW,S)
  out=[]
  cycle(self.e,lambda:{'places':[P],'links':[r]},lambda *a:fix(20,NOW+1),lambda:S,lambda *a:None,NOW+1,True,out.append)
  self.assertEqual(self.e.db.execute('SELECT revision,inside FROM transitions').fetchone(),('1:2',0))
  self.assertEqual(out[0]['items'][0]['state'],'unavailable')
 def test_intervening_outside_cannot_be_overridden_by_candidate(self):
  self.e.evaluate([P],[R],{'Dani':fix(300)},NOW,S)
  out=[];other=Engine(self.path)
  try:
   def sender(*a):other.evaluate([P],[R],{'Dani':fix(300,NOW+2)},NOW+2,S)
   cycle(self.e,lambda:{'places':[P],'links':[R]},lambda *a:fix(20,NOW+1),lambda:S,sender,NOW+2,True,out.append)
   self.assertEqual(out[0]['items'][0]['state'],'outside')
  finally:other.close()
 def test_relink_to_lower_revision_place_is_valid(self):
  self.e.evaluate([{**P,'revision':10}],[R],{'Dani':fix(300)},NOW,S)
  newer={**R,'revision':2,'placeId':'q'};q={**P,'id':'q','revision':1}
  self.e.evaluate([q],[newer],{'Dani':fix(20,NOW+1)},NOW+1,S)
  self.assertEqual(self.e.db.execute('SELECT revision,inside FROM transitions').fetchone(),('2:1',1))
 def test_stale_delivery_snapshot_defers_newer_notice(self):
  newer={**R,'revision':2,'mode':'nearby'}
  self.e.evaluate([P],[newer],{'Dani':fix(20)},NOW,S)
  self.e.deliver([R],[P],S,lambda *a:self.fail(),NOW)
  self.assertEqual(self.e.db.execute('SELECT attempts,status FROM deliveries').fetchone(),(0,'pending'))
 def test_old_metadata_cannot_erase_new_rule_transition(self):
  new={**R,'id':'new'}
  self.e.evaluate([P],[new],{'Dani':fix(300)},NOW,S)
  self.e.evaluate([P],[R],{'Dani':fix(300,NOW+1)},NOW+1,S)
  self.assertIsNotNone(self.e.db.execute("SELECT revision FROM transitions WHERE rule='new'").fetchone())
 def test_absent_new_rule_notice_is_deferred_until_expiry(self):
  new={**R,'id':'new','mode':'nearby'}
  self.e.evaluate([P],[new],{'Dani':fix(20)},NOW,S)
  self.e.deliver([R],[P],S,lambda *a:self.fail(),NOW+1)
  self.assertEqual(self.e.db.execute('SELECT status FROM deliveries').fetchone(),('pending',))
  cycle(self.e,lambda:{'places':[],'links':[]},lambda *a:self.fail(),lambda:self.fail(),lambda *a:self.fail(),NOW+2,True)
  self.assertEqual(self.e.db.execute('SELECT status FROM deliveries').fetchone(),('pending',))
  self.e.deliver([],[P],S,lambda *a:self.fail(),NOW+300)
  self.assertEqual(self.e.db.execute('SELECT attempts,status FROM deliveries').fetchone(),(0,'cancelled'))
