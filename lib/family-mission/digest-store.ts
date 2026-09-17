import 'server-only';
import {getCloudflareContext} from '@opennextjs/cloudflare';
import {validateDigest,documentType} from './digest-model';
export async function digestEnv(){const {env}=await getCloudflareContext({async:true});return env as any;}
const unpack=(row:any)=>({...JSON.parse(row.data),id:row.id,revision:row.revision});
export async function listDigest(day:string,pending=false){const e=await digestEnv();const q=pending?"SELECT * FROM family_digest WHERE kind='receipt' ORDER BY day DESC LIMIT 1000":"SELECT * FROM family_digest WHERE day=? ORDER BY created_at DESC LIMIT 300";
 const stmt=e.FAMILY_DB.prepare(q);const rows=(await (pending?stmt:stmt.bind(day)).all()).results;
 const items=[];for(const row of rows){const documents=(await e.FAMILY_DB.prepare('SELECT id,filename,mime FROM family_documents WHERE digest_id=? ORDER BY created_at').bind(row.id).all()).results;items.push({...unpack(row),documents});}
 return items;}
export async function saveDigest(raw:any){const value=validateDigest(raw);const e=await digestEnv();const now=new Date().toISOString();
 if(raw.id){
  if(!Number.isInteger(raw.revision))throw new Error('Revisión obligatoria.');
  const result=await e.FAMILY_DB.prepare('UPDATE family_digest SET day=?,kind=?,data=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND source_key=?').bind(value.date,value.kind,JSON.stringify(value),now,raw.id,raw.revision,value.sourceKey).run();
  if(!result.meta.changes)throw new Error('El registro ha cambiado. Vuelve a cargar.');return {...value,id:raw.id,revision:raw.revision+1};
 }
 const id=crypto.randomUUID();await e.FAMILY_DB.prepare('INSERT INTO family_digest(id,source_key,day,kind,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(source_key) DO NOTHING').bind(id,value.sourceKey,value.date,value.kind,JSON.stringify(value),now,now).run();return unpack(await e.FAMILY_DB.prepare('SELECT * FROM family_digest WHERE source_key=?').bind(value.sourceKey).first());
}
export async function uploadDocument(id:string,filename:string,bytes:Uint8Array){
 const mime=documentType(bytes);const e=await digestEnv();if(!e.FAMILY_DOCUMENTS)throw new Error('Archivo no disponible.');
 if(!await e.FAMILY_DB.prepare('SELECT id FROM family_digest WHERE id=?').bind(id).first())throw new Error('Registro no encontrado.');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const existing=await e.FAMILY_DB.prepare('SELECT id,filename,mime FROM family_documents WHERE digest_id=? AND sha256=?').bind(id,hash).first();if(existing)return existing;
 const docId=crypto.randomUUID(),key=id+'/'+hash;const name=filename.replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,160)||'recibo.pdf';
 await e.FAMILY_DOCUMENTS.put(key,bytes,{httpMetadata:{contentType:mime}});
 await e.FAMILY_DB.prepare('INSERT INTO family_documents(id,digest_id,filename,mime,object_key,bytes,sha256,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(digest_id,sha256) DO NOTHING').bind(docId,id,name,mime,key,bytes.length,hash,new Date().toISOString()).run();
 return e.FAMILY_DB.prepare('SELECT id,filename,mime FROM family_documents WHERE digest_id=? AND sha256=?').bind(id,hash).first();
}
