#!/usr/bin/env python3
"""Administrator-only Google Calendar authorization, separate from Gmail."""
import argparse,json,os,sys
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from google_auth_oauthlib.flow import Flow
from google.oauth2.id_token import verify_oauth2_token
from google.auth.transport.requests import Request
os.umask(0o077)
os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"]="1"
ROOT=Path('/var/lib/hermes-calendar')
SCOPES=['openid','https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/calendar.events.owned']
def save(p,data):
 t=p.with_suffix('.tmp');t.write_text(json.dumps(data));t.chmod(0o600);t.replace(p)
def main():
 p=argparse.ArgumentParser();p.add_argument('action',choices=['auth-url','complete']);a=p.parse_args()
 ROOT.mkdir(mode=0o700,exist_ok=True)
 client=ROOT/'client.json';pending=ROOT/'pending.json'
 if a.action=='auth-url':
  flow=Flow.from_client_secrets_file(str(client),scopes=SCOPES,redirect_uri='http://localhost:1',autogenerate_code_verifier=True)
  url,state=flow.authorization_url(access_type='offline',prompt='consent',login_hint='losapalas@gmail.com',include_granted_scopes='false')
  save(pending,{'state':state,'verifier':flow.code_verifier});print(url);return
 callback=sys.stdin.read().strip();u=urlparse(callback);q=parse_qs(u.query);data=json.loads(pending.read_text())
 if u.scheme!='http' or u.hostname!='localhost' or u.port!=1 or q.get('state')!=[data['state']] or not q.get('code'):raise ValueError('Invalid callback')
 flow=Flow.from_client_secrets_file(str(client),scopes=SCOPES,redirect_uri='http://localhost:1',state=data['state'],code_verifier=data['verifier'])
 flow.fetch_token(code=q['code'][0])
 granted=flow.oauth2session.token.get('scope',[])
 if isinstance(granted,str):granted=granted.split()
 if set("https://www.googleapis.com/auth/userinfo.email" if x=="email" else x for x in granted)!=set(SCOPES):raise ValueError('Unexpected permissions')
 cfg=json.loads(client.read_text());cfg=cfg.get('installed',cfg.get('web'))
 identity=verify_oauth2_token(flow.oauth2session.token['id_token'],Request(),cfg['client_id'])
 if identity.get('email')!='losapalas@gmail.com' or not identity.get('email_verified'):raise ValueError('Wrong Google account')
 if not flow.credentials.refresh_token:raise ValueError('Offline authorization missing')
 save(ROOT/'token.json',json.loads(flow.credentials.to_json()));pending.unlink();print('Family Calendar authorization saved.')
if __name__=='__main__':
 try:main()
 except Exception as e:print(str(e) if isinstance(e,ValueError) else 'Calendar authorization failed; credentials were not saved.',file=sys.stderr);sys.exit(1)
