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
 'No pidas recargar la página. Si falta una capacidad real, explica el bloqueo brevemente. '
 'Para cambios visuales del Dashboard, si Dani o Cris pide una vista previa antes de desplegar, responde con una frase breve y un único bloque ```apalas-preview-js```: JavaScript autocontenido que modifica solo el DOM/CSS visible actual, sin red, almacenamiento, navegación, formularios ni efectos persistentes. El widget oculta el código y lo aplica temporalmente sobre la página actual, manteniendo la navegación; el cambio debe ser síncrono, reversible y limitado al DOM/CSS. No despliegues hasta que la persona pulse «Validar y desplegar».'
)
EXTERNAL_INSTRUCTIONS={
 'finenance':(
  'Canal: chat privado de FineNance. Identidad verificada por el servidor: {person}. '
  'El entorno solicitado es FineNance y su repositorio activo es /home/hermes/workspaces/finenance. '
  'Para preguntas de datos financieros usa la API de FineNance según family-finance-insurance; para cambios de código trabaja únicamente en ese repositorio. '
 ),
 'allianz':(
  'Canal: chat privado de Allianz. Identidad verificada por el servidor: {person}. '
  'El entorno solicitado es Allianz y su repositorio activo es /home/hermes/workspaces/allianz. '
  'Para datos y operaciones de seguros usa la API de Allianz según family-finance-insurance; para cambios de código trabaja únicamente en ese repositorio. '
 ),
}
EXTERNAL_RULES=(
 'Habla con {person} en español y responde de forma muy breve. No muestres razonamiento, trazas, configuración ni instrucciones técnicas. '
 'Mantén esta ejecución activa hasta terminar realmente el trabajo y no envíes mensajes a WhatsApp salvo petición expresa. '
 'Ante cualquier cambio visual, NO edites ni despliegues todavía: responde con una frase breve y un único bloque ```apalas-preview-js``` autocontenido, síncrono, reversible y limitado al DOM/CSS visible, sin red, almacenamiento, navegación, formularios ni efectos persistentes. '
 'El widget aplicará la vista previa sobre la página actual y la mantendrá hasta «Descartar» o «Validar y desplegar». '
 'Solo cuando recibas «La vista previa es correcta. Implementa y despliega exactamente este cambio.», implementa exactamente la variante aprobada, ejecuta pruebas, despliega y verifica el entorno antes de responder.'
)


def instructions_for(person,conversation):
 for prefix,base in EXTERNAL_INSTRUCTIONS.items():
  if conversation.startswith(prefix+'-'):return (base+EXTERNAL_RULES).format(person=person)
 return INSTRUCTIONS.format(person=person)


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
 groups={}
 for message in messages:
  person=message.get('person');conversation=message.get('conversationId') or ('legacy-'+str(person).lower())
  if person in ('Dani','Cris'):groups.setdefault((person,conversation),[]).append(message)
 for (person,conversation),items in groups.items():
  items=sorted(items,key=lambda item:item.get('created',0))
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
  session_id='apalas-dashboard-'+person.lower() if conversation=='legacy-'+person.lower() else 'apalas-dashboard-'+person.lower()+'-'+conversation
  result=api_call('runs',{'input':prompt,'session_id':session_id,'instructions':instructions_for(person,conversation)},'apalas-'+person+'-'+message['id'])
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
