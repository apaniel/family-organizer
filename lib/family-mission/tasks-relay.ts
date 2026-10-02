import 'server-only';
import {getCloudflareContext} from '@opennextjs/cloudflare';
export const MAX_SNAPSHOT_AGE=90000;
export async function relayDB():Promise<any>{const {env}=await getCloudflareContext({async:true});if(!(env as any).FAMILY_DB)throw new Error('Relay unavailable');return (env as any).FAMILY_DB;}
export function assertFresh(stamp:number,now=Date.now()){if(!Number.isFinite(stamp)||stamp>now+5000||now-stamp>MAX_SNAPSHOT_AGE)throw new Error('Google Tasks no está disponible: copia desactualizada.');}
export async function taskSnapshot(){const db=await relayDB();const row=await db.prepare('SELECT * FROM google_tasks_mirror WHERE id=1').first();if(!row)throw new Error('Google Tasks todavía no está disponible.');assertFresh(row.refreshed_at);return {records:JSON.parse(row.records),store:'google-tasks',mirror:true,refreshedAt:new Date(row.refreshed_at).toISOString()};}
export function commandPayload(action:string,raw:any){
 if(!['save','delete'].includes(action)||!raw||typeof raw!=='object')throw new Error('Operación no válida.');
 if(raw.id!==undefined&&(typeof raw.id!=='string'||raw.id.length>300))throw new Error('ID no válido.');
 if(action==='delete'){if(!raw.id||!Number.isSafeInteger(raw.revision))throw new Error('Actualiza la tarea antes de eliminar.');return {action,record:{id:raw.id,revision:raw.revision}};}
 if(raw.kind!=='task'||raw.completeOn!==undefined||raw.checklist?.length||!['none',undefined].includes(raw.recurrence)||!['open','waiting','done'].includes(raw.status))throw new Error('Google Tasks admite tareas binarias sin repetición.');
 if(typeof raw.title!=='string'||!raw.title.trim()||raw.title.length>200||typeof raw.notes!=='string'||raw.notes.length>10000||!['Dani','Cris','Saida','Familia','Sin asignar',''].includes(raw.owner))throw new Error('Revisa los datos de la tarea.');
 if(raw.date&&!/^\d{4}-\d{2}-\d{2}$/.test(raw.date))throw new Error('Fecha no válida.');
 if(raw.time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time))throw new Error('Hora no válida.');
 if(raw.id&&!Number.isSafeInteger(raw.revision))throw new Error('Actualiza la tarea antes de guardar.');
 const record:any={kind:'task'};
 for(const k of ['id','revision','title','notes','owner','date','time','status','category','reminderDays','sourceKey','source'])if(raw[k]!==undefined)record[k]=raw[k];
 if(record.sourceKey!==undefined&&(typeof record.sourceKey!=='string'||record.sourceKey.length>250))throw new Error('Origen no válido.');
 if(record.owner==='')record.owner='Sin asignar';
 return {action,record};
}
export async function enqueueTask(action:string,raw:any,actor:string,key?:string|null){
 const payload=commandPayload(action,raw);const encoded=JSON.stringify(payload);
 // Explicit keys identify browser intent. Keyless clients deduplicate only active work.
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(actor+'\n'+encoded)))).map(x=>x.toString(16).padStart(2,'0')).join('');
 if(key&&!/^[a-zA-Z0-9:-]{8,120}$/.test(key))throw new Error('Clave de operación no válida.');
 const id=key?actor+':'+key:digest+':'+crypto.randomUUID();const db=await relayDB();
 const prior=key?await db.prepare('SELECT * FROM google_tasks_commands WHERE id=?').bind(id).first():null;
 if(prior){if(prior.actor!==actor||prior.payload!==encoded)throw new Error('La clave ya corresponde a otra operación.');return commandResult(prior);}
 if(!key){const same=await db.prepare("SELECT * FROM google_tasks_commands WHERE actor=? AND payload=? AND state IN ('queued','leased','executing','ambiguous') ORDER BY created_at LIMIT 1").bind(actor,encoded).first();if(same)return commandResult(same);}
 if(!payload.record.id&&await db.prepare("SELECT id FROM google_tasks_commands WHERE state='ambiguous' AND json_extract(payload,'$.action')='save' AND COALESCE(json_extract(payload,'$.record.id'),'')='' LIMIT 1").first())throw new Error('Hay una creación pendiente de revisión en Google. No se creará otra tarea hasta resolverla.');
 const snapshot=await taskSnapshot();
 if(payload.record.id){const old=snapshot.records.find((r:any)=>r.id===payload.record.id);if(!old||old.revision!==payload.record.revision)throw new Error('La tarea ha cambiado. Actualiza la página.');}
 await db.prepare("INSERT INTO google_tasks_commands(id,actor,payload,state,created_at) SELECT ?,?,?,'queued',? WHERE NOT EXISTS(SELECT 1 FROM google_tasks_commands WHERE actor=? AND payload=? AND state IN ('queued','leased','executing','ambiguous')) ON CONFLICT(id) DO NOTHING").bind(id,actor,encoded,Date.now(),key?'':actor,encoded).run();
 const row=await db.prepare("SELECT * FROM google_tasks_commands WHERE id=? OR (actor=? AND payload=? AND state IN ('queued','leased','executing','ambiguous')) ORDER BY id=? DESC LIMIT 1").bind(id,actor,encoded,id).first();if(row.payload!==encoded)throw new Error('Clave de operación en conflicto.');return commandResult(row);
}
export function commandResult(row:any){return {operationId:row.id,state:row.state,...(row.state==='done'?JSON.parse(row.result):{error:row.error||'La operación está pendiente de verificación en Google. No está completada.'})};}
export async function getTaskOperation(id:string,actor:string){const row=await (await relayDB()).prepare('SELECT * FROM google_tasks_commands WHERE id=? AND actor=?').bind(id,actor).first();if(!row)throw new Error('Operación no encontrada.');return commandResult(row);}
export async function workerRelay(body:any){
 const db=await relayDB(),now=Date.now();
 if(body.action==='claim'){
  await db.batch([
   db.prepare("UPDATE google_tasks_commands SET state='ambiguous',error='Ejecución interrumpida; no se repetirá automáticamente.' WHERE state='executing' AND lease_until<?").bind(now),
   db.prepare("UPDATE google_tasks_commands SET state='queued',lease_token=NULL WHERE state='leased' AND lease_until<?").bind(now)
  ]);
  const token=crypto.randomUUID();
  const row=await db.prepare("UPDATE google_tasks_commands SET state='leased',lease_until=?,lease_token=? WHERE id=(SELECT id FROM google_tasks_commands WHERE state='queued' ORDER BY created_at,id LIMIT 1) AND NOT EXISTS(SELECT 1 FROM google_tasks_commands WHERE state IN ('leased','executing')) RETURNING *").bind(now+240000,token).first();
  return {command:row?{id:row.id,payload:JSON.parse(row.payload),leaseToken:token}:null};
 }
 if(body.action==='snapshot-start'){
  const ticket=await db.prepare("UPDATE google_tasks_generation SET generation=generation+1,captured_at=? WHERE id=1 AND NOT EXISTS(SELECT 1 FROM google_tasks_commands WHERE state='executing') RETURNING generation").bind(now).first();
  return {generation:ticket?.generation??null};
 }
 if(body.action==='snapshot'){
  validateSnapshot(body.records);
  if(!Number.isSafeInteger(body.generation))throw new Error('Missing capture generation');
  const res=await db.prepare("INSERT INTO google_tasks_mirror(id,records,refreshed_at) SELECT 1,?,captured_at FROM google_tasks_generation WHERE id=1 AND generation=? AND captured_at>=? AND NOT EXISTS(SELECT 1 FROM google_tasks_commands WHERE state='executing') ON CONFLICT(id) DO UPDATE SET records=excluded.records,refreshed_at=excluded.refreshed_at").bind(JSON.stringify(body.records),body.generation,now-MAX_SNAPSHOT_AGE).run();
  return {ok:res.meta.changes===1};
 }
 if(body.action==='begin'||body.action==='finish'){
  const state=body.action==='begin'?'leased':'executing';
  // CHECK failure aborts the entire D1 batch, including snapshot publication.
  const guard=db.prepare("INSERT INTO google_tasks_transition_guard(id) VALUES(CASE WHEN EXISTS(SELECT 1 FROM google_tasks_commands WHERE id=? AND lease_token=? AND state=? AND lease_until>=?) THEN 1 ELSE 0 END)").bind(body.id,body.leaseToken,state,now);
  const statements=[guard];
  if(body.action==='begin'){
   statements.push(db.prepare("UPDATE google_tasks_commands SET state='executing',lease_until=? WHERE id=? AND lease_token=? AND state='leased'").bind(now+480000,body.id,body.leaseToken),db.prepare('UPDATE google_tasks_mirror SET refreshed_at=0 WHERE id=1'));
  }else{
   if(!['done','failed','ambiguous'].includes(body.state))throw new Error('Invalid result');
   if(body.state==='done'&&(!body.records||!body.result||typeof body.result!=='object'))throw new Error('Unverified result');
   statements.push(db.prepare("UPDATE google_tasks_commands SET state=?,result=?,error=? WHERE id=? AND lease_token=? AND state='executing'").bind(body.state,JSON.stringify(body.result||{}),body.state==='done'?null:body.state==='failed'?'Conflicto: la tarea cambió antes de ejecutar. Actualiza la página.':'Google no ha confirmado la operación; no se repetirá automáticamente.',body.id,body.leaseToken));
   if(body.records){validateSnapshot(body.records);statements.push(db.prepare('INSERT INTO google_tasks_mirror(id,records,refreshed_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET records=excluded.records,refreshed_at=excluded.refreshed_at').bind(JSON.stringify(body.records),now));}
  }
  statements.push(db.prepare('UPDATE google_tasks_generation SET generation=generation+1 WHERE id=1'),db.prepare('DELETE FROM google_tasks_transition_guard WHERE id=1'));
  await db.batch(statements);return {ok:true};
 }
 throw new Error('Invalid transition');
}
function validateSnapshot(records:any){if(!Array.isArray(records)||records.length>5000||JSON.stringify(records).length>2000000||records.some(r=>r.kind!=='task'||r.store!=='google-tasks'||typeof r.id!=='string'||!Number.isSafeInteger(r.revision)))throw new Error('Invalid Google mirror');}
