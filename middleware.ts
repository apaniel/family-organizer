import {NextResponse,type NextRequest} from 'next/server';
import {isVerifiedFamilyParent} from '@/lib/cloudflare-family-access';
export async function middleware(request:NextRequest){
 const path=request.nextUrl.pathname;
 // These endpoints verify email or the existing Hermes service credential themselves.
 if(path==='/sw.js')return NextResponse.next();
 if(path.startsWith('/api/family/')||path==='/api/health')return NextResponse.next();
 if(path.startsWith('/api/'))return new NextResponse('Not Found',{status:404});
 if(!(await isVerifiedFamilyParent(request.headers.get('cf-access-jwt-assertion'))))
  return new NextResponse('Acceso no autorizado. Inicia sesión con un correo autorizado.',{status:403,headers:{'Cache-Control':'no-store'}});
 if(!['/','/family-calendar','/week','/agent-backlog'].includes(path))return NextResponse.redirect(new URL('/',request.url));
 return NextResponse.next();
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico|fonts/).*)']};
