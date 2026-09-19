'use client';
import {ChangeEvent,useEffect,useRef,useState} from 'react';
import {ListPlus,MessageCircle,Paperclip,Send,Sparkles,X} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import './family-chat.css';
import {updateChatProgress} from './dashboard-refresh';

type Message={id:string;text:string;answer:string|null;status:string;created:number};
type SendMode='send'|'queue'|'steer';
const MAX_FILE=25*1024*1024,MAX_TOTAL=50*1024*1024,MAX_FILES=5;

function elapsedLabel(seconds:number){
 if(seconds<60)return `${seconds} s`;
 const minutes=Math.floor(seconds/60),rest=seconds%60;
 return rest?`${minutes} min ${rest} s`:`${minutes} min`;
}

export default function FamilyChat(){
 const [open,setOpen]=useState(false),[person,setPerson]=useState(''),[messages,setMessages]=useState<Message[]>([]),[text,setText]=useState(''),[files,setFiles]=useState<File[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[now,setNow]=useState(()=>Date.now()),[lastCheck,setLastCheck]=useState<number|null>(null);
 const previous=useRef<Message[]>([]),fileInput=useRef<HTMLInputElement>(null);
 function accept(next:Message[]){updateChatProgress(previous.current,next);previous.current=next;setMessages(next);}
 useEffect(()=>{setOpen(sessionStorage.getItem('apalas-chat-open')==='true');setText(sessionStorage.getItem('apalas-chat-draft')||'');},[]);
 const bottom=useRef<HTMLDivElement>(null),requestId=useRef<string|null>(null);
 const pending=messages.some(m=>m.status==='pending'),canSend=Boolean(text.trim()||files.length);
 async function load(){try{const r=await fetch('/api/family/chat',{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error);accept(d.messages);setPerson(d.person);setLastCheck(Date.now());setError('');}catch(e){setError(e instanceof Error?e.message:'No se pudo conectar.');}}
 useEffect(()=>{if(!open&&!pending)return;void load();const timer=setInterval(()=>{if(document.visibilityState==='visible')void load();},pending?2000:4000);return()=>clearInterval(timer);},[open,pending]);
 useEffect(()=>{if(!pending)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[pending]);
 useEffect(()=>{bottom.current?.scrollIntoView({behavior:'smooth'});},[messages.length,messages[messages.length-1]?.status,open]);
 function chooseFiles(event:ChangeEvent<HTMLInputElement>){
  const next=[...files,...Array.from(event.target.files||[])].slice(0,MAX_FILES),total=next.reduce((sum,file)=>sum+file.size,0);
  event.target.value='';
  if(next.some(file=>file.size>MAX_FILE)||total>MAX_TOTAL){setError('Máximo 25 MB por archivo y 50 MB en total.');return;}
  setFiles(next);setError('');requestId.current=null;
 }
 async function send(mode:SendMode=pending?'queue':'send'){
  if(!canSend||busy)return;
  setBusy(true);setError('');requestId.current ||= crypto.randomUUID();
  try{
   const form=new FormData();form.set('text',text);form.set('id',requestId.current);form.set('mode',mode);for(const file of files)form.append('files',file,file.name);
   const r=await fetch('/api/family/chat',{method:'POST',body:form}),d=await r.json();if(!r.ok)throw new Error(d.error);
   accept(d.messages);setPerson(d.person);setLastCheck(Date.now());setText('');setFiles([]);sessionStorage.removeItem('apalas-chat-draft');requestId.current=null;
  }catch(e){setError(e instanceof Error?e.message:'No se pudo enviar.');}finally{setBusy(false);}
 }
 function pendingState(message:Message){
  const elapsed=Math.max(0,Math.floor((now-message.created*1000)/1000)),connectionLost=lastCheck!==null&&now-lastCheck>8000;
  const label=connectionLost?'No puedo confirmar el estado ahora':elapsed>=120?'Sigue abierta, pero está tardando más de lo normal':elapsed>=30?'Rufus sigue trabajando':'Rufus está trabajando';
  return <div className={`fc-wait${connectionLost?' fc-wait-stale':''}`} role="status"><span className="fc-pulse" aria-hidden="true"><i/><i/><i/></span><span>{label} · {elapsedLabel(elapsed)}</span></div>;
 }
 return <><button className="fc-launch" onClick={()=>{setOpen(true);sessionStorage.setItem('apalas-chat-open','true');}}><MessageCircle size={21}/> Hablar con Rufus</button><Dialog open={open} onOpenChange={value=>{setOpen(value);sessionStorage.setItem('apalas-chat-open',String(value));}}><DialogContent className="fc-panel"><header className="fc-header"><span className="fc-avatar">R</span><div><DialogTitle>Rufus · Familia</DialogTitle><DialogDescription>{person?`Estás hablando como ${person}`:'Tu asistente familiar'}</DialogDescription></div></header><div className="fc-history" role="log" aria-live="polite">{!messages.length&&!error&&<div className="fc-welcome"><h3>Un poco menos en tu cabeza.</h3><p>Planes, comidas, calendario y todo lo de las peques.</p><div>{['¿Qué tenemos mañana?','Dame ideas para el fin de semana','Ayúdame con las cenas'].map(item=><button key={item} onClick={()=>setText(item)}>{item}</button>)}</div></div>}{messages.map(message=>{const stopped=message.status==='failed'||message.status==='cancelled';return <div key={message.id} className="fc-exchange"><div className="fc-bubble fc-you">{message.text}</div>{message.answer&&<div className={`fc-bubble fc-rufus${stopped?' fc-failed':''}`}>{message.answer}</div>}{message.status==='pending'&&pendingState(message)}{message.status==='queued'&&<div className="fc-queued"><ListPlus size={14}/> En cola</div>}{message.status==='steered'&&<div className="fc-steered"><Sparkles size={14}/> Aplicado a la tarea en curso</div>}{stopped&&<div className="fc-run-ended" role="status">La tarea se ha detenido.</div>}</div>;})}<div ref={bottom}/></div>{error&&<p className="fc-error" role="alert">{error}</p>}<form className="fc-compose" onSubmit={event=>{event.preventDefault();void send();}}><div className="fc-input-row"><button className="fc-attach" type="button" onClick={()=>fileInput.current?.click()} disabled={busy} aria-label="Adjuntar archivos"><Paperclip size={19}/></button><input ref={fileInput} className="fc-file-input" type="file" multiple accept="image/*,audio/*,video/*,.pdf,.txt,.csv,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.rtf,.zip" onChange={chooseFiles}/><textarea aria-label="Mensaje para Rufus" placeholder={pending?'Añade algo a la tarea o déjalo en cola…':'Cuéntame, ¿qué necesitas?'} value={text} maxLength={4000} rows={2} onChange={event=>{setText(event.target.value);sessionStorage.setItem('apalas-chat-draft',event.target.value);requestId.current=null;}} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send();}}}/>{!pending&&<button className="fc-send" type="submit" disabled={busy||!canSend} aria-label="Enviar mensaje"><Send size={20}/></button>}</div>{files.length>0&&<div className="fc-files">{files.map((file,index)=><span key={`${file.name}-${index}`}>{file.name}<button type="button" aria-label={`Quitar ${file.name}`} onClick={()=>{setFiles(current=>current.filter((_,item)=>item!==index));requestId.current=null;}}><X size={13}/></button></span>)}</div>}{pending&&<div className="fc-pending-actions"><button type="button" disabled={busy||!canSend} onClick={()=>void send('queue')}><ListPlus size={16}/> Encolar</button><button type="button" disabled={busy||!canSend} onClick={()=>void send('steer')}><Sparkles size={16}/> Aplicar ahora</button></div>}</form><p className="fc-footnote">Conversación de {person||'tu cuenta'} · Calendario y tareas compartidos</p></DialogContent></Dialog></>;
}
