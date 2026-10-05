"""Bounded subprocess boundary for the existing scoped API helper."""
import importlib.util,json,sys,os
from pathlib import Path
if __name__=='__main__':
 # Only this bounded child selects the existing helper scope; no profile writes.
 os.environ['HERMES_HOME']='/home/hermes/.hermes/profiles/familia'
 spec=importlib.util.spec_from_file_location('family_mission',Path(__file__).parents[1]/'familia'/'family_mission.py')
 helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
 print(json.dumps(helper.request(sys.argv[1],sys.argv[2],json.load(sys.stdin))))
