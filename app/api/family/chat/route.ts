import {NextRequest,NextResponse} from 'next/server';
import {verifiedFamilyEmail} from '@/lib/cloudflare-family-access';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
import {listChat,submitChat,workerSnapshot,workerUpdate} from '@/lib/family-mission/chat-store';
import {legacyChat,mergeChat} from '@/lib/family-mission/legacy-chat';

export const dynamic='force-dynamic';
const MAX_FILE=25*1024*1024,MAX_TOTAL=50*1024*1024,MAX_FILES=5;
const SAFE_TYPES=new Set(['application/pdf','application/json','application/rtf','application/zip','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation']);
const response=(data:any,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
function validId(value:unknown){return typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);}
function validMode(value:unknown):value is 'send'|'queue'|'steer'{return value==='send'||value==='queue'||value==='steer';}
function safeFile(file:File){return file.size>0&&file.size<=MAX_FILE&&!/\.(exe|dll|msi|bat|cmd|com|scr|js|jar|sh|ps1)$/i.test(file.name)&&(file.type.startsWith('image/')||file.type.startsWith('audio/')||file.type.startsWith('video/')||file.type.startsWith('text/')||SAFE_TYPES.has(file.type));}
async function parent(req:NextRequest){const email=await verifiedFamilyEmail(req.headers.get('cf-access-jwt-assertion'));if(!email)return null;return ['apavicio@gmail.com','dapamar90@gmail.com'].includes(email)?'Dani' as const:'Cris' as const;}
async function service(req:NextRequest){const auth=await requireCalendarSyncRouteAuth(req);return auth.authorized&&auth.kind==='service';}
async function messages(person:'Dani'|'Cris'){const [legacy,current]=await Promise.all([legacyChat(person),listChat(person)]);return mergeChat(legacy,current);}

export async function GET(req:NextRequest){
 try{
  if(req.nextUrl.searchParams.get('worker')==='1'){if(!await service(req))return response({error:'Unauthorized'},401);return response({messages:await workerSnapshot()});}
  const person=await parent(req);if(!person)return response({error:'Inicia sesión para hablar con Rufus.'},401);return response({person,messages:await messages(person)});
 }catch{return response({error:'Rufus no está disponible ahora. Inténtalo en un momento.'},503);}
}
export async function POST(req:NextRequest){
 try{
  if(req.nextUrl.searchParams.get('worker')==='1'){if(!await service(req))return response({error:'Unauthorized'},401);const update=await req.json();await workerUpdate(update);return response({ok:true});}
  if(req.headers.get('origin')!==new URL(req.url).origin)return response({error:'Unauthorized'},403);
  const person=await parent(req);if(!person)return response({error:'Inicia sesión para hablar con Rufus.'},401);
  if(Number(req.headers.get('content-length')||0)>MAX_TOTAL+100000)return response({error:'Los archivos superan el límite de 50 MB.'},400);
  const form=await req.formData(),text=String(form.get('text')||''),id=String(form.get('id')||''),rawMode=String(form.get('mode')||'send'),mode=validMode(rawMode)?rawMode:'send',files=form.getAll('files').filter((value):value is File=>value instanceof File);
  if(!validId(id)||text.length>4000||(!text.trim()&&!files.length)||files.length>MAX_FILES||files.some(file=>!safeFile(file))||files.reduce((sum,file)=>sum+file.size,0)>MAX_TOTAL)return response({error:'Adjunta hasta 5 archivos compatibles, de 25 MB cada uno y 50 MB en total.'},400);
  await submitChat(person,{id,text,mode,files});return response({person,messages:await messages(person)});
 }catch(error){const message=error instanceof Error&&!/SQL|D1|constraint|storage/i.test(error.message)?error.message:'Rufus no está disponible ahora. Inténtalo en un momento.';return response({error:message},/respuesta anterior|No se pudo enviar/.test(message)?409:503);}
}
