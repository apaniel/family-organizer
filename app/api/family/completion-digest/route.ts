import {NextRequest,NextResponse} from 'next/server';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
import {validDigestDate} from '@/lib/family-mission/digest-model';
import {readCompletionDigest} from '@/lib/family-mission/completion-digest-store';
export const dynamic='force-dynamic';
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(req:NextRequest){
 const auth=await requireCalendarSyncRouteAuth(req);
 if(!auth.authorized)return json({error:'Acceso no autorizado.'},401);
 const date=req.nextUrl.searchParams.get('date');
 if(!validDigestDate(date))return json({error:'Fecha no válida.'},400);
 try{return json(await readCompletionDigest(date));}
 catch{return json({error:'No se pudo cargar el resumen.'},503);}
}
