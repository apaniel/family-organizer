#!/usr/bin/env python3
"""Bounded deterministic location consumer. Default is preview; never completes tasks."""
import argparse, importlib.util, json, math, os, sqlite3, subprocess, time, uuid, signal
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
PRIVATE_DESTINATION='238615548420255@lid'
BROKER='/opt/hermes-health/client.py'
PERSONS={'Dani':'dan','Cris':'wife'}
MAX_AGE=300

def timestamp(value):
 if isinstance(value,(int,float)) and not isinstance(value,bool):return float(value)
 d=datetime.fromisoformat(value.replace('Z','+00:00'))
 if d.tzinfo is None:raise ValueError('timezone required')
 return d.timestamp()

def valid_fix(f,person,tz,now):
 try:
  if not isinstance(f,dict) or f['version']!=1 or f['person']!=person or f['timezone']!=tz:return False
  ZoneInfo(tz)
  lat,lon,accuracy=f['latitude'],f['longitude'],f['accuracy']
  if any(isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x) for x in [lat,lon,accuracy]):return False
  recorded,received=timestamp(f['recorded_at']),timestamp(f['received_at'])
  return -90<=lat<=90 and -180<=lon<=180 and 0<=accuracy<=100 and 0<=now-recorded<MAX_AGE and recorded<=received<=now and now-received<=MAX_AGE
 except (KeyError,ValueError,TypeError,OverflowError):return False

def distance(f,p):
 a,b=math.radians(f['latitude']),math.radians(p['latitude']);da=b-a;dl=math.radians(p['longitude']-f['longitude'])
 return 6371000*2*math.asin(min(1,math.sqrt(math.sin(da/2)**2+math.cos(a)*math.cos(b)*math.sin(dl/2)**2)))

def status_of(statuses,target):
 value=statuses.get(target_key(target))
 return value.get('status') if isinstance(value,dict) else value

def target_key(t):return json.dumps(['task',t['listId'],t['id']] if t['kind']=='task' else ['event',t['id']],separators=(',',':'))

class Engine:
 def __init__(self,path):
  path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
  self.db=sqlite3.connect(path,timeout=10,isolation_level=None);os.chmod(path,0o600)
  self.db.executescript('''PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON;
   CREATE TABLE IF NOT EXISTS fixes(person TEXT PRIMARY KEY, recorded REAL, received REAL, data TEXT);
   CREATE TABLE IF NOT EXISTS transitions(rule TEXT PRIMARY KEY, revision INTEGER, inside INTEGER, episode INTEGER, recorded REAL);
   CREATE TABLE IF NOT EXISTS deliveries(key TEXT PRIMARY KEY, rule TEXT, rule_revision INTEGER, place_revision INTEGER, message TEXT, created REAL, attempts INTEGER DEFAULT 0, next_try REAL DEFAULT 0, status TEXT DEFAULT 'pending');
   CREATE TABLE IF NOT EXISTS episodes(key TEXT PRIMARY KEY, rule TEXT);
   CREATE TABLE IF NOT EXISTS cache(key TEXT PRIMARY KEY, fetched REAL, data TEXT);
  ''')
  columns={r[1] for r in self.db.execute('PRAGMA table_info(deliveries)')}
  for name,kind in [('claim','TEXT'),('lease_until','REAL DEFAULT 0')]:
   if name not in columns:self.db.execute('ALTER TABLE deliveries ADD COLUMN '+name+' '+kind)
 def close(self):self.db.close()
 def cleanup(self,now):
  self.db.execute('DELETE FROM fixes WHERE recorded<=?',(now-MAX_AGE,))
  self.db.execute("DELETE FROM cache WHERE key='targets' AND fetched<=?",(now-60,))
  self.db.execute('DELETE FROM deliveries WHERE created<=?',(now-30*86400,))
  if not self.db.in_transaction:self.db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
 def evaluate(self,places,rules,fixes,now,statuses,commit=True):
  self.db.execute('BEGIN IMMEDIATE')
  result=[]
  try:
   self.cleanup(now)
   self.db.execute("DELETE FROM deliveries WHERE created<? AND status!='pending'",(now-30*86400,))
   # Absence in a concurrent snapshot is not a deletion tombstone. Keep compact
   # evidence; only matching current rules can evaluate or publish it.
   obsolete=set()
   for r in rules:
    p=next((p for p in places if p['id']==r['placeId'] and p['person']==r['person']),None)
    if p:
     rev=str(r['revision'])+':'+str(p['revision'])
     stored=self.db.execute('SELECT revision FROM transitions WHERE rule=?',(r['id'],)).fetchone()
     if stored and tuple(map(int,str(stored[0]).split(':')))>(r['revision'],p['revision']):
      obsolete.add(r['id']);continue
     self.db.execute('UPDATE transitions SET revision=?,inside=NULL,recorded=? WHERE rule=? AND revision!=?',(rev,float('-inf'),r['id'],rev))
   accepted={}
   for p in places:
    person=p['person'];f=fixes.get(person)
    if not valid_fix(f,person,p['timezone'],now):continue
    old=self.db.execute('SELECT recorded,received FROM fixes WHERE person=?',(person,)).fetchone()
    ts,received=timestamp(f['recorded_at']),timestamp(f['received_at'])
    if old and (ts<old[0] or received<old[1]):continue
    accepted[person]=f
   for r in rules:
    if r['id'] in obsolete:continue
    p=next((p for p in places if p['id']==r['placeId'] and p['person']==r['person']),None)
    f=accepted.get(r['person'])
    if not p or not valid_fix(f,r['person'],p['timezone'],now) or not r.get('enabled') or not r.get('confirmedAt'):continue
    if datetime.fromtimestamp(now,ZoneInfo(p['timezone'])).date().isoformat()>r['expires']:continue
    if status_of(statuses,r['target']) not in ('open','waiting'):continue
    ts=timestamp(f['recorded_at']);row=self.db.execute('SELECT revision,inside,episode,recorded FROM transitions WHERE rule=?',(r['id'],)).fetchone()
    revision=str(r['revision'])+':'+str(p['revision'])
    if row and row[0]!=revision:
     self.db.execute('DELETE FROM transitions WHERE rule=?',(r['id'],))
     # Preserve episode consumption, but discard obsolete spatial evidence.
     row=(revision,None,row[2],float('-inf'))
    if row and ts<=row[3]:continue
    previous=None if not row or row[1] is None or row[0]!=revision or ts-row[3]>MAX_AGE else bool(row[1]);episode=0 if not row else row[2]
    d=distance(f,p);accuracy=f['accuracy'];radius=p['radius']
    inside=previous
    if d+accuracy<=radius:inside=True
    elif d-accuracy>=radius+max(50,radius*.25):inside=False
    if inside is None:continue
    entered=inside and previous is False
    if entered or inside and previous is None and row is None:episode+=1
    self.db.execute('INSERT OR REPLACE INTO transitions VALUES(?,?,?,?,?)',(r['id'],revision,int(inside),episode,ts))
    trigger=entered if r['mode']=='arrival' else inside
    if not trigger:continue
    # Revision never resets one-shot consumption; consent edits cannot replay it.
    key=r['id']+(':'+str(episode) if r['recurring'] else ':once')
    title=statuses.get(target_key(r['target']))
    title=title.get('title','Pendiente vinculado') if isinstance(title,dict) else 'Pendiente vinculado'
    message=('Al llegar a ' if r['mode']=='arrival' else 'Cerca de ')+p['name']+': '+title[:200]+'. Revísalo en Apalas; sigue pendiente hasta que lo completes.'
    cur=self.db.execute('INSERT OR IGNORE INTO episodes VALUES(?,?)',(key,r['id']))
    if cur.rowcount:
     self.db.execute('INSERT INTO deliveries(key,rule,rule_revision,place_revision,message,created,next_try) VALUES(?,?,?,?,?,?,?)',(key,r['id'],r['revision'],p['revision'],message,now,now))
     result.append({'key':key,'rule':r['id'],'message':message})
   for person,f in accepted.items():
    minimal={k:f[k] for k in ('latitude','longitude','accuracy','timezone','version')}
    self.db.execute('INSERT OR REPLACE INTO fixes VALUES(?,?,?,?)',(person,timestamp(f['recorded_at']),timestamp(f['received_at']),json.dumps(minimal)))
   self.db.execute('COMMIT' if commit else 'ROLLBACK');return result
  except Exception:self.db.execute('ROLLBACK');raise
 def deliver(self,rules,places,statuses,sender,now,clock=None,budget=None):
  for _ in range(10):
   now=clock() if clock else now
   self.db.execute('BEGIN IMMEDIATE')
   try:
    self.db.execute("UPDATE deliveries SET status='pending',claim=NULL WHERE status='claimed' AND lease_until<=?",(now,))
    self.db.execute("UPDATE deliveries SET status='failed' WHERE status='pending' AND attempts>=3")
    row=self.db.execute("SELECT key,rule,rule_revision,place_revision,message,created,attempts FROM deliveries WHERE status='pending' AND next_try<=? AND attempts<3 ORDER BY created,key LIMIT 1",(now,)).fetchone()
    if not row:self.db.execute('COMMIT');break
    key,rid,rr,pr,message,created,attempts=row
    r=next((r for r in rules if r['id']==rid),None);p=next((p for p in places if r and p['id']==r['placeId'] and p['person']==r['person']),None)
    if (not r or not p) and now-created<MAX_AGE:
     self.db.execute('COMMIT');break
    if r and p and (rr,pr)>(r['revision'],p['revision']):
     # A stale snapshot must not consume a newer rule's episode by cancelling it.
     self.db.execute('COMMIT');break
    if not r or not p or r['revision']!=rr or p['revision']!=pr or not r.get('enabled') or not r.get('confirmedAt') or now-created>=MAX_AGE or datetime.fromtimestamp(now,ZoneInfo(p['timezone'])).date().isoformat()>r['expires'] or status_of(statuses,r['target']) not in ('open','waiting'):
     self.db.execute("UPDATE deliveries SET status='cancelled',claim=NULL WHERE key=?",(key,));self.db.execute('COMMIT');continue
    if budget and budget.remaining()<22:self.db.execute('COMMIT');break
    token=uuid.uuid4().hex
    self.db.execute("UPDATE deliveries SET attempts=attempts+1,next_try=?,status='claimed',claim=?,lease_until=? WHERE key=?",(now+60*(2**attempts),token,now+30,key))
    self.db.execute('COMMIT')
   except BaseException:
    if self.db.in_transaction:self.db.execute('ROLLBACK')
    raise
   # External work occurs only after a durable attempt. A crash leaves a leased claim.
   try:sender(PRIVATE_DESTINATION,message,key)
   except Exception:outcome='failed' if attempts>=2 else 'pending'
   else:outcome='sent'
   self.db.execute("UPDATE deliveries SET status=?,claim=NULL WHERE key=? AND claim=?",(outcome,key,token))

def cycle(engine,fetch,broker,status_reader,sender,now,deliver=False,publish=None,clock=None,budget=None):
 engine.cleanup(now)
 if deliver:engine.db.execute("DELETE FROM deliveries WHERE created<?",(now-30*86400,))
 metadata=fetch();places=metadata['places'];rules=[r for r in metadata['links'] if r.get('enabled') and r.get('confirmedAt') and any(p['id']==r['placeId'] and p['person']==r['person'] and datetime.fromtimestamp(now,ZoneInfo(p['timezone'])).date().isoformat()<=r['expires'] for p in places)]
 if deliver:
  for r in metadata['links']:
   if not r.get('enabled') or not r.get('confirmedAt'):
    engine.db.execute("UPDATE deliveries SET status='cancelled' WHERE status='pending' AND rule=? AND rule_revision<=?",(r['id'],r['revision']))
 if not rules:
  if deliver:
   engine.db.execute('DELETE FROM fixes');engine.db.execute("DELETE FROM cache WHERE key='targets'");engine.db.execute("UPDATE deliveries SET status='cancelled' WHERE status='pending' AND created<=?",(now-MAX_AGE,))
  return {'candidates':0,'available':[]}
 if len(places)>500 or len(rules)>500:raise ValueError('Metadata limit')
 timezones={person:{p['timezone'] for p in places if p['person']==person and any(r['placeId']==p['id'] and r['person']==person for r in rules)} for person in PERSONS}
 # Conflicting per-person timezones fail closed; never fan out polling by place.
 needed={(person,next(iter(zones))) for person,zones in timezones.items() if len(zones)==1}
 fixes={}
 for person,tz in sorted(needed):
  try:fixes[person]=broker(person,tz)
  except Exception:fixes[person]=None
 now=clock() if clock else now
 engine.cleanup(now)
 valid_rules=[r for r in rules if any(p['id']==r['placeId'] and valid_fix(fixes.get(r['person']),r['person'],p['timezone'],now) for p in places)]
 if not valid_rules:
  if deliver and publish:
   stamp=datetime.fromtimestamp(now,timezone.utc).isoformat();until=datetime.fromtimestamp(now+MAX_AGE,timezone.utc).isoformat()
   publish({'items':[{'ruleId':r['id'],'person':r['person'],'ruleRevision':r['revision'],'placeRevision':next(p['revision'] for p in places if p['id']==r['placeId']),'state':'unavailable','observedAt':stamp,'validUntil':until,'version':1} for r in rules]})
  return {'candidates':0,'available':[]}
 cached=engine.db.execute("SELECT fetched,data FROM cache WHERE key='targets'").fetchone()
 keys={target_key(r['target']) for r in rules}
 if cached and 0<=now-cached[0]<60 and keys.issubset(json.loads(cached[1])):
  statuses=json.loads(cached[1])
 else:
  statuses={k:v for k,v in status_reader().items() if k in keys}
  if deliver:engine.db.execute("INSERT OR REPLACE INTO cache VALUES('targets',?,?)",(now,json.dumps(statuses)))
 now=clock() if clock else now
 candidates=engine.evaluate(places,metadata['links'],fixes,now,statuses,commit=deliver)
 if deliver:
  engine.deliver(valid_rules,places,statuses,sender,now,clock,budget)
  if publish:
   now=clock() if clock else now
   def iso(t):return datetime.fromtimestamp(t,timezone.utc).isoformat().replace('+00:00','Z')
   items=[]
   for r in rules:
    p=next(p for p in places if p['id']==r['placeId']);f=fixes.get(r['person'])
    state='unavailable'
    if valid_fix(f,r['person'],p['timezone'],now) and status_of(statuses,r['target']) in ('open','waiting'):
     row=engine.db.execute('SELECT inside,recorded,revision FROM transitions WHERE rule=?',(r['id'],)).fetchone()
     if row and row[0] is not None and row[2]==str(r['revision'])+':'+str(p['revision']) and now-row[1]<=MAX_AGE:state='nearby' if row[0] else 'outside'
     if row and row[0]==1 and row[1]==timestamp(f['recorded_at']) and row[2]==str(r['revision'])+':'+str(p['revision']) and any(c['rule']==r['id'] for c in candidates):state='arrived' if r['mode']=='arrival' else 'nearby'
    items.append({'ruleId':r['id'],'person':r['person'],'ruleRevision':r['revision'],'placeRevision':p['revision'],'state':state,'observedAt':iso(now),'validUntil':iso(min(now+MAX_AGE,timestamp(f['recorded_at'])+MAX_AGE) if valid_fix(f,r['person'],p['timezone'],now) else now+MAX_AGE),'version':1})
   publish({'items':items})
 return {'candidates':len(candidates),'available':[person for person,tz in needed if valid_fix(fixes.get(person),person,tz,now)]}

def broker_latest(person,tz,budget=None,fixture=None):
 # Fixed read-only route: no health history, credentials, or backend URL.
 command=['python3',str(Path(__file__).with_name('fixture_child.py')),str(fixture),'broker',person] if fixture else ['python3',BROKER,'where',PERSONS[person],'--tz',tz]
 r=run_process(command,capture_output=True,text=True,timeout=50,budget=budget,check=True)
 d=json.loads(r.stdout);loc=d.get('location')
 if d.get('ok') is not True or d.get('person')!=PERSONS[person] or not loc:return None
 return {'person':person,'timezone':tz,'version':1,'latitude':loc['lat'],'longitude':loc['lon'],'accuracy':loc['h_acc'],'recorded_at':loc['ts'],'received_at':loc['received_at']}

ACTIVE_CHILDREN=set()
def terminate_children(signum,frame):
 for pid in tuple(ACTIVE_CHILDREN):
  try:os.killpg(pid,signal.SIGTERM)
  except ProcessLookupError:pass
 time.sleep(.2)
 for pid in tuple(ACTIVE_CHILDREN):
  try:os.killpg(pid,signal.SIGKILL)
  except ProcessLookupError:pass
 raise SystemExit(128+signum)

class Budget:
 def __init__(self,deadline=None):
  current=time.monotonic()
  if deadline is not None and not math.isfinite(deadline):raise ValueError('Invalid deadline')
  self.deadline=min(deadline,current+165) if deadline is not None else current+165
 def remaining(self):return max(0,self.deadline-time.monotonic())

def run_process(command,timeout,budget=None,check=False,**kwargs):
 limit=min(timeout,budget.remaining()) if budget else timeout
 if limit<=0:raise TimeoutError('Invocation budget exhausted')
 payload=kwargs.pop('input',None)
 if payload is not None:kwargs['stdin']=subprocess.PIPE
 if kwargs.pop('capture_output',False):kwargs.update(stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 proc=subprocess.Popen(command,start_new_session=True,**kwargs)
 ACTIVE_CHILDREN.add(proc.pid)
 try:stdout,stderr=proc.communicate(input=payload,timeout=limit)
 except BaseException:
  try:os.killpg(proc.pid,signal.SIGTERM)
  except ProcessLookupError:pass
  try:proc.wait(timeout=1)
  except subprocess.TimeoutExpired:pass
  try:os.killpg(proc.pid,signal.SIGKILL)
  except ProcessLookupError:pass
  proc.wait();raise
 finally:ACTIVE_CHILDREN.discard(proc.pid)
 result=subprocess.CompletedProcess(command,proc.returncode,stdout,stderr)
 if check:result.check_returncode()
 return result

def main():
 signal.signal(signal.SIGTERM,terminate_children)
 signal.signal(signal.SIGINT,terminate_children)
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--state',required=True);parser.add_argument('--deadline',type=float);parser.add_argument('--offline-fixture',type=Path);parser.add_argument('--deliver',action='store_true');parser.add_argument('--sender',type=Path);args=parser.parse_args()
 if args.deliver and (not args.sender or not args.sender.is_absolute() or not args.sender.is_file()):parser.error('--deliver requires a reviewed absolute sender executable accepting private destination, message and idempotency key via JSON stdin')
 budget=Budget(args.deadline)
 engine=Engine(args.state);now=time.time();engine.cleanup(now)
 try:
  # Cross-process scheduler guard: maximum one broker cycle per minute.
  engine.db.execute('BEGIN IMMEDIATE');last=engine.db.execute("SELECT fetched FROM cache WHERE key='cycle'").fetchone()
  if last and now-last[0]<60:engine.db.execute('ROLLBACK');print('{"skipped":"interval"}');return
  engine.db.execute("INSERT OR REPLACE INTO cache VALUES('cycle',?,'{}')",(now,));engine.db.execute('COMMIT')
  metadata={}
  def api(path,method='GET',payload=None):
   command=(['python3',str(Path(__file__).with_name('fixture_child.py')),str(args.offline_fixture),'api',path] if args.offline_fixture else ['python3',str(Path(__file__).with_name('api_child.py')),path,method])
   return json.loads(run_process(command,input=json.dumps(payload),text=True,capture_output=True,timeout=45,budget=budget,check=True).stdout)
  def fetch():
   # Consent is read fresh on every bounded invocation; never deliver from stale consent.
   data=api('locations');metadata.update(data);return data
  def statuses():
   targets=[r['target'] for r in metadata['links'] if r.get('enabled') and r.get('confirmedAt')]
   need_records=any(t['kind']=='task' or not t['id'].startswith('google:') for t in targets)
   d=api('records') if need_records else {'records':[],'taskAvailable':False};result={}
   if d.get('taskAvailable') is not False:
    stamp=timestamp(d['taskRefreshedAt'])
    if 0<=time.time()-stamp<=90:
     for r in d['records']:
      if r['kind']=='task' and r.get('googleTaskListId'):result[target_key({'kind':'task','listId':r['googleTaskListId'],'id':r['id']})]={'status':r['status'],'title':r['title']}
   from datetime import timedelta
   today=datetime.now(ZoneInfo('Europe/Madrid')).date()
   if any(t['kind']=='event' and t['id'].startswith('google:') for t in targets):
    for r in api('calendar?from='+str(today)+'&to='+str(today+timedelta(days=1)))['events']:result[target_key({'kind':'event','id':r['id']})]={'status':r['status'],'title':r['title']}
   for r in d['records']:
    if r['kind']=='event':result[target_key({'kind':'event','id':r['id']})]={'status':r['status'],'title':r['title']}
   return result
  def send(destination,message,key):run_process([str(args.sender)],input=json.dumps({'destination':destination,'message':message,'idempotency_key':key}),text=True,capture_output=True,timeout=20,budget=budget,check=True)
  def publish(payload):
   for start in range(0,len(payload['items']),100):api('location-attention','POST',{'items':payload['items'][start:start+100]})
  print(json.dumps(cycle(engine,fetch,lambda p,t:broker_latest(p,t,budget,args.offline_fixture),statuses,send,now,args.deliver,publish,time.time,budget)))
 finally:engine.cleanup(time.time());engine.close()
if __name__=='__main__':
 try:main()
 except Exception:print('{"error":"Location cycle unavailable; no completion or change confirmed"}');raise SystemExit(1)
