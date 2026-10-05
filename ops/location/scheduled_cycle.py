#!/usr/bin/env python3
"""One bounded scheduler invocation. No installs, background loop or service changes."""
import argparse,json,subprocess,time,signal,os
from pathlib import Path
from runner import Engine, run_process, Budget, ACTIVE_CHILDREN

def run(config,invoke=None,now=None):
 if config.get('enabled') is not True:
  state=config.get('state')
  if state and Path(state).is_absolute() and Path(state).is_file():
   engine=Engine(state)
   try:engine.cleanup(time.time() if now is None else now)
   finally:engine.close()
  return {'skipped':'disabled'}
 interval=config.get('interval_seconds',300)
 if not isinstance(interval,int) or interval<300 or interval>3600:raise ValueError('Invalid interval')
 state=config['state']
 if not Path(state).is_absolute():raise ValueError('Absolute state path required')
 if config.get('deliver') and not config.get('sender'):raise ValueError('Reviewed idempotent sender required')
 budget=Budget(time.monotonic()+min(165,config.get('budget_seconds',165)))
 engine=Engine(state);now=time.time() if now is None else now
 try:
  engine.cleanup(now)
  engine.db.execute('BEGIN IMMEDIATE');last=engine.db.execute("SELECT fetched FROM cache WHERE key='scheduler'").fetchone()
  if last and now-last[0]<interval:engine.db.execute('ROLLBACK');return {'skipped':'interval'}
  engine.db.execute("INSERT OR REPLACE INTO cache VALUES('scheduler',?,'{}')",(now,));engine.db.execute('COMMIT')
 finally:engine.close()
 command=['python3',str(Path(__file__).with_name('runner.py')),'--state',state]
 command+=['--deadline',str(budget.deadline)]
 if config.get('offline_fixture'):command+=['--offline-fixture',config['offline_fixture']]
 if config.get('deliver'):command+=['--deliver','--sender',config['sender']]
 r=(invoke(command,capture_output=True,text=True,timeout=budget.remaining(),check=True) if invoke else run_process(command,capture_output=True,text=True,timeout=budget.remaining(),budget=budget,check=True))
 return json.loads(r.stdout)
def stop_runner(signum,frame):
 for pid in tuple(ACTIVE_CHILDREN):
  try:os.killpg(pid,signal.SIGTERM)
  except ProcessLookupError:pass
 time.sleep(1)
 for pid in tuple(ACTIVE_CHILDREN):
  try:os.killpg(pid,signal.SIGKILL)
  except ProcessLookupError:pass
 raise SystemExit(128+signum)

if __name__=='__main__':
 signal.signal(signal.SIGTERM,stop_runner);signal.signal(signal.SIGINT,stop_runner)
 parser=argparse.ArgumentParser();parser.add_argument('--config',type=Path,default=Path(__file__).with_name('config.json'));args=parser.parse_args()
 try:print(json.dumps(run(json.loads(args.config.read_text()))))
 except Exception:print('{"error":"Scheduled cycle unavailable"}');raise SystemExit(1)
