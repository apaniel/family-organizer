import 'server-only';
import {getCloudflareContext} from '@opennextjs/cloudflare';
import {validateArtifact} from './artifact-policy';
async function database(){const {env}=await getCloudflareContext({async:true});return (env as any).FAMILY_DB;}
export async function listArtifacts(){const db=await database();return (await db.prepare('SELECT id,title,created_at FROM family_artifacts ORDER BY created_at DESC LIMIT 100').all()).results;}
export async function getArtifact(id:string){const db=await database();return db.prepare('SELECT * FROM family_artifacts WHERE id=?').bind(id).first();}
export async function publishArtifact(raw:unknown){
 const {title,html}=validateArtifact(raw);
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([title,html])));
 const id=Array.from(new Uint8Array(bytes)).map(b=>b.toString(16).padStart(2,'0')).join('');
 const db=await database();
 await db.prepare('INSERT INTO family_artifacts(id,title,html,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,title,html,new Date().toISOString()).run();
 return {id,title,url:'https://apalas.apaniel.dev/api/family/artifacts/'+id};
}
export async function deleteArtifact(id:string){const db=await database();await db.prepare('DELETE FROM family_artifacts WHERE id=?').bind(id).run();}
