import 'server-only';
import {isInternalRecord} from './record-namespaces';
import {getCloudflareContext} from '@opennextjs/cloudflare';
import {validateRecord,type FamilyRecord} from './model';

export class FlattenInputError extends Error {}
export class FlattenConflict extends Error {
 constructor(){super('Esta tarea ha cambiado. Vuelve a obtener una vista previa.');}
}
const invalid=(message='Solicitud de migración no válida.')=>new FlattenInputError(message);
export async function flattenRecord(raw:any){
 if(isInternalRecord(raw))throw invalid('Este registro pertenece a un espacio reservado.');
 if(!raw||typeof raw.id!=='string'||!raw.id.trim()||raw.id.length>200||!Number.isSafeInteger(raw.revision)||raw.revision<1||typeof raw.confirm!=='boolean'||typeof raw.localToday!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(raw.localToday)||!Number.isFinite(Date.parse(raw.localToday))||new Date(raw.localToday+'T12:00:00Z').toISOString().slice(0,10)!==raw.localToday)throw invalid();
 const {env}=await getCloudflareContext({async:true});
 const db=(env as any).FAMILY_DB;
 const old=await db.prepare('SELECT * FROM family_records WHERE id=?').bind(raw.id).first();
 if(!old||old.revision!==raw.revision)throw new FlattenConflict();
 const original:FamilyRecord={...JSON.parse(old.data),id:old.id,revision:old.revision,updatedAt:old.updated_at};
 if(old.kind!=='task'||original.kind!=='task'||original.readOnly||isInternalRecord(old)||isInternalRecord(original)||!Array.isArray(original.checklist)||!original.checklist.length)throw invalid('Esta tarea no admite migración de lista.');
 const children:FamilyRecord[]=[];
 const history:string[]=[];
 let checked=0;
 for(const [index,item] of Array.from(original.checklist.entries())){
  if(!item||typeof item.text!=='string'||!item.text.trim()||typeof item.done!=='boolean')throw invalid('La lista antigua contiene un elemento no válido.');
  if(item.done){checked++;history.push(`Hecho (histórico): ${item.text}`);continue;}
  const prefix=/^(Dani|Cris|Saida|Familia)(?:\s*[:,.;—–-]\s*|\s+)/.exec(item.text);
  const title=prefix?item.text.slice(prefix[0].length):item.text;
  const sourceKey=`flatten:${original.id}:${original.revision}:${index}`;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sourceKey));
  const id='flatten-'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  let value;
  try{value=validateRecord({kind:'task',title,date:original.status==='done'?raw.localToday:original.date,owner:prefix?.[1]||original.owner,category:original.category,source:original.source,sourceKey,audience:original.audience,confirmed:original.confirmed,reminderDays:original.reminderDays,status:'open',recurrence:'none',checklist:[],notes:`Acción pendiente de «${original.title}» (registro ${original.id}).`});}catch{throw invalid('Revisa el título y la fecha de los elementos pendientes.');}
  children.push({...value,id,revision:1});
  history.push(`Movido a tarea abierta: ${item.text} (registro ${id}).`);
 }
 const notes=[original.notes,'Historial de lista antigua:\n'+history.join('\n')].filter(Boolean).join('\n\n');
 if(notes.length>5000)throw invalid('No hay espacio para conservar el historial en las notas. Reduce las notas antes de migrar.');
 const record={...original,checklist:[],notes};
 const counts={created:children.length,checked,moved:children.length};
 if(!raw.confirm)return {dryRun:true,record,children,counts};
 const now=new Date().toISOString();
 const {id,revision,updatedAt,...data}=record;
 const serialized=JSON.stringify(data);
 // SQL constraints make a stale/missing parent fail INSIDE the D1 transaction.
 // No connection-local changes(), temp tables, or interactive transactions.
 const statements=[
  db.prepare('UPDATE family_records SET data=CASE WHEN revision=? AND data=? THEN ? ELSE NULL END,revision=revision+1,updated_at=? WHERE id=?').bind(revision,old.data,serialized,now,id),
  db.prepare("INSERT INTO family_audit(record_id,action,before_data,after_data,occurred_at) VALUES((SELECT id FROM family_records WHERE id=? AND revision=? AND data=?),'flatten',?,?,?)").bind(id,revision+1,serialized,old.data,serialized,now)
 ];
 for(const child of children){
  const {id:childId,revision:childRevision,updatedAt:childUpdated,...childData}=child;
  const json=JSON.stringify(childData);
  statements.push(
   db.prepare('INSERT INTO family_records(id,kind,data,source_key,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(childId,'task',json,child.sourceKey,now,now),
   db.prepare("INSERT INTO family_audit(record_id,action,after_data,occurred_at) VALUES(?,'create',?,?)").bind(childId,json,now)
  );
 }
 try{await db.batch(statements);}catch(error){
  const current=await db.prepare('SELECT * FROM family_records WHERE id=?').bind(id).first();
  if(!current||current.revision!==revision||current.data!==old.data)throw new FlattenConflict();
  throw error;
 }
 return {dryRun:false,record:{...record,revision:revision+1,updatedAt:now},children:children.map(child=>({...child,updatedAt:now})),counts};
}
