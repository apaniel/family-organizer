import {NextRequest,NextResponse} from 'next/server';
import {verifiedFamilyEmail} from '@/lib/cloudflare-family-access';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
import {createConversation,deleteEmptyConversation,listChat,listConversations,type ChatConversation} from '@/lib/family-mission/chat-store';
import {legacyChat} from '@/lib/family-mission/legacy-chat';
export const dynamic='force-dynamic';
type External='finenance'|'allianz';
type Identity={person:'Dani'|'Cris';source:External|null};
function external(req:NextRequest):External|null{const value=req.nextUrl.searchParams.get('external');return value==='finenance'||value==='allianz'?value:null;}
async function identity(req:NextRequest):Promise<Identity|null>{
 const source=external(req);
 if(source){const auth=await requireCalendarSyncRouteAuth(req),requested=req.nextUrl.searchParams.get('person');return auth.authorized&&auth.kind==='service'&&(requested==='Dani'||requested==='Cris')?{person:requested,source}:null;}
 const email=await verifiedFamilyEmail(req.headers.get('cf-access-jwt-assertion'));
 return email?{person:['apavicio@gmail.com','dapamar90@gmail.com'].includes(email)?'Dani':'Cris',source:null}:null;
}
export async function GET(req:NextRequest){
 const who=await identity(req);if(!who)return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const {person,source}=who,query=(req.nextUrl.searchParams.get('q')||'').trim(),current=source?await listConversations(person,query,source):await listConversations(person,query);
  if(source)return NextResponse.json({person,conversations:current},{headers:{'Cache-Control':'private, no-store'}});
  const [old,unmapped]=await Promise.all([legacyChat(person),listChat(person)]),history=[...old,...unmapped],matches=!query||history.some(item=>`${item.text} ${item.answer||''}`.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es'))),legacy:ChatConversation|undefined=history.length&&matches?{id:'legacy-'+person.toLowerCase(),person,title:'Conversación anterior',createdAt:new Date(Math.min(...history.map(item=>item.created))*1000).toISOString(),updatedAt:new Date(Math.max(...history.map(item=>item.created))*1000).toISOString()}:undefined;
  return NextResponse.json({person,conversations:[...current,...(legacy?[legacy]:[])].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))},{headers:{'Cache-Control':'private, no-store'}});
 }catch{return NextResponse.json({error:'No se pudieron cargar las conversaciones.'},{status:503});}
}
export async function POST(req:NextRequest){
 const source=external(req),origin=req.headers.get('origin');if(!source&&origin&&origin!==new URL(req.url).origin)return NextResponse.json({error:'Unauthorized'},{status:403});
 const who=await identity(req);if(!who)return NextResponse.json({error:'Unauthorized'},{status:401});
 try{const body=await req.json(),title=typeof body.title==='string'?body.title:'Nueva conversación',conversation=who.source?await createConversation(who.person,title,who.source):await createConversation(who.person,title);return NextResponse.json({conversation},{status:201});}catch{return NextResponse.json({error:'No se pudo crear la conversación.'},{status:503});}
}
export async function DELETE(req:NextRequest){const who=await identity(req);if(!who)return NextResponse.json({error:'Unauthorized'},{status:401});try{const body=await req.json();if(typeof body.id!=='string'||(who.source&&!body.id.startsWith(who.source+'-')))return NextResponse.json({error:'Datos no válidos.'},{status:400});await deleteEmptyConversation(who.person,body.id);return NextResponse.json({ok:true});}catch{return NextResponse.json({error:'No se pudo eliminar.'},{status:409});}}
