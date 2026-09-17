import {NextRequest} from 'next/server';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
import {getArtifact} from '@/lib/family-mission/artifacts';
import {artifactHeaders,validArtifactId} from '@/lib/family-mission/artifact-policy';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 if(!(await requireCalendarSyncRouteAuth(req)).authorized)return new Response('Acceso no autorizado',{status:401});
 const {id}=await params;if(!validArtifactId(id))return new Response('Not found',{status:404});
 try{const item=await getArtifact(id);if(!item)return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
 return new Response(item.html,{headers:artifactHeaders});}catch{return new Response('Unavailable',{status:503});}
}
