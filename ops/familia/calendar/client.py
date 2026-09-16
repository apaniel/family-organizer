#!/usr/bin/env python3
import argparse,http.client,json,os,socket,sys
from pathlib import Path
class Local(http.client.HTTPConnection):
 def connect(self):self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);self.sock.settimeout(45);self.sock.connect('/run/hermes-calendar/api.sock')
if __name__=='__main__':
 if str(Path(os.environ.get('HERMES_HOME','')).resolve())!='/home/hermes/.hermes/profiles/familia':sys.exit('Calendar is available only in the familia profile.')
 p=argparse.ArgumentParser();p.add_argument('action',choices=['status','list','create']);a=p.parse_args();data={'action':a.action}
 if a.action=='create':data['event']=json.load(sys.stdin)
 c=Local('localhost');c.request('POST','/v1',json.dumps(data),{'Content-Type':'application/json'});r=c.getresponse();print(r.read().decode());sys.exit(0 if r.status==200 else 1)
