#!/usr/bin/env python3
"""Shared family planner client. Credentials remain inside the family profile."""
import argparse,json,os,sys,urllib.request,urllib.error
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
from dotenv import dotenv_values
HOME='/home/hermes/.hermes/profiles/familia'
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs): return None

def request(path,method='GET',payload=None):
 if os.environ.get('HERMES_HOME',HOME).rstrip('/')!=HOME: raise ValueError('Use the familia profile.')
 e=dotenv_values(HOME+'/.env')
 headers={'User-Agent':'HermesFamilyDashboard/1.0','Content-Type':'application/json','CF-Access-Client-Id':e['FAMILY_DASHBOARD_CF_CLIENT_ID'],'CF-Access-Client-Secret':e['FAMILY_DASHBOARD_CF_CLIENT_SECRET'],'x-calendar-sync-secret':e['FAMILY_DASHBOARD_SYNC_SECRET']}
 req=urllib.request.Request('https://apalas.apaniel.dev/api/family/'+path,headers=headers,method=method,data=json.dumps(payload).encode() if payload is not None else None)
 with urllib.request.build_opener(NoRedirect).open(req,timeout=45) as r:return json.load(r)

def main():
 p=argparse.ArgumentParser();p.add_argument('action',choices=['list','save','complete','calendar','reminders']);p.add_argument('id',nargs='?');a=p.parse_args()
 today=datetime.now(ZoneInfo('Europe/Madrid')).date()
 if a.action=='list':result=request('records')
 elif a.action=='calendar':result=request('calendar?from='+str(today)+'&to='+str(today+timedelta(days=90)))
 elif a.action=='save':
  record=json.load(sys.stdin)
  if not record.get('id') and not record.get('sourceKey'):raise ValueError('New Hermes records require a stable sourceKey.')
  result=request('records','POST',record)
 elif a.action=='complete':
  record=next((r for r in request('records')['records'] if r['id']==a.id),None)
  if not record:raise ValueError('Record not found.')
  if record['kind']!='task':raise ValueError('Only tasks can be completed.')
  if record['recurrence']!='none':
   key='completion:'+record['id']+':'+str(today)
   record={**record,'id':'','revision':0,'sourceKey':key,'date':str(today),'recurrence':'none'}
  record['status']='done';result=request('records','POST',record)
 else:
  result=request('records?reminders=1');result['today']=str(today)
  try:result['calendar']=request('calendar?from='+str(today)+'&to='+str(today+timedelta(days=30)))['events']
  except Exception:result['calendarUnavailable']=True
 print(json.dumps(result,ensure_ascii=False))
if __name__=='__main__':
 try:main()
 except urllib.error.HTTPError as e:print(json.dumps({'error':'Family planner request failed','status':e.code}));sys.exit(1)
 except ValueError as e:print(json.dumps({'error':str(e)}));sys.exit(1)
 except Exception:print(json.dumps({'error':'Family planner unavailable. No change confirmed.'}));sys.exit(1)
