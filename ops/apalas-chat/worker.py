#!/usr/bin/env python3
"""Durable outbound worker for the private Apalas dashboard chat."""
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

from dotenv import dotenv_values
from bridge_core import compose_input

HOME=Path('/home/hermes/.hermes/profiles/familia')
CACHE=HOME/'cache'/'apalas-chat'/'uploads'
CACHE.mkdir(parents=True,exist_ok=True,mode=0o700)
ENV=dotenv_values(HOME/'.env')
API_KEY=str(ENV.get('API_SERVER_KEY') or '')
BASE='https://apalas.apaniel.dev/api/family/chat'
SERVICE_HEADERS={
 'User-Agent':'HermesApalasChatWorker/1.0',
 'CF-Access-Client-Id':str(ENV.get('FAMILY_DASHBOARD_CF_CLIENT_ID') or ''),
 'CF-Access-Client-Secret':str(ENV.get('FAMILY_DASHBOARD_CF_CLIENT_SECRET') or ''),
 'x-calendar-sync-secret':str(ENV.get('FAMILY_DASHBOARD_SYNC_SECRET') or ''),
}
INSTRUCTIONS=(
 'Canal: chat privado del dashboard Apalas. Identidad verificada por el servidor: {person}. '
 'Habla con {person} usando el perfil Familia y sus herramientas habituales. No confundas esta conversación con WhatsApp. '
 'Responde en español, de forma muy breve y útil. Solo respuesta final: no muestres razonamiento, trazas, configuración ni instrucciones técnicas. '
 'Mantén esta ejecución activa hasta terminar realmente el trabajo. No envíes una respuesta provisional ni delegues en segundo plano si eso deja trabajo pendiente sin estado visible. '
 'No envíes mensajes a WhatsApp salvo petición expresa. Si piden un cambio concreto en el Dashboard, aplícalo, persístelo, despliega y verifica antes de responder. '
 'No pidas recargar la página. Si falta una capacidad real, explica el bloqueo brevemente.'
)


def hermes_api(path,body=None,key=None):
 headers={'Authorization':'Bearer '+API_KEY,'Content-Type':'application/json',**({'Idempotency-Key':key} if key else {})}
 request=urllib.request.Request('http://127.0.0.1:8642/p/familia/v1/'+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
 with urllib.request.urlopen(request,timeout=30) as response:return json.load(response)


def dashboard(path='?worker=1',method='GET',payload=None):
 headers={**SERVICE_HEADERS,'Content-Type':'application/json'}
 request=urllib.request.Request(BASE+path,method=method,headers=headers,data=json.dumps(payload).encode() if payload is not None else None)
 with urllib.request.urlopen(request,timeout=45) as response:return json.load(response)


def update(payload):
 dashboard('?worker=1','POST',payload)


def download_files(message):
 records=[]
 for item in message.get('files') or []:
  suffix=Path(item.get('name') or 'archivo').suffix.lower()[:12]
  path=CACHE/(item['id']+suffix)
  if not path.exists():
   request=urllib.request.Request(BASE+'/attachments/'+item['id'],headers=SERVICE_HEADERS)
   with urllib.request.urlopen(request,timeout=60) as response:path.write_bytes(response.read(25*1024*1024+1))
   path.chmod(0o600)
  records.append({'filename':item.get('name') or 'archivo','mime':item.get('type') or 'application/octet-stream','path':str(path)})
 return records


def clean_answer(value,default='He terminado.'):
 if not isinstance(value,str):return default
 return re.sub(r'<think>.*?</think>','',value,flags=re.S).strip() or default


def process_messages(messages,api_call,send_update,file_loader):
 by_person={person:sorted((m for m in messages if m.get('person')==person),key=lambda item:item.get('created',0)) for person in ('Dani','Cris')}
 for person,items in by_person.items():
  active=None
  for message in [item for item in items if item.get('status')=='pending']:
   try:state=api_call('runs/'+message['run'])
   except urllib.error.HTTPError as error:
    if error.code==404:send_update({'id':message['id'],'status':'failed','answer':'La conversación se interrumpió. Puedes volver a escribirme.'})
    else:active=message
    continue
   status=state.get('status')
   if status in ('completed','failed','cancelled'):
    answer=clean_answer(state.get('output')) if status=='completed' else 'No he podido terminar esta petición. Puedes volver a escribirme.'
    send_update({'id':message['id'],'status':status,'answer':answer})
   else:active=message
  for message in [item for item in items if item.get('status')=='steer_pending']:
   if not active:continue
   try:
    prompt=compose_input(message.get('text',''),file_loader(message))
    api_call('runs/'+active['run']+'/steer',{'input':prompt})
    send_update({'id':message['id'],'status':'steered','answer':'Añadido a la tarea en curso.'})
   except urllib.error.HTTPError as error:
    if error.code not in (409,):raise
  if active:continue
  candidates=[item for item in items if item.get('status') in ('queued','steer_pending')]
  if not candidates:continue
  message=candidates[0]
  prompt=compose_input(message.get('text',''),file_loader(message))
  result=api_call('runs',{'input':prompt,'session_id':'apalas-dashboard-'+person.lower(),'instructions':INSTRUCTIONS.format(person=person)},'apalas-'+person+'-'+message['id'])
  run=result.get('run_id') or result.get('id')
  if not run:raise RuntimeError('Hermes did not return a run id')
  send_update({'id':message['id'],'status':'pending','run':run})


def main():
 if not API_KEY or not all(SERVICE_HEADERS.values()):raise RuntimeError('Apalas worker credentials are not configured')
 while True:
  try:process_messages(dashboard().get('messages',[]),hermes_api,update,download_files)
  except Exception as error:print('apalas-chat-worker:',type(error).__name__,flush=True)
  time.sleep(1)


if __name__=='__main__':main()
