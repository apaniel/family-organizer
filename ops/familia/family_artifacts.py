#!/usr/bin/env python3
"""Publish private self-contained family artifacts through the family service."""
import argparse,json,sys,re
from pathlib import Path
from family_mission import request

def main():
 p=argparse.ArgumentParser();sub=p.add_subparsers(dest='action',required=True)
 s=sub.add_parser('publish');s.add_argument('file');s.add_argument('--title',required=True)
 sub.add_parser('list');s=sub.add_parser('delete');s.add_argument('id')
 a=p.parse_args()
 if a.action=='publish':
  f=Path(a.file)
  if f.stat().st_size>500000:raise ValueError('HTML exceeds 500 KB')
  result=request('artifacts','POST',{'title':a.title,'html':f.read_text()})
 elif a.action=='list':result=request('artifacts')
 else:
  if not re.fullmatch('[a-f0-9]{64}',a.id):raise ValueError('Invalid artifact ID')
  result=request('artifacts?id='+a.id,'DELETE')
 print(json.dumps(result,ensure_ascii=False))
if __name__=='__main__':
 try:main()
 except Exception:print(json.dumps({'error':'Artifact operation failed. No success confirmed.'}));sys.exit(1)
