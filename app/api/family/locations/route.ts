import {NextRequest,NextResponse} from 'next/server';
import {taskActor} from '@/lib/family-mission/tasks-route';
import {personForEmail,validatePlace,validateLink} from '@/lib/family-mission/location-model';
import {listLocations,writeLocation,deleteLocation} from '@/lib/family-mission/location-store';
export const dynamic='force-dynamic';
const response=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(req:NextRequest){const actor=await taskActor(req);if(!actor)return response({error:'No autorizado'},401);try{return response(await listLocations(actor==='service'?null:personForEmail(actor)));}catch{return response({error:'Lugares no disponibles'},503);}}
async function mutate(req:NextRequest,remove=false){const actor=await taskActor(req);if(!actor)return response({error:'No autorizado'},401);if(actor==='service')return response({error:'La confirmación requiere tu sesión personal'},403);
 try{const raw=await req.json();if(JSON.stringify(raw).length>6000)throw new Error('INVALID');if(!raw||!['place','link'].includes(raw.kind))throw new Error('INVALID');if(raw.id!==undefined&&(typeof raw.id!=='string'||!raw.id||raw.id.length>100||!Number.isSafeInteger(raw.revision)||raw.revision<1))throw new Error('INVALID');const person=personForEmail(actor);
 if(remove){if(!raw.id)throw new Error('INVALID');await deleteLocation(raw.kind,person,raw.id,raw.revision);return response({ok:true});}
 const data=raw.kind==='place'?validatePlace(raw):validateLink(raw);if(data.person!==person)return response({error:'Solo puedes configurar tu propia ubicación'},403);
 if(raw.kind==='link'&&raw.enabled){if(raw.confirm!==true)return response({error:'Confirma este aviso privado para activarlo'},400);Object.assign(data,{confirmedAt:new Date().toISOString()});}
 return response({item:await writeLocation(raw.kind,person,data,raw.id,raw.revision)},raw.id?200:201);
 }catch(e){const message=e instanceof Error?e.message:'';return response({error:message==='CONFLICT'?'Ha cambiado. Recarga antes de guardar.':message==='IN_USE'?'Quita los vínculos antes de borrar el lugar.':'No se pudo guardar. Revisa los datos.'},message==='CONFLICT'||message==='IN_USE'?409:message==='INVALID'?400:503);}}
export const POST=(req:NextRequest)=>mutate(req);
export const DELETE=(req:NextRequest)=>mutate(req,true);
