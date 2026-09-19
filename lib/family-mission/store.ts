import 'server-only';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { validateRecord, type FamilyRecord } from './model';
async function database():Promise<any> { const {env}=await getCloudflareContext({async:true});const db=(env as any).FAMILY_DB;if(!db)throw new Error('Family storage unavailable');return db; }
function unpack(row:any):FamilyRecord { return {...JSON.parse(row.data),id:row.id,revision:row.revision,updatedAt:row.updated_at}; }
export async function readRecords() { const db=await database();const result=await db.prepare("SELECT * FROM family_records WHERE source_key IS NULL OR (source_key NOT LIKE 'approval:%' AND source_key NOT LIKE 'capability:%' AND source_key NOT LIKE 'chat-conversation:%' AND source_key NOT LIKE 'chat-thread:%') ORDER BY updated_at DESC LIMIT 3000").all();return result.results.map(unpack) as FamilyRecord[]; }
export async function saveRecord(raw:any) {
 const data=validateRecord(raw);const db=await database();const now=new Date().toISOString();
 if(raw.id) {
  const old=await db.prepare('SELECT * FROM family_records WHERE id=?').bind(raw.id).first();
  if(!old)throw new Error('Registro no encontrado.');
  if(old.revision!==raw.revision)throw new Error('Este registro ha cambiado. Actualiza la página e inténtalo de nuevo.');
  const result=await db.batch([
   db.prepare('INSERT INTO family_audit(record_id,action,before_data,after_data,occurred_at) SELECT id,?,data,?,? FROM family_records WHERE id=? AND revision=?').bind('update',JSON.stringify(data),now,raw.id,raw.revision),
   db.prepare('UPDATE family_records SET kind=?,data=?,source_key=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(data.kind,JSON.stringify(data),data.sourceKey||null,now,raw.id,raw.revision)
  ]);
  if(!result[1].meta.changes)throw new Error('Este registro ha cambiado. Actualiza la página.');
  return {...data,id:raw.id,revision:raw.revision+1};
 }
 const id=crypto.randomUUID();
 const result=await db.batch([
  db.prepare('INSERT INTO family_records(id,kind,data,source_key,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(source_key) DO NOTHING').bind(id,data.kind,JSON.stringify(data),data.sourceKey||null,now,now),
  db.prepare('INSERT INTO family_audit(record_id,action,after_data,occurred_at) SELECT id,?,data,? FROM family_records WHERE id=?').bind('create',now,id)
 ]);
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
