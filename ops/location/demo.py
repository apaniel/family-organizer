#!/usr/bin/env python3
"""Offline executable example: mock broker + canonical reader + private sender."""
import json,tempfile
from pathlib import Path
from runner import Engine,cycle,target_key

def main():
 now=1791187200
 place={'id':'demo-place','revision':1,'name':'Tienda','latitude':0,'longitude':0,'radius':100,'person':'Dani','timezone':'Europe/Madrid'}
 rule={'id':'demo-rule','revision':1,'placeId':place['id'],'person':'Dani','target':{'kind':'task','id':'google-task-demo','listId':'google-list-demo'},'mode':'arrival','enabled':True,'confirmedAt':'offline-consent-only','recurring':False,'expires':'2026-10-05'}
 sent=[];states=[]
 with tempfile.TemporaryDirectory() as directory:
  e=Engine(Path(directory)/'state.sqlite')
  try:
   for distance,offset in [(300,0),(20,60),(20,120)]:
    def broker(person,tz):return {'person':person,'timezone':tz,'version':1,'recorded_at':now+offset,'received_at':now+offset,'latitude':distance/111195,'longitude':0,'accuracy':5}
    cycle(e,lambda:{'places':[place],'links':[rule]},broker,lambda:{target_key(rule['target']):{'status':'open','title':'Comprar pan'}},lambda destination,message,key:sent.append({'destination':destination,'message':message,'idempotencyKey':key}),now+offset,True,states.append)
  finally:e.close()
 assert len(sent)==1
 print(json.dumps({'offline':True,'notifications':sent,'finalState':states[-1]['items'][0]['state'],'canonicalTaskStatus':'open'},ensure_ascii=False))
if __name__=='__main__':main()
