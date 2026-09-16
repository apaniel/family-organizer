#!/usr/bin/env python3
"""Local calendar broker: one calendar, read/create only, no invitations."""
import json,os,socketserver,hashlib,threading
from pathlib import Path
from datetime import datetime,date
from http.server import BaseHTTPRequestHandler
from urllib.parse import quote
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import AuthorizedSession
TOKEN=Path('/var/lib/hermes-calendar/token.json')
BASE='https://www.googleapis.com/calendar/v3/calendars/losapalas%40gmail.com/events'
LOCK=threading.Lock()
def event_body(raw):
 allowed={'summary','description','location','start','end','sourceKey'}
 if not isinstance(raw,dict) or set(raw)-allowed:raise ValueError('Only event title, details, location, start, end and sourceKey are accepted. Invitations are not supported.')
 if not isinstance(raw.get('summary'),str) or not raw['summary'].strip():raise ValueError('Event title required.')
 key=raw.get('sourceKey')
 if not isinstance(key,str) or not key or len(key)>300:raise ValueError('Stable sourceKey required to prevent duplicates.')
 def boundary(v):
  if not isinstance(v,dict):raise ValueError('Start and end required.')
  if set(v)=={'date'}:return {'date':date.fromisoformat(v['date']).isoformat()}
  if set(v)-{'dateTime','timeZone'} or 'dateTime' not in v:raise ValueError('Use date or dateTime.')
  d=datetime.fromisoformat(v['dateTime'].replace('Z','+00:00'))
  if d.tzinfo is None:raise ValueError('Include a timezone offset in dateTime.')
  if v.get('timeZone','Europe/Madrid')!='Europe/Madrid':raise ValueError('Family timezone is Europe/Madrid.')
  return {'dateTime':d.isoformat(),'timeZone':'Europe/Madrid'}
 start,end=boundary(raw.get('start')),boundary(raw.get('end'))
 if set(start)!=set(end):raise ValueError('Start/end must use the same format.')
 if 'date' in start:
  if end['date']<=start['date']:raise ValueError('All-day end is exclusive and must be after start.')
 elif datetime.fromisoformat(end['dateTime'])<=datetime.fromisoformat(start['dateTime']):raise ValueError('End must be after start.')
 return {'id':hashlib.sha256(('familia:'+key).encode()).hexdigest(),'summary':raw['summary'][:200],'description':str(raw.get('description',''))[:5000],'location':str(raw.get('location',''))[:500],'start':start,'end':end,'reminders':{'useDefault':False},'extendedProperties':{'private':{'hermesProfile':'familia','sourceKey':key}}}
def compact(e):return {k:e[k] for k in ('id','summary','description','location','start','end','htmlLink','status') if k in e}
def run(data):
 action=data.get('action')
 if action not in ('status','list','create'):raise ValueError('Unsupported action.')
 with LOCK:
  c=Credentials.from_authorized_user_file(str(TOKEN));s=AuthorizedSession(c)
  try:
   if action=='create':
    body=event_body(data.get('event'));r=s.post(BASE,params={'sendUpdates':'none'},json=body,timeout=30)
    if r.status_code==409:
     r=s.get(BASE+'/'+body['id'],timeout=30);r.raise_for_status();return {'created':False,'duplicate':True,'event':compact(r.json())}
    r.raise_for_status();return {'created':True,'event':compact(r.json())}
   params={'maxResults':1 if action=='status' else 100,'singleEvents':'true','orderBy':'startTime','timeMin':datetime.now().astimezone().isoformat()}
   r=s.get(BASE,params=params,timeout=30);r.raise_for_status()
   if action=='status':return {'connected':True,'calendar':'losapalas@gmail.com','capabilities':['read','create'],'invitations':False}
   return {'events':[compact(e) for e in r.json().get('items',[])],'hasMore':bool(r.json().get('nextPageToken'))}
  finally:
   if c.token:
    temp=TOKEN.with_suffix('.tmp');temp.write_text(c.to_json());temp.chmod(0o600);temp.replace(TOKEN)
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  try:
   n=int(self.headers.get('Content-Length','0'))
   if self.path!='/v1' or n<1 or n>16000:raise ValueError('Invalid request.')
   result=run(json.loads(self.rfile.read(n)));status=200
  except ValueError as e:result={'error':str(e)};status=400
  except Exception:result={'error':'Calendar operation failed; success not confirmed.'};status=503
  body=json.dumps(result,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
class Server(socketserver.ThreadingMixIn,socketserver.UnixStreamServer):daemon_threads=True
if __name__=='__main__':
 os.umask(0o077);path='/run/hermes-calendar/api.sock'
 if os.path.exists(path):os.unlink(path)
 server=Server(path,Handler);import grp;os.chown(path,0,grp.getgrnam('hermes').gr_gid);os.chmod(path,0o660);server.serve_forever()
