import {NextRequest,NextResponse} from 'next/server';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
 if(!(await requireCalendarSyncRouteAuth(req)).authorized)return NextResponse.json({error:'Unauthorized'},{status:401});
 const secret=process.env.APALAS_CHAT_SECRET;
 if(!secret)return NextResponse.json({ok:false,stage:'configuration'},{status:503});
 try{const r=await fetch('https://apalas-chat.apaniel.dev/chat',{headers:{Authorization:'Bearer '+secret,'User-Agent':'ApalasDashboard/1.0','X-Apalas-Person':'Dani','Content-Type':'application/json'},redirect:'manual',signal:AbortSignal.timeout(15000),cache:'no-store'});const d=await r.json();return NextResponse.json({ok:r.ok,upstream:r.status,validHistory:Array.isArray(d.messages)},{status:r.ok?200:503,headers:{'Cache-Control':'no-store'}});}catch(e){return NextResponse.json({ok:false,stage:'transport',error:e instanceof Error?e.name:'Error'},{status:503});}
}
