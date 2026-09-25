import {NextRequest,NextResponse} from 'next/server';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
import {readRecords,saveRecord,saveCompletedTask,removeRecord,type CompletionProvenance} from '@/lib/family-mission/store';
import {dateKey,reminderCandidates} from '@/lib/family-mission/model';
export const dynamic='force-dynamic';
const response=(data:any,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(req:NextRequest){if(!(await requireCalendarSyncRouteAuth(req)).authorized)return response({error:'Inicia sesión con un correo autorizado para continuar.'},401);
 try{const records=await readRecords();return response({records:req.nextUrl.searchParams.has('reminders')?reminderCandidates(records,dateKey()):records});}catch{return response({error:'No se han podido cargar los datos. Inténtalo de nuevo.'},503);}}
function completionProvenance(req:NextRequest,kind:string):CompletionProvenance {
 if(kind==='email')return {mode:'explicit',channel:'dashboard'};
 const mode=req.headers.get('x-family-completion-mode');
 const channel=req.headers.get('x-family-completion-channel');
 if(kind==='service'&&(mode==='explicit'||mode==='inferred')&&(channel==='whatsapp'||channel==='telegram'||channel==='email'||channel==='other'))return {mode,channel};
 return {mode:'inferred',channel:'other'};
}
export async function POST(req:NextRequest){const auth=await requireCalendarSyncRouteAuth(req);if(!auth.authorized)return response({error:'Acceso no autorizado.'},401);
 try{const raw=await req.json();if(JSON.stringify(raw).length>30000)return response({error:'El registro es demasiado grande.'},400);return response(raw.completeOn!==undefined?await saveCompletedTask(raw,completionProvenance(req,auth.kind)):{record:await saveRecord(raw,completionProvenance(req,auth.kind))});}catch(e){return response({error:e instanceof Error && !/SQL|D1|constraint/i.test(e.message)?e.message:'No se pudo guardar. Revisa los datos.'},400);}}
export async function DELETE(req:NextRequest){if(!(await requireCalendarSyncRouteAuth(req)).authorized)return response({error:'Acceso no autorizado.'},401);
 try{const {id,revision}=await req.json();await removeRecord(id,revision);return response({ok:true});}catch{return response({error:'No se pudo eliminar. Actualiza la página.'},409);}}
