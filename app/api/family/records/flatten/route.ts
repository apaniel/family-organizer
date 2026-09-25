import {NextRequest,NextResponse} from 'next/server';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
import {flattenRecord,FlattenConflict,FlattenInputError} from '@/lib/family-mission/flatten';
export const dynamic='force-dynamic';
const response=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(req:NextRequest){
 const auth=await requireCalendarSyncRouteAuth(req);
 if(!auth.authorized)return response({error:'Acceso no autorizado.'},401);
 if(auth.kind!=='service')return response({error:'Esta operación requiere autenticación de servicio.'},403);
 try{
  const body=await req.text();
  if(body.length>1000)throw new FlattenInputError('Solicitud de migración demasiado grande.');
  return response(await flattenRecord(JSON.parse(body)));
 }catch(error){
  return response({error:error instanceof FlattenInputError||error instanceof FlattenConflict?error.message:'No se pudo migrar la tarea. Revisa los datos y vuelve a obtener una vista previa.'},error instanceof FlattenConflict?409:400);
 }
}
