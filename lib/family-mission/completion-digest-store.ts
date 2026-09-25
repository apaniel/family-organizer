import 'server-only';
import {getCloudflareContext} from '@opennextjs/cloudflare';
import {validDigestDate} from './digest-model';

const madridOffset=new Intl.DateTimeFormat('en',{timeZone:'Europe/Madrid',timeZoneName:'longOffset'});
function midnight(utcDate:number):string {
 // Resolve each local midnight independently: Madrid days can be 23 or 25 hours.
 let instant=utcDate;
 for(let i=0;i<3;i++){
  const zone=madridOffset.formatToParts(instant).find(part=>part.type==='timeZoneName')!.value;
  const match=/GMT([+-])(\d{2}):(\d{2})(?::(\d{2}))?/.exec(zone);
  const offset=match?(match[1]==='+'?1:-1)*(Number(match[2])*3600+Number(match[3])*60+Number(match[4]||0))*1000:0;
  instant=utcDate-offset;
 }
 return new Date(instant).toISOString();
}
export async function readCompletionDigest(date:string){
 if(!validDigestDate(date))throw new Error('Fecha no válida.');
 const utcDate=Date.parse(date+'T00:00:00Z');
 const dayMilliseconds=24*60*60*1000;
 const start=midnight(utcDate),end=midnight(utcDate+dayMilliseconds);
 const {env}=await getCloudflareContext({async:true});
 const db=(env as any).FAMILY_DB;
 // Select only public snapshot fields, never full audit JSON. Historical NULL
 // provenance is conservatively inferred/other, without rewriting audit history.
 // SQLite IS comparisons are NULL-safe: missing historical fields are not done,
 // while done-to-done updates are excluded regardless of their provenance.
 const {results}=await db.prepare(`
  SELECT record_id AS id,json_extract(after_data,'$.title') AS title,
   json_extract(after_data,'$.owner') AS owner,occurred_at AS completedAt,
   COALESCE(completion_mode,'inferred') AS mode,
   COALESCE(completion_channel,'other') AS channel
  FROM family_audit
  WHERE occurred_at>=? AND occurred_at<?
   AND json_extract(after_data,'$.kind')='task'
   AND json_extract(after_data,'$.status')='done'
   AND (action='create' OR (action='update' AND NOT (
    json_extract(before_data,'$.kind') IS 'task' AND json_extract(before_data,'$.status') IS 'done'
   )))
  ORDER BY occurred_at,id
 `).bind(start,end).all();
 type Completion={id:string;title:string;owner:string;completedAt:string;channel:string};
 const explicit:Completion[]=[],inferred:Completion[]=[];
 for(const {mode,...item} of results)(mode==='explicit'?explicit:inferred).push(item);
 return {date,explicit,inferred};
}
