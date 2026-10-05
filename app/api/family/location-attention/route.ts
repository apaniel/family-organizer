import {NextRequest,NextResponse} from 'next/server';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
import {saveAttention} from '@/lib/family-mission/location-store';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
// Only derived, short-lived states from the reviewed consumer. No health/location stream.
export async function POST(req:NextRequest){const auth=await requireCalendarSyncRouteAuth(req);if(!auth.authorized)return reply({error:'No autorizado'},401);if(auth.kind!=='service')return reply({error:'Solo el consumidor autorizado'},403);
 try{const body=await req.json();if(!Array.isArray(body.items)||body.items.length>100||JSON.stringify(body).length>30000)return reply({error:'Datos no válidos'},400);const now=Date.now();const items=[];
 for(const raw of body.items){if(!raw||Object.keys(raw).some(k=>!['ruleId','person','ruleRevision','placeRevision','state','observedAt','validUntil','version'].includes(k))||raw.version!==1||!Number.isSafeInteger(raw.ruleRevision)||raw.ruleRevision<1||!Number.isSafeInteger(raw.placeRevision)||raw.placeRevision<1||typeof raw.ruleId!=='string'||raw.ruleId.length>100||!['Dani','Cris'].includes(raw.person)||!['arrived','nearby','outside','unavailable'].includes(raw.state))return reply({error:'Datos no válidos'},400);const observed=Date.parse(raw.observedAt),until=Date.parse(raw.validUntil);if(!Number.isFinite(observed)||!Number.isFinite(until)||observed>now||now-observed>300000||until<=now||until-observed>300000)return reply({error:'Estado caducado'},400);items.push({...raw,observedAt:new Date(observed).toISOString(),validUntil:new Date(until).toISOString()});}
 await saveAttention(items);return reply({ok:true});}catch{return reply({error:'Estado no disponible'},503);}}
