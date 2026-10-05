"""Explicit offline subprocess fixtures; never imports credentials or contacts services."""
import json,sys,time
from runner import PERSONS
if __name__=='__main__':
 data=json.load(open(sys.argv[1]));kind,key=sys.argv[2:4]
 if kind=='broker':
  f=data['fixes'].get(key)
  result={'ok':True,'person':PERSONS[key],'location':None if not f else {'lat':f['latitude'],'lon':f['longitude'],'h_acc':f['accuracy'],'ts':f['recorded_at'],'received_at':f['received_at']}}
 elif key=='locations':result=data['metadata']
 elif key=='records' or key.startswith('calendar?'):
  records=[]
  for identity,value in data['statuses'].items():
   t=json.loads(identity);v=value if isinstance(value,dict) else {'status':value,'title':'Offline target'}
   records.append({'kind':t[0],'id':t[-1],**({'googleTaskListId':t[1]} if t[0]=='task' else {}),**v})
  result={'records':records,'events':[r for r in records if r['kind']=='event'],'taskAvailable':True,'taskRefreshedAt':time.time()}
 elif key=='location-attention':json.load(sys.stdin);result={'ok':True}
 else:raise ValueError('Unsupported offline fixture request')
 print(json.dumps(result))
