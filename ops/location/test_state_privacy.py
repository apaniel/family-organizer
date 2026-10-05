import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from runner import Engine, cycle, target_key
from test_runner import P, R, NOW, fix

class PrivacyTests(unittest.TestCase):
 def test_payload_retry_restart_backups_and_terminal_states(self):
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)/'state.sqlite';e=Engine(path)
   p={**P,'name':'PRIVATE_PLACE_SENTINEL'};r={**R,'mode':'nearby'}
   statuses={target_key(r['target']):{'status':'open','title':'PRIVATE_TITLE_SENTINEL'}}
   calls=[]
   def uncertain(*args):calls.append(args);raise RuntimeError('uncertain')
   cycle(e,lambda:{'places':[p],'links':[r]},lambda *a:fix(20),lambda:statuses,uncertain,NOW,True)
   self.assertEqual(e.db.execute('SELECT data FROM fixes').fetchone(),('{}',))
   self.assertIsNone(e.db.execute("SELECT data FROM cache WHERE key='targets'").fetchone())
   def scan():
    backup=sqlite3.connect(Path(d)/'backup.sqlite');e.db.backup(backup);backup.close()
    for file in Path(d).glob('*'):
     if file.suffix=='.key':continue
     data=file.read_bytes()
     for sentinel in [b'PRIVATE_PLACE_SENTINEL',b'PRIVATE_TITLE_SENTINEL',b'latitude',b'longitude']:
      self.assertNotIn(sentinel,data,file.name)
     self.assertNotIn(path.with_name(path.name+'.key').read_bytes(),data,file.name)
   scan();e.close();e=Engine(path)
   statuses[target_key(r['target'])]['title']='CHANGED TITLE'
   e.deliver([r],[p],statuses,lambda *a:calls.append(a),NOW+61)
   self.assertEqual(calls[0],calls[1]);self.assertEqual(e.db.execute('SELECT status FROM deliveries').fetchone(),('sent',))
   scan()
   e.db.execute("UPDATE deliveries SET status='pending',next_try=0")
   e.deliver([{**r,'enabled':False}],[p],statuses,lambda *a:self.fail('cancelled send'),NOW+62)
   self.assertEqual(e.db.execute('SELECT status FROM deliveries').fetchone(),('cancelled',));scan();e.close()
   self.assertEqual(path.stat().st_mode & 0o777,0o600)
   self.assertEqual(path.parent.stat().st_mode & 0o777,0o700)
   self.assertEqual(path.with_name(path.name+'.key').stat().st_mode & 0o777,0o600)

 def test_missing_wrong_corrupt_key_and_payload_fail_before_external(self):
  from cryptography.fernet import Fernet
  for fault in ['missing','wrong','corrupt','payload']:
   with self.subTest(fault=fault),tempfile.TemporaryDirectory() as d:
    path=Path(d)/'state';e=Engine(path)
    cycle(e,lambda:{'places':[P],'links':[{**R,'mode':'nearby'}]},lambda *a:fix(20),lambda:{target_key(R['target']):{'status':'open','title':'secret'}},lambda *a:None,NOW,True)
    if fault=='payload':e.db.execute("UPDATE deliveries SET message=x'00'")
    e.close();key=Path(str(path)+'.key');original=key.read_bytes()
    if fault=='missing':key.unlink()
    elif fault=='wrong':key.write_bytes(Fernet.generate_key())
    elif fault=='corrupt':key.write_bytes(b'invalid')
    with self.assertRaises(Exception):Engine(path)
    from scheduled_cycle import run
    with self.assertRaises(Exception):
     run({'enabled':True,'state':str(path)},invoke=lambda *a,**kw:self.fail('external invocation'))
    if fault=='missing':self.assertFalse(key.exists())
    elif fault=='wrong':self.assertNotEqual(key.read_bytes(),original)

 def test_plaintext_legacy_unchanged_failclosed(self):
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)/'legacy';db=sqlite3.connect(path);db.execute('CREATE TABLE deliveries(message TEXT)');db.execute("INSERT INTO deliveries VALUES('LEGACY_SECRET')");db.commit();db.close();path.chmod(0o600)
   before=path.read_bytes()
   with self.assertRaises(Exception):Engine(path)
   self.assertEqual(before,path.read_bytes());self.assertFalse(Path(str(path)+'.key').exists())

 def test_multiprocess_key_creation_and_dedupe(self):
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)/'state'
   code="from runner import *; from test_runner import P,R,NOW,fix; S={target_key(R['target']):'open'}; e=Engine(__import__('sys').argv[1]); e.evaluate([P],[{**R,'mode':'nearby'}],{'Dani':fix(20)},NOW,S); e.close()"
   env={**os.environ,'PYTHONPATH':str(Path(__file__).parent),'PYTHONDONTWRITEBYTECODE':'1'}
   processes=[subprocess.Popen([sys.executable,'-c',code,str(path)],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE) for _ in range(8)]
   for proc in processes:
    out,err=proc.communicate(timeout=20);self.assertEqual(proc.returncode,0,err)
   e=Engine(path);self.assertEqual(e.db.execute('SELECT count(*) FROM deliveries').fetchone(),(1,));e.close()

 def test_key_permissions_rejected_and_release_excludes_state(self):
  import importlib.util
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)/'state';e=Engine(path);e.close()
   key=Path(str(path)+'.key');original=key.read_bytes();key.chmod(0o644)
   with self.assertRaises(ValueError):Engine(path)
   self.assertEqual(key.read_bytes(),original)
   spec=importlib.util.spec_from_file_location('release',Path(__file__).with_name('prepare-release.py'))
   module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
   staged=module.prepare(Path(d)/'release')
   for file in staged.rglob('*'):
    if file.is_file():
     self.assertNotIn(original,file.read_bytes())
     self.assertFalse(file.name.endswith(('.key','.sqlite','-wal','-shm','.lock')))
