import os,sys,json
from pathlib import Path
home='/home/hermes/.hermes/profiles/familia'
os.environ['HERMES_HOME']=home
sys.path.insert(0,'/home/hermes/.hermes/hermes-agent')
from cron.jobs import create_job,list_jobs
from hermes_time import get_timezone
assert str(get_timezone())=='Europe/Madrid',str(get_timezone())
base='Use the family-mission-control skill. Work only in familia. Read the shared planner with family_mission.py and preserve household permissions. '
jobs=[
 ('Apalas — resumen de la mañana','0 8 * * *',base+'Prepare a very brief Spanish morning summary for Dani and Cris in Apalas, using current reminders and calendar. Maximum 4 short bullets. Focus on today and preparation whose lead time has arrived. Do not repeat individual reminders already covered by existing hermes-cron records. If nothing actionable, output exactly [SILENT]. Do not call a messaging tool: your final text is delivered automatically. No technical output.'),
 ('Apalas — preparar mañana','0 20 * * *',base+'Read current records and the calendar. Prepare a very brief Spanish note for tomorrow: assigned tasks, confirmed backpack checklists, and confirmed meals. Maximum 4 short bullets. Never invent missing materials or menus. If there is nothing useful for tomorrow, output exactly [SILENT]. Do not call a messaging tool: your final text is delivered automatically. No technical output.'),
 ('Apalas — actualizar el plan desde correo','0 7,13,19 * * *',base+'Read only relevant recent family emails from losapalas through the existing restricted mail client. Search the last 3 days for school notices, appointments, orders/returns and deadlines; inspect at most 10 relevant messages per run. Read planner records first, deduplicate, and save confirmed facts or explicitly unconfirmed proposals with source references and stable sourceKey. No personal mailbox access. Do not send messages or place orders. Do not invent dates. If authorization fails, stop reading mail and record the blocker locally without pretending success. Return a concise local summary; this job is not delivered to WhatsApp.')]
existing={j['name']:j for j in list_jobs(include_disabled=True)}
for name,schedule,prompt in jobs:
 if name in existing:print(json.dumps({'name':name,'existing':existing[name]['id']}));continue
 job=create_job(prompt=prompt,schedule=schedule,name=name,skills=['family-mission-control'],deliver='local' if 'correo' in name else 'whatsapp:120363411293061762@g.us',workdir=home)
 print(json.dumps({'name':name,'id':job['id'],'next':job['next_run_at']}))
p=Path(home+'/SOUL.md');s=p.read_text()
marker='## Shared family planner'
if marker not in s:
 p.write_text(s+'\n\n'+marker+'\nFor family plans, school preparation, menus, important dates and follow-up, load the family-mission-control skill and keep https://apalas.apaniel.dev updated through its helper. Save relevant confirmed WhatsApp inputs with their source and stable deduplication key. Use proposals for uncertainty. Preserve all existing group and sender permissions. Planner records are shared with Dani and Cris; do not copy personal mailbox contents into them.\n')
