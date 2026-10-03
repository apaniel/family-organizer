import {NextRequest,NextResponse} from 'next/server';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
import {workerRelay,getTaskOperation,taskSnapshot} from '@/lib/family-mission/tasks-relay';
import {classifyRelayError} from '@/lib/family-mission/relay-errors';
import {taskActor} from '@/lib/family-mission/tasks-route';
export const dynamic='force-dynamic';
const json=(body:any,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(req:NextRequest){const actor=await taskActor(req);if(!actor)return json({error:'Unauthorized'},401);try{const id=req.nextUrl.searchParams.get('operation');return json(id?await getTaskOperation(id,actor):await taskSnapshot());}catch{return json({error:'Google Tasks unavailable; no fresh verified mirror.'},503);}}
export async function POST(req:NextRequest){
 const auth=await requireCalendarSyncRouteAuth(req);if(!auth.authorized||auth.kind!=='service')return json({error:'Unauthorized'},401);
 let body:unknown;
 try{const text=await req.text();if(text.length>2100000)return json({error:'Too large'},413);body=JSON.parse(text);return json(await workerRelay(body));}
 catch(error){
 const {status,reason,retryAfter}=classifyRelayError(error);
 const action=body&&typeof body==='object'&&'action' in body&&typeof body.action==='string'&&['claim','snapshot-start','snapshot','begin','finish'].includes(body.action)?body.action:'unknown';
 console.error(JSON.stringify({event:'tasks_relay_error',action,status,reason,errorName:error instanceof Error?error.constructor.name:'Unknown'}));
 return NextResponse.json({error:status===503?'Relay unavailable':'Relay request rejected',reason},{status,headers:{'Cache-Control':'no-store',...(retryAfter!==undefined?{'Retry-After':String(retryAfter)}:{})}});
 }
}
