import 'server-only';
import {taskSnapshot} from './tasks-relay';
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
 const {records}=await taskSnapshot();
 const inferred=records.filter((r:any)=>r.status==='done'&&r.completedAt>=start&&r.completedAt<end).map((r:any)=>({id:r.id,title:r.title,owner:r.owner,completedAt:r.completedAt,channel:'other'})).sort((a:any,b:any)=>a.completedAt.localeCompare(b.completedAt));
 return {date,explicit:[],inferred,store:'google-tasks',mirror:true};
}
