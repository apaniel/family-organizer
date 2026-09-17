import {NextRequest} from 'next/server';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
import {digestEnv} from '@/lib/family-mission/digest-store';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 if(!(await requireCalendarSyncRouteAuth(req)).authorized)return new Response('Acceso no autorizado.',{status:401});
 try{const {id}=await params;const e=await digestEnv();const doc=await e.FAMILY_DB.prepare('SELECT * FROM family_documents WHERE id=?').bind(id).first();if(!doc)return new Response('Not found',{status:404});const obj=await e.FAMILY_DOCUMENTS.get(doc.object_key);if(!obj)return new Response('Not found',{status:404});
 return new Response(obj.body,{headers:{'Content-Type':doc.mime,'Content-Disposition':`attachment; filename="${doc.filename}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}});}catch{return new Response('Unavailable',{status:503});}
}
