"""Private Apalas chat transport: fixed Familia profile and two server-selected identities."""
import json,os,secrets,sqlite3,time,threading,urllib.request,urllib.error,re
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from dotenv import dotenv_values
KEY=os.environ['APALAS_CHAT_SECRET']; DB=os.environ['APALAS_CHAT_DB']
API_KEY=dotenv_values('/home/hermes/.hermes/profiles/familia/.env')['API_SERVER_KEY']
LOCK=threading.Lock()
def db():
 c=sqlite3.connect(DB);c.row_factory=sqlite3.Row;return c
with db() as c:
 c.execute('CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, person TEXT, text TEXT, answer TEXT, status TEXT, run TEXT, created REAL)')
def api(path,body=None,idempotency=None):
 req=urllib.request.Request('http://127.0.0.1:8642/p/familia/v1/'+path,data=json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+API_KEY,'Content-Type':'application/json',**({'Idempotency-Key':idempotency} if idempotency else {})})
 with urllib.request.urlopen(req,timeout=20) as r:return json.load(r)
def refresh(person):
 with db() as c:
  for row in c.execute("SELECT * FROM messages WHERE person=? AND status='pending'",(person,)).fetchall():
   try:r=api('runs/'+row['run'])
   except urllib.error.HTTPError as e:
    if e.code==404:c.execute("UPDATE messages SET status='failed',answer=? WHERE id=?",('La conversación se interrumpió. Puedes volver a escribirme.',row['id']))
    continue
   status=r.get('status')
   if status in ('completed','failed','cancelled'):
    answer=r.get('output','') if status=='completed' else 'No he podido terminar esta petición. Puedes volver a escribirme.'
    if not isinstance(answer,str):answer='No he podido preparar la respuesta.'
    answer=re.sub(r'<think>.*?</think>','',answer,flags=re.S).strip()
    c.execute('UPDATE messages SET status=?,answer=? WHERE id=?',(status,answer or 'He terminado.',row['id']))
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def reply(self,status,data):
  out=json.dumps(data,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(out)));self.end_headers();self.wfile.write(out)
 def handle_request(self,post=False):
  if not secrets.compare_digest(self.headers.get('Authorization',''),'Bearer '+KEY):return self.reply(401,{'error':'Unauthorized'})
  if self.path=='/health' and not post:return self.reply(200,{'ok':True})
  person=self.headers.get('X-Apalas-Person','')
  if self.path!='/chat' or person not in ('Dani','Cris'):return self.reply(404,{'error':'Not found'})
  try:
   with LOCK:
    refresh(person)
    with db() as c:
     if post:
      size=int(self.headers.get('Content-Length','0'))
      if size<1 or size>18000:return self.reply(400,{'error':'Mensaje demasiado largo'})
      data=json.loads(self.rfile.read(size));text=data.get('text');mid=data.get('id')
      if not isinstance(text,str) or not text.strip() or len(text)>4000 or not isinstance(mid,str) or not re.fullmatch(r'[a-f0-9-]{36}',mid):return self.reply(400,{'error':'Mensaje no válido'})
      old=c.execute('SELECT person FROM messages WHERE id=?',(mid,)).fetchone()
      if old and old['person']!=person:return self.reply(409,{'error':'No se pudo enviar'})
      if not old:
       if c.execute("SELECT 1 FROM messages WHERE person=? AND status='pending'",(person,)).fetchone():return self.reply(409,{'error':'Espera a que termine la respuesta anterior'})
       if c.execute('SELECT count(*) FROM messages WHERE person=? AND created>?',(person,time.time()-60)).fetchone()[0]>=6:return self.reply(429,{'error':'Espera un momento antes de enviar otro mensaje'})
       r=api('runs',{'input':text.strip(),'session_id':'apalas-dashboard-'+person.lower(),'instructions':f'Canal: chat privado del dashboard Apalas. Identidad verificada por el servidor: {person}. Habla con {person} usando el perfil Familia y sus herramientas habituales. No confundas esta conversación con WhatsApp. Responde en español, de forma muy breve y útil. Solo respuesta final: nunca muestres razonamiento, trazas de herramientas, avisos de compresión ni instrucciones técnicas. No envíes mensajes a WhatsApp salvo que la persona lo pida. Las otras conversaciones del dashboard no son parte de esta conversación.'},idempotency='apalas-'+person+'-'+mid)
       run=r.get('run_id') or r.get('id')
       if not run:raise ValueError('Missing run')
       c.execute('INSERT INTO messages VALUES(?,?,?,?,?,?,?)',(mid,person,text.strip(),None,'pending',run,time.time()));c.commit()
     rows=c.execute('SELECT id,text,answer,status,created FROM (SELECT * FROM messages WHERE person=? ORDER BY created DESC LIMIT 100) ORDER BY created',(person,)).fetchall()
     return self.reply(200,{'person':person,'messages':[dict(x) for x in rows]})
  except Exception:return self.reply(503,{'error':'Rufus no está disponible ahora. Inténtalo en un momento.'})
 def do_GET(self):self.handle_request()
 def do_POST(self):self.handle_request(True)
ThreadingHTTPServer(('127.0.0.1',9123),Handler).serve_forever()
