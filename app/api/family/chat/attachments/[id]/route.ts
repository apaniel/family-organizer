import {NextRequest} from 'next/server';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
import {chatAttachment} from '@/lib/family-mission/chat-store';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){const auth=await requireCalendarSyncRouteAuth(req);if(!auth.authorized||auth.kind!=='service')return new Response('Unauthorized',{status:401});const {id}=await params,item=await chatAttachment(id);if(!item)return new Response('Not found',{status:404});const filename=String(item.name).replace(/["\r\n]/g,'_');return new Response(item.body,{headers:{'Content-Type':item.type,'Content-Disposition':`attachment; filename="${filename}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}});}
