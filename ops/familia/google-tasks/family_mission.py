#!/usr/bin/env python3
"""Shared family planner client. Credentials remain inside the family profile."""
import argparse,json,os,sys,urllib.request,urllib.error
from datetime import date,datetime,timedelta
from zoneinfo import ZoneInfo
from dotenv import dotenv_values
try:
 from . import family_tasks
except ImportError:
 import family_tasks
HOME='/home/hermes/.hermes/profiles/familia'
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs): return None

COMPLETION_MODES=('explicit','inferred')
COMPLETION_CHANNELS=('whatsapp','telegram','email','other')

def completion_headers(mode=None,channel=None):
 if mode is None and channel is None:return {}
 if mode not in COMPLETION_MODES or channel not in COMPLETION_CHANNELS:
  raise ValueError('Completion mode and channel must be a valid pair.')
 return {'x-family-completion-mode':mode,'x-family-completion-channel':channel}

def madrid_today():
 return datetime.now(ZoneInfo('Europe/Madrid')).date()

def digest_date(value=None):
 if value is None:return str(madrid_today())
 if not isinstance(value,str) or date.fromisoformat(value).isoformat()!=value:
  raise ValueError('Date must be YYYY-MM-DD.')
 return value

def completion_digest(value=None):
 return family_tasks.completion_digest(digest_date(value))

def request(path,method='GET',payload=None,*,completion_mode=None,completion_channel=None,idempotency_key=None):
 provenance=completion_headers(completion_mode,completion_channel)
 if os.environ.get('HERMES_HOME',HOME).rstrip('/')!=HOME: raise ValueError('Use the familia profile.')
 e=dotenv_values(HOME+'/.env')
 headers={'User-Agent':'HermesFamilyDashboard/1.0','Content-Type':'application/json','CF-Access-Client-Id':e['FAMILY_DASHBOARD_CF_CLIENT_ID'],'CF-Access-Client-Secret':e['FAMILY_DASHBOARD_CF_CLIENT_SECRET'],'x-calendar-sync-secret':e['FAMILY_DASHBOARD_SYNC_SECRET']}
 if idempotency_key is not None:headers['Idempotency-Key']=idempotency_key
 headers.update(provenance)
 req=urllib.request.Request('https://apalas.apaniel.dev/api/family/'+path,headers=headers,method=method,data=json.dumps(payload).encode() if payload is not None else None)
 with urllib.request.build_opener(NoRedirect).open(req,timeout=45) as r:return json.load(r)

def main(argv=None):
 p=argparse.ArgumentParser(allow_abbrev=False);p.add_argument('action',choices=['list','save','complete','delete','calendar','reminders','digest','flatten','flatten-all']);p.add_argument('id',nargs='?')
 p.add_argument('--completion-mode',choices=COMPLETION_MODES)
 p.add_argument('--completion-channel','--channel',dest='completion_channel',choices=COMPLETION_CHANNELS)
 p.add_argument('--date')
 p.add_argument('--confirm',action='store_true')
 a=p.parse_args(argv)
 if a.action not in ('save','complete') and (a.completion_mode is not None or a.completion_channel is not None):p.error('Completion flags require save or complete.')
 if a.date is not None and a.action not in ('digest','flatten','flatten-all'):p.error('--date requires digest, flatten or flatten-all.')
 if a.confirm and a.action not in ('flatten','flatten-all'):p.error('--confirm requires flatten or flatten-all.')
 if a.action=='flatten' and (not a.id or a.id.strip()!=a.id or len(a.id)>200):p.error('flatten requires a nonempty ID of at most 200 characters without surrounding whitespace.')
 if a.action=='flatten-all' and a.id is not None:p.error('flatten-all does not accept an ID.')
 if a.action in ('flatten','flatten-all'):local_today=digest_date(a.date)
 provenance={}
 if a.action=='complete':
  if a.completion_mode not in (None,'explicit'):p.error('complete requires explicit completion mode.')
  provenance={'completion_mode':'explicit','completion_channel':a.completion_channel or 'whatsapp'}
 elif a.action=='save':
  completion_headers(a.completion_mode,a.completion_channel)
  if a.completion_mode is not None:provenance={'completion_mode':a.completion_mode,'completion_channel':a.completion_channel}
 today=madrid_today()
 if a.action in ('flatten','flatten-all'):
  raise ValueError('Tasks now live in Google Tasks; checklist flattening no longer applies.')
 elif a.action=='list':result={'records':family_tasks.list_tasks()+[r for r in request('records')['records'] if r.get('kind')!='task']}
 elif a.action=='digest':
  if a.id and a.date:p.error('Provide the digest date only once.')
  result=family_tasks.completion_digest(digest_date(a.date or a.id))
 elif a.action=='calendar':result=request('calendar?from='+str(today)+'&to='+str(today+timedelta(days=90)))
 elif a.action=='save':
  record=json.load(sys.stdin)
  if record.get('kind','task')=='task':result=family_tasks.save(record)
  else:
   if record.get('kind')=='event':raise ValueError('Confirmed events belong in Google Calendar; use the protected calendar helper after checking for duplicates.')
   if not record.get('id') and not record.get('sourceKey'):raise ValueError('New Hermes records require a stable sourceKey.')
   result=request('records','POST',record,**provenance)
 elif a.action=='delete':
  result=family_tasks.delete(a.id)
  if result.get('missing'):
   record=next((r for r in request('records')['records'] if r['id']==a.id and r.get('kind')!='task'),None)
   if not record:raise ValueError('Record not found.')
   result=request('records','DELETE',{'id':record['id'],'revision':record['revision']})
 elif a.action=='complete':
  result=family_tasks.complete(a.id)
 else:
  result={'records':family_tasks.due_reminders(today)+[r for r in request('records?reminders=1')['records'] if r.get('kind')!='task'],'today':str(today)}
  try:result['calendar']=request('calendar?from='+str(today)+'&to='+str(today+timedelta(days=30)))['events']
  except Exception:result['calendarUnavailable']=True
 print(json.dumps(result,ensure_ascii=False))
if __name__=='__main__':
 try:main()
 except urllib.error.HTTPError as e:print(json.dumps({'error':'Family planner request failed','status':e.code}));sys.exit(1)
 except ValueError as e:print(json.dumps({'error':str(e)}));sys.exit(1)
 except Exception:print(json.dumps({'error':'Family planner unavailable. No change confirmed.'}));sys.exit(1)
