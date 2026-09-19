import 'server-only';
import {getCloudflareContext} from '@opennextjs/cloudflare';

export type ChatStatus='queued'|'pending'|'steer_pending'|'steered'|'completed'|'failed'|'cancelled';
export type ChatMessage={id:string;person:'Dani'|'Cris';text:string;answer:string|null;status:ChatStatus;mode:'send'|'queue'|'steer';run?:string;created:number;files?:{id:string;name:string;type:string;size:number}[]};
type Submission={id:string;text:string;mode:'send'|'queue'|'steer';files:File[]};
const TERMINAL=new Set<ChatStatus>(['steered','completed','failed','cancelled']);

async function env(){const {env}=await getCloudflareContext({async:true});return env as any;}
function unpack(row:any):ChatMessage{return {id:row.id,person:row.person,text:row.text,answer:row.answer,status:row.status,mode:row.mode,...(row.run_id?{run:row.run_id}:{}),created:Date.parse(row.created_at)/1000};}
async function attach(e:any,message:ChatMessage){const rows=(await e.FAMILY_DB.prepare('SELECT id,filename,mime,bytes FROM family_chat_attachments WHERE message_id=? ORDER BY created_at').bind(message.id).all()).results;return {...message,files:rows.map((row:any)=>({id:row.id,name:row.filename,type:row.mime,size:row.bytes}))};}
export async function listChat(person:'Dani'|'Cris'){const e=await env(),rows=(await e.FAMILY_DB.prepare('SELECT id,person,text,answer,status,mode,created_at FROM (SELECT * FROM family_chat_messages WHERE person=? ORDER BY created_at DESC LIMIT 100) ORDER BY created_at').bind(person).all()).results;return Promise.all(rows.map((row:any)=>attach(e,unpack(row))));}
export async function submitChat(person:'Dani'|'Cris',submission:Submission){
 const e=await env(),now=new Date().toISOString(),existing=await e.FAMILY_DB.prepare('SELECT person FROM family_chat_messages WHERE id=?').bind(submission.id).first();
 if(existing){if(existing.person!==person)throw new Error('No se pudo enviar.');return;}
 const active=await e.FAMILY_DB.prepare("SELECT id FROM family_chat_messages WHERE person=? AND status='pending' LIMIT 1").bind(person).first();
 if(submission.mode==='send'&&active)throw new Error('Espera a que termine la respuesta anterior.');
 const status:ChatStatus=submission.mode==='steer'&&active?'steer_pending':'queued',text=submission.text.trim()||'Archivo adjunto';
 await e.FAMILY_DB.prepare('INSERT INTO family_chat_messages(id,person,text,status,mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(submission.id,person,text,status,submission.mode,now,now).run();
 for(const file of submission.files){const bytes=new Uint8Array(await file.arrayBuffer()),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource))).map(x=>x.toString(16).padStart(2,'0')).join(''),id=crypto.randomUUID(),key=`chat/${submission.id}/${hash}`,name=file.name.replace(/[^a-zA-Z0-9À-ÿ._ -]/g,'_').slice(0,180)||'archivo';await e.FAMILY_DOCUMENTS.put(key,bytes,{httpMetadata:{contentType:file.type}});await e.FAMILY_DB.prepare('INSERT INTO family_chat_attachments(id,message_id,filename,mime,object_key,bytes,sha256,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(message_id,sha256) DO NOTHING').bind(id,submission.id,name,file.type,key,bytes.length,hash,now).run();}
}
export async function workerSnapshot(){const e=await env(),rows=(await e.FAMILY_DB.prepare("SELECT * FROM family_chat_messages WHERE status IN ('queued','pending','steer_pending') ORDER BY created_at LIMIT 100").all()).results;return Promise.all(rows.map((row:any)=>attach(e,unpack(row))));}
export async function workerUpdate(raw:any){const allowed=new Set<ChatStatus>(['queued','pending','steered','completed','failed','cancelled']);if(!raw||typeof raw.id!=='string'||!allowed.has(raw.status))throw new Error('Actualización no válida.');const e=await env(),now=new Date().toISOString(),answer=typeof raw.answer==='string'?raw.answer:null,run=typeof raw.run==='string'?raw.run:null;const result=await e.FAMILY_DB.prepare('UPDATE family_chat_messages SET status=?,answer=COALESCE(?,answer),run_id=COALESCE(?,run_id),updated_at=? WHERE id=?').bind(raw.status,answer,run,now,raw.id).run();if(!result.meta.changes)throw new Error('Mensaje no encontrado.');}
export async function chatAttachment(id:string){const e=await env(),row=await e.FAMILY_DB.prepare('SELECT filename,mime,object_key FROM family_chat_attachments WHERE id=?').bind(id).first();if(!row)return null;const object=await e.FAMILY_DOCUMENTS.get(row.object_key);if(!object)return null;return {name:row.filename,type:row.mime,body:object.body};}
export function terminalStatus(status:ChatStatus){return TERMINAL.has(status);}
