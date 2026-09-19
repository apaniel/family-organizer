import {NextRequest,NextResponse} from 'next/server';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
import {listArtifacts,getArtifact} from '@/lib/family-mission/artifacts';
import {readActivityArtifact} from '@/lib/family-mission/activity-model';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
 if(!(await requireCalendarSyncRouteAuth(req)).authorized)return NextResponse.json({error:'Unauthorized'},{status:401});
 try{const items=await listArtifacts();for(const item of items.filter((x:any)=>x.title.startsWith('Planes familiares')).slice(0,15)){const artifact=await getArtifact(item.id);const data=artifact&&readActivityArtifact(artifact.html);if(data)return NextResponse.json({...data,artifactUrl:'/api/family/artifacts/'+item.id},{headers:{'Cache-Control':'private, no-store'}});}return NextResponse.json({plans:[],checkedAt:''},{headers:{'Cache-Control':'private, no-store'}});}catch{return NextResponse.json({error:'No se pudieron cargar los planes'},{status:503});}
}
