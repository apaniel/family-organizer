import {NextRequest,NextResponse} from 'next/server';
import {verifiedFamilyEmail} from '@/lib/cloudflare-family-access';
export const dynamic='force-dynamic';
async function handle(req:NextRequest,post=false){
 const email=await verifiedFamilyEmail(req.headers.get('cf-access-jwt-assertion'));
 if(!email)return NextResponse.json({error:'Inicia sesión para hablar con Rufus.'},{status:401});
 if(post&&req.headers.get('origin')!==new URL(req.url).origin)return NextResponse.json({error:'Unauthorized'},{status:403});
 const person=['apavicio@gmail.com','dapamar90@gmail.com'].includes(email)?'Dani':'Cris';
 try{
  const secret=process.env.APALAS_CHAT_SECRET;
  if(!secret)throw new Error('Not configured');
  let body:string|undefined;
  if(post){
   if(Number(req.headers.get('content-length')||0)>18000)return NextResponse.json({error:'Mensaje demasiado largo'},{status:400});
   const raw=await req.text();if(raw.length>18000)return NextResponse.json({error:'Mensaje demasiado largo'},{status:400});
   const data=JSON.parse(raw);
   if(typeof data.text!=='string'||!data.text.trim()||data.text.length>4000||typeof data.id!=='string'||!/^[a-f0-9-]{36}$/.test(data.id))return NextResponse.json({error:'Mensaje no válido'},{status:400});
   body=JSON.stringify({text:data.text,id:data.id});
  }
  const response=await fetch('https://apalas-chat.apaniel.dev/chat',{method:post?'POST':'GET',headers:{Authorization:'Bearer '+secret,'X-Apalas-Person':person,'Content-Type':'application/json'},body,redirect:'error',signal:AbortSignal.timeout(25000),cache:'no-store'});
  const result=await response.json();
  return NextResponse.json(result,{status:response.status,headers:{'Cache-Control':'private, no-store'}});
 }catch{return NextResponse.json({error:'Rufus no está disponible ahora. Inténtalo en un momento.'},{status:503});}
}
export async function GET(req:NextRequest){return handle(req);}
export async function POST(req:NextRequest){return handle(req,true);}
