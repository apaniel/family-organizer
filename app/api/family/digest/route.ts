import {NextRequest,NextResponse} from 'next/server';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
import {dateKey} from '@/lib/family-mission/model';
import {validDigestDate} from '@/lib/family-mission/digest-model';
import {listDigest,saveDigest} from '@/lib/family-mission/digest-store';
export const dynamic='force-dynamic';
const json=(v:unknown,status=200)=>NextResponse.json(v,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(req:NextRequest){if(!(await requireCalendarSyncRouteAuth(req)).authorized)return json({error:'Acceso no autorizado.'},401);const day=req.nextUrl.searchParams.get('date')||dateKey();if(!validDigestDate(day))return json({error:'Fecha no válida.'},400);
 try{return json({items:await listDigest(day,req.nextUrl.searchParams.get('pending')==='1'),financeConnected:true});}catch{return json({error:'No se pudo cargar el resumen.'},503);}}
export async function POST(req:NextRequest){if(!(await requireCalendarSyncRouteAuth(req)).authorized)return json({error:'Acceso no autorizado.'},401);
 try{const text=await req.text();if(text.length>16000)return json({error:'Registro demasiado grande.'},413);return json({item:await saveDigest(JSON.parse(text))});}catch(e){return json({error:e instanceof Error&&!/SQL|D1|constraint/i.test(e.message)?e.message:'No se pudo guardar.'},400);}}
