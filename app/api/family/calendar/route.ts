import {NextRequest,NextResponse} from 'next/server';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
import {googleEvents} from '@/lib/family-mission/google';
import {dateKey,addDays} from '@/lib/family-mission/model';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){if(!(await requireCalendarSyncRouteAuth(req)).authorized)return NextResponse.json({error:'No autorizado'},{status:401});
 const from=req.nextUrl.searchParams.get('from')||dateKey();const to=req.nextUrl.searchParams.get('to')||addDays(from,90);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||to<from||Date.parse(to)-Date.parse(from)>370*86400000)return NextResponse.json({error:'Rango no válido'},{status:400});
 try{return NextResponse.json({events:await googleEvents(from,to)},{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'No se pudo cargar Google Calendar'},{status:503});}}
