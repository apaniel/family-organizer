import {NextRequest,NextResponse} from 'next/server';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
import {listArtifacts,publishArtifact,deleteArtifact} from '@/lib/family-mission/artifacts';
import {validArtifactId,validateArtifact} from '@/lib/family-mission/artifact-policy';
export const dynamic='force-dynamic';
const json=(v:unknown,status=200)=>NextResponse.json(v,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(req:NextRequest){
 if(!(await requireCalendarSyncRouteAuth(req)).authorized)return json({error:'Unauthorized'},401);
 try{return json({artifacts:await listArtifacts()});}catch{return json({error:'Storage unavailable'},503);}
}
export async function POST(req:NextRequest){
 if(!(await requireCalendarSyncRouteAuth(req)).authorized)return json({error:'Unauthorized'},401);
 // Stream with a bound before parsing, including chunked requests.
 const reader=req.body?.getReader();if(!reader)return json({error:'Missing body'},400);
 let size=0;const chunks:Uint8Array[]=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1000000){await reader.cancel();return json({error:'Too large'},413);}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 let data;try{data=validateArtifact(JSON.parse(new TextDecoder().decode(bytes)));}catch{return json({error:'Invalid artifact: complete HTML and title required; maximum 500 KB'},400);}
 try{return json(await publishArtifact(data));}catch{return json({error:'Could not publish'},503);}
}
export async function DELETE(req:NextRequest){
 if(!(await requireCalendarSyncRouteAuth(req)).authorized)return json({error:'Unauthorized'},401);
 const id=req.nextUrl.searchParams.get('id')||'';if(!validArtifactId(id))return json({error:'Invalid ID'},400);
 try{await deleteArtifact(id);return json({ok:true});}catch{return json({error:'Could not remove'},503);}
}
