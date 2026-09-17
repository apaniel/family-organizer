import {NextRequest,NextResponse} from 'next/server';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
import {uploadDocument} from '@/lib/family-mission/digest-store';
export const dynamic='force-dynamic';
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 if(!(await requireCalendarSyncRouteAuth(req)).authorized)return NextResponse.json({error:'Acceso no autorizado.'},{status:401});
 const reader=req.body?.getReader();if(!reader)return new Response('Missing file',{status:400});let length=0;const parts:Uint8Array[]=[];
 while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>5*1024*1024){await reader.cancel();return new Response('Too large',{status:413});}parts.push(value);}
 const bytes=new Uint8Array(length);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
 try{const {id}=await params;const document=await uploadDocument(id,decodeURIComponent(req.headers.get('x-filename')||'recibo.pdf'),bytes);return NextResponse.json({document},{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'No se pudo guardar el archivo. Usa PDF, JPEG o PNG de hasta 5 MB.'},{status:400});}
}
