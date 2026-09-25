import 'server-only';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { occursOn, validateRecord, type FamilyRecord } from './model';
async function database():Promise<any> { const {env}=await getCloudflareContext({async:true});const db=(env as any).FAMILY_DB;if(!db)throw new Error('Family storage unavailable');return db; }
function unpack(row:any):FamilyRecord { return {...JSON.parse(row.data),id:row.id,revision:row.revision,updatedAt:row.updated_at}; }
export async function readRecords() { const db=await database();const result=await db.prepare("SELECT * FROM family_records WHERE source_key IS NULL OR (source_key NOT LIKE 'approval:%' AND source_key NOT LIKE 'capability:%' AND source_key NOT LIKE 'chat-conversation:%' AND source_key NOT LIKE 'chat-thread:%') ORDER BY updated_at DESC LIMIT 3000").all();return result.results.map(unpack) as FamilyRecord[]; }
export type CompletionProvenance={mode:'explicit'|'inferred';channel:'dashboard'|'whatsapp'|'telegram'|'email'|'other'};
const defaultProvenance:CompletionProvenance={mode:'inferred',channel:'other'};
// Evaluate the persisted snapshot inside the same batch as the insert.
function creationAudit(db:any,id:string,now:string,provenance:CompletionProvenance) {
 return db.prepare("INSERT INTO family_audit(record_id,action,after_data,occurred_at,completion_mode,completion_channel) SELECT id,?,data,?,CASE WHEN kind='task' AND json_extract(data,'$.status')='done' THEN ? END,CASE WHEN kind='task' AND json_extract(data,'$.status')='done' THEN ? END FROM family_records WHERE id=?").bind('create',now,provenance.mode,provenance.channel,id);
}
export async function saveRecord(raw:any,provenance:CompletionProvenance=defaultProvenance) {
 const data=validateRecord(raw);const db=await database();const now=new Date().toISOString();
 if(raw.id) {
  const old=await db.prepare('SELECT * FROM family_records WHERE id=?').bind(raw.id).first();
  if(!old)throw new Error('Registro no encontrado.');
  if(old.revision!==raw.revision)throw new Error('Este registro ha cambiado. Actualiza la página e inténtalo de nuevo.');
  const result=await db.batch([
   db.prepare("INSERT INTO family_audit(record_id,action,before_data,after_data,occurred_at,completion_mode,completion_channel) SELECT id,?,data,?,?,CASE WHEN ? AND NOT (kind='task' AND json_extract(data,'$.status') IS 'done') THEN ? END,CASE WHEN ? AND NOT (kind='task' AND json_extract(data,'$.status') IS 'done') THEN ? END FROM family_records WHERE id=? AND revision=?").bind('update',JSON.stringify(data),now,data.kind==='task'&&data.status==='done'?1:0,provenance.mode,data.kind==='task'&&data.status==='done'?1:0,provenance.channel,raw.id,raw.revision),
   db.prepare('UPDATE family_records SET kind=?,data=?,source_key=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(data.kind,JSON.stringify(data),data.sourceKey||null,now,raw.id,raw.revision)
  ]);
  if(!result[1].meta.changes)throw new Error('Este registro ha cambiado. Actualiza la página.');
  return {...data,id:raw.id,revision:raw.revision+1};
 }
 const id=crypto.randomUUID();
 const parent=data.completionParent;
 if(data.sourceKey?.startsWith('completion:')&&!parent)throw new Error('Esta tarea ha cambiado. Actualiza la página y vuelve a abrir la decisión.');
 // The parent predicate and insertion are one SQL statement within the audit batch.
 const insert=parent
  ?db.prepare("INSERT INTO family_records(id,kind,data,source_key,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM family_records WHERE id=? AND revision=? AND kind='task' AND json_extract(data,'$.recurrence') IN ('daily','weekdays','weekly','yearly') AND json_extract(data,'$.status') IN ('open','waiting','done')) ON CONFLICT(source_key) DO NOTHING").bind(id,data.kind,JSON.stringify(data),data.sourceKey,now,now,parent.id,parent.revision)
  :db.prepare('INSERT INTO family_records(id,kind,data,source_key,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(source_key) DO NOTHING').bind(id,data.kind,JSON.stringify(data),data.sourceKey||null,now,now);
 const result=await db.batch([
  insert,
  creationAudit(db,id,now,provenance)
 ]);
 if(!result[0].meta.changes&&data.sourceKey?.startsWith('completion:'))throw new Error('Esta tarea ha cambiado. Actualiza la página y vuelve a abrir la decisión.');
 if(!result[0].meta.changes) return unpack(await db.prepare('SELECT * FROM family_records WHERE source_key=?').bind(data.sourceKey).first());
 return {...data,id,revision:1};
}
export async function removeRecord(id:string,revision:number) {
 const db=await database();const old=await db.prepare('SELECT * FROM family_records WHERE id=? AND revision=?').bind(id,revision).first();
 if(!old)throw new Error('El registro ha cambiado. Actualiza la página.');
 const result=await db.batch([
  db.prepare('INSERT INTO family_audit(record_id,action,before_data,occurred_at) SELECT id,?,data,? FROM family_records WHERE id=? AND revision=?').bind('delete',new Date().toISOString(),id,revision),
  db.prepare('DELETE FROM family_records WHERE id=? AND revision=?').bind(id,revision)
 ]);
 if(!result[1].meta.changes)throw new Error('El registro ha cambiado.');
}

// D1 batches are transactions: an occurrence failure rolls back its template and audits.
export async function saveCompletedTask(raw:any,provenance:CompletionProvenance=defaultProvenance) {
 const data=validateRecord(raw);
 if(data.kind!=='task'||data.recurrence==='none'||data.status!=='done'||!/^\d{4}-\d{2}-\d{2}$/.test(raw.completeOn)||!occursOn({...data,id:'',revision:0},raw.completeOn))throw new Error('La tarea no corresponde a este día.');
 const id=raw.id||crypto.randomUUID(),revision=raw.id?raw.revision+1:1,occurrenceId=crypto.randomUUID(),now=new Date().toISOString();
 const template=validateRecord({...data,status:'open',completionDecision:undefined});
 if(raw.completeChoice!==undefined&&!['all','partial'].includes(raw.completeChoice))throw new Error('Decisión de finalización no válida.');
 const occurrence=validateRecord({...data,completionDecision:raw.completeChoice||data.completionDecision||'all',checklist:raw.completeChoice==='all'?data.checklist.map(c=>({...c,done:true})):data.checklist,date:raw.completeOn,recurrence:'none',sourceKey:`completion:${id}:${raw.completeOn}`,completionParent:{id,revision}});
 const db=await database();
 const insert=(recordId:string,value:typeof template)=>db.prepare('INSERT INTO family_records(id,kind,data,source_key,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(recordId,value.kind,JSON.stringify(value),value.sourceKey||null,now,now);
 const audit=(recordId:string)=>creationAudit(db,recordId,now,provenance);
 if(raw.id){
  const old=await db.prepare('SELECT * FROM family_records WHERE id=?').bind(id).first();
  if(!old||old.revision!==raw.revision||unpack(old).recurrence!=='none'||unpack(old).kind!=='task'||unpack(old).status==='cancelled')throw new Error('Esta tarea ha cambiado. Actualiza la página y vuelve a abrir la decisión.');
  const result=await db.batch([
   db.prepare('INSERT INTO family_audit(record_id,action,before_data,after_data,occurred_at) SELECT id,?,data,?,? FROM family_records WHERE id=? AND revision=?').bind('update',JSON.stringify(template),now,id,raw.revision),
   db.prepare('UPDATE family_records SET data=?,source_key=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(JSON.stringify(template),template.sourceKey||null,now,id,raw.revision),
   // changes() refers to the immediately preceding optimistic update in this transaction.
   db.prepare('INSERT INTO family_records(id,kind,data,source_key,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE changes()=1').bind(occurrenceId,occurrence.kind,JSON.stringify(occurrence),occurrence.sourceKey,now,now),
   audit(occurrenceId)
  ]);
  if(!result[1].meta.changes)throw new Error('Esta tarea ha cambiado. Actualiza la página y vuelve a abrir la decisión.');
 }else await db.batch([insert(id,template),insert(occurrenceId,occurrence),audit(id),audit(occurrenceId)]);
 const record={...template,id,revision};
 return {record,records:[record,{...occurrence,id:occurrenceId,revision:1}]};
}
