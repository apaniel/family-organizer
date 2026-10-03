import {NextRequest,NextResponse} from 'next/server';
import {assertPlannerRecord} from '@/lib/family-mission/record-namespaces';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
import {readNonTaskRecords,saveRecord,saveCompletedTask,removeRecord,type CompletionProvenance} from '@/lib/family-mission/store';
import {dateKey,reminderCandidates} from '@/lib/family-mission/model';
import {commandPayload} from '@/lib/family-mission/tasks-command';
import {taskSnapshot,saveTask,deleteTask,GoogleTasksConflict,GoogleTasksUnconfirmed} from '@/lib/family-mission/google-tasks';
import {taskActor} from '@/lib/family-mission/tasks-route';
export const dynamic='force-dynamic';
const response=(data:any,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(req:NextRequest){if(!(await requireCalendarSyncRouteAuth(req)).authorized)return response({error:'Inicia sesión con un correo autorizado para continuar.'},401);
 try{const local=await readNonTaskRecords();let snapshot;try{snapshot=await taskSnapshot();}catch{snapshot=null;}const records=[...local,...(snapshot?.records||[])];return response({records:req.nextUrl.searchParams.has('reminders')?reminderCandidates(records,dateKey()):records,taskStore:'google-tasks',taskMirror:false,taskAvailable:!!snapshot,taskRefreshedAt:snapshot?.refreshedAt||null});}catch{return response({error:'No se han podido cargar los datos. Inténtalo de nuevo.'},503);}}

function completionProvenance(req:NextRequest,kind:string):CompletionProvenance {
 if(kind==='email')return {mode:'explicit',channel:'dashboard'};
 const mode=req.headers.get('x-family-completion-mode');
 const channel=req.headers.get('x-family-completion-channel');
 if(kind==='service'&&(mode==='explicit'||mode==='inferred')&&(channel==='whatsapp'||channel==='telegram'||channel==='email'||channel==='other'))return {mode,channel};
 return {mode:'inferred',channel:'other'};
}
export async function POST(req:NextRequest){const auth=await requireCalendarSyncRouteAuth(req);if(!auth.authorized)return response({error:'Acceso no autorizado.'},401);
 try{const raw=await req.json();if(JSON.stringify(raw).length>30000)return response({error:'El registro es demasiado grande.'},400);if(raw.kind==='task')return await taskWrite(req,'save',raw);return response(raw.completeOn!==undefined?await saveCompletedTask(raw,completionProvenance(req,auth.kind)):{record:await saveRecord(raw,completionProvenance(req,auth.kind))});}catch(e){return response({error:e instanceof Error && !/SQL|D1|constraint/i.test(e.message)?e.message:'No se pudo guardar. Revisa los datos.'},400);}}
export async function DELETE(req:NextRequest){if(!(await requireCalendarSyncRouteAuth(req)).authorized)return response({error:'Acceso no autorizado.'},401);
 try{const raw=await req.json();assertPlannerRecord(raw);const local=await readNonTaskRecords();if(!local.some((r:any)=>r.id===raw.id))return await taskWrite(req,'delete',raw);await removeRecord(raw.id,raw.revision);return response({ok:true});}catch{return response({error:'No se pudo eliminar. Actualiza la página.'},409);}}

async function taskWrite(req:NextRequest,action:string,raw:any){
 assertPlannerRecord(raw);
 const actor=await taskActor(req);if(!actor)return response({error:'Acceso no autorizado.'},403);
 const payload=commandPayload(action,raw);
 const key=req.headers.get('idempotency-key');
 if(key&&!/^[a-zA-Z0-9:-]{8,120}$/.test(key))throw new Error('Clave de operación no válida.');
 const operationId=key||crypto.randomUUID();
 if(action==='save'&&!payload.record.id){
  const input=actor+'\n'+(key||JSON.stringify(payload));
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input)))).map(x=>x.toString(16).padStart(2,'0')).join('');
  payload.record.sourceKey='dashboard:'+digest;
 }
 try{
  const result=action==='delete'?await deleteTask(payload.record.id,payload.record.revision):await saveTask(payload.record);
  return response({operationId,state:'done',...result});
 }catch(error){
  if(error instanceof GoogleTasksConflict)return response({operationId,state:'failed',error:'Conflicto: la tarea cambió antes de ejecutar. Actualiza la página.'},409);
  if(error instanceof GoogleTasksUnconfirmed)return response({operationId,state:'ambiguous',error:'La operación está pendiente de verificación en Google. No está completada.'},503);
  throw error;
 }
}
