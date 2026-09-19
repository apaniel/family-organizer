'use client';
import {useEffect,useRef,useState} from 'react';
import {MessageCircle,Send} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import './family-chat.css';
import {updateChatProgress} from './dashboard-refresh';

type Message={id:string;text:string;answer:string|null;status:string;created:number};

function elapsedLabel(seconds:number){
 if(seconds<60)return `${seconds} s`;
 const minutes=Math.floor(seconds/60),rest=seconds%60;
 return rest?`${minutes} min ${rest} s`:`${minutes} min`;
}

export default function FamilyChat(){
 const [open,setOpen]=useState(false),[person,setPerson]=useState(''),[messages,setMessages]=useState<Message[]>([]),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[now,setNow]=useState(()=>Date.now()),[lastCheck,setLastCheck]=useState<number|null>(null);
 const previous=useRef<Message[]>([]);
 function accept(next:Message[]){updateChatProgress(previous.current,next);previous.current=next;setMessages(next);}
 useEffect(()=>{setOpen(sessionStorage.getItem('apalas-chat-open')==='true');setText(sessionStorage.getItem('apalas-chat-draft')||'');},[]);
 const bottom=useRef<HTMLDivElement>(null),requestId=useRef<string|null>(null);
 const pending=messages.some(m=>m.status==='pending');
 async function load(){try{const r=await fetch('/api/family/chat',{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error);accept(d.messages);setPerson(d.person);setLastCheck(Date.now());setError('');}catch(e){setError(e instanceof Error?e.message:'No se pudo conectar.');}}
 useEffect(()=>{if(!open&&!pending)return;void load();const timer=setInterval(()=>{if(document.visibilityState==='visible')void load();},pending?2000:4000);return()=>clearInterval(timer);},[open,pending]);
 useEffect(()=>{if(!pending)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[pending]);
 useEffect(()=>{bottom.current?.scrollIntoView({behavior:'smooth'});},[messages.length,messages[messages.length-1]?.status,open]);
 async function send(){if(!text.trim()||busy||pending)return;setBusy(true);setError('');requestId.current ||= crypto.randomUUID();try{const r=await fetch('/api/family/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,id:requestId.current})});const d=await r.json();if(!r.ok)throw new Error(d.error);accept(d.messages);setPerson(d.person);setLastCheck(Date.now());setText('');sessionStorage.removeItem('apalas-chat-draft');requestId.current=null;}catch(e){setError(e instanceof Error?e.message:'No se pudo enviar.');}finally{setBusy(false);}}
 function pendingState(message:Message){
  const elapsed=Math.max(0,Math.floor((now-message.created*1000)/1000));
  const connectionLost=lastCheck!==null&&now-lastCheck>8000;
  const label=connectionLost?'No puedo confirmar el estado ahora':elapsed>=120?'Sigue abierta, pero está tardando más de lo normal':elapsed>=30?'Rufus sigue trabajando':'Rufus está trabajando';
  return <div className={`fc-wait${connectionLost?' fc-wait-stale':''}`} role="status"><span className="fc-pulse" aria-hidden="true"><i/><i/><i/></span><span>{label} · {elapsedLabel(elapsed)}</span></div>;
 }
 return <><button className="fc-launch" onClick={()=>{setOpen(true);sessionStorage.setItem('apalas-chat-open','true');}}><MessageCircle size={21}/> Hablar con Rufus</button><Dialog open={open} onOpenChange={v=>{setOpen(v);sessionStorage.setItem('apalas-chat-open',String(v));}}><DialogContent className="fc-panel"><header className="fc-header"><span className="fc-avatar">R</span><div><DialogTitle>Rufus · Familia</DialogTitle><DialogDescription>{person?`Estás hablando como ${person}`:'Tu asistente familiar'}</DialogDescription></div></header><div className="fc-history" role="log" aria-live="polite">{!messages.length&&!error&&<div className="fc-welcome"><h3>Un poco menos en tu cabeza.</h3><p>Planes, comidas, calendario y todo lo de las peques.</p><div>{['¿Qué tenemos mañana?','Dame ideas para el fin de semana','Ayúdame con las cenas'].map(t=><button key={t} onClick={()=>setText(t)}>{t}</button>)}</div></div>}{messages.map(m=>{const stopped=m.status==='failed'||m.status==='cancelled';return <div key={m.id} className="fc-exchange"><div className="fc-bubble fc-you">{m.text}</div>{m.answer&&<div className={`fc-bubble fc-rufus${stopped?' fc-failed':''}`}>{m.answer}</div>}{m.status==='pending'&&pendingState(m)}{stopped&&<div className="fc-run-ended" role="status">La tarea se ha detenido.</div>}</div>;})}<div ref={bottom}/></div>{error&&<p className="fc-error" role="alert">{error}</p>}<form className="fc-compose" onSubmit={e=>{e.preventDefault();void send();}}><textarea aria-label="Mensaje para Rufus" placeholder="Cuéntame, ¿qué necesitas?" value={text} maxLength={4000} rows={2} onChange={e=>{setText(e.target.value);sessionStorage.setItem('apalas-chat-draft',e.target.value);requestId.current=null;}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/><button type="submit" disabled={busy||pending||!text.trim()} aria-label="Enviar mensaje"><Send size={20}/></button></form><p className="fc-footnote">Conversación de {person||'tu cuenta'} · Calendario y tareas compartidos</p></DialogContent></Dialog></>;
}
