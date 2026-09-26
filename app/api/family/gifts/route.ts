import {NextRequest,NextResponse} from 'next/server';
import {verifiedFamilyEmail} from '@/lib/cloudflare-family-access';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
import {createGift,deleteGift,listGifts,updateGift} from '@/lib/family-mission/gift-store';
import type {GiftFields} from '@/lib/family-mission/gift-model';
export const dynamic = 'force-dynamic';
const response = (body: unknown, status = 200) => NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
async function identity(req: NextRequest) {
 const email = await verifiedFamilyEmail(req.headers.get('cf-access-jwt-assertion'));
 if (email) return ['crislacorte@hotmail.com','lacorte.cristina@gmail.com'].includes(email) ? 'Cris' : 'Dani';
 const service = await requireCalendarSyncRouteAuth(req);
 return service.authorized && service.kind === 'service' ? 'Rufus' : null;
}
class Invalid extends Error {}
async function body(req: NextRequest): Promise<Record<string,unknown>> {
 try {
  const value = await req.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Invalid();
  return value;
 } catch { throw new Invalid(); }
}
function fields(raw: Record<string,unknown>, create = false): Partial<GiftFields> {
 const result: Partial<GiftFields> = {};
 for (const field of ['title','notes'] as const) {
  if (raw[field] !== undefined) {
   if (typeof raw[field] !== 'string') throw new Invalid();
   const value = raw[field].trim();
   if (value.length > (field === 'title' ? 200 : 2000) || (field === 'title' && !value)) throw new Invalid();
   result[field] = value;
  }
 }
 for (const [field,allowed] of [['child',['Paula','Alejandra']],['occasion',['unassigned','birthday','christmas']],['status',['idea','bought']]] as const) {
  if (raw[field] !== undefined) {
   if (!(allowed as readonly unknown[]).includes(raw[field])) throw new Invalid();
   Object.assign(result,{[field]:raw[field]});
  }
 }
 if (create) {
  if (!result.title || !result.child) throw new Invalid();
  result.occasion ??= 'unassigned';
  result.status ??= 'idea';
 } else if (!Object.keys(result).length) throw new Invalid();
 return result;
}
function target(raw: Record<string,unknown>): {id:string;revision:number} {
 if (typeof raw.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(raw.id) || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 1) throw new Invalid();
 return {id:raw.id,revision:raw.revision as number};
}
function failure(error: unknown) {
 if (error instanceof Invalid) return response({error:'Datos no válidos. Revisa la idea y vuelve a intentarlo.'},400);
 if (error instanceof Error && error.message === 'CONFLICT') return response({error:'Esta idea ha cambiado. Recarga las ideas antes de volver a intentarlo.'},409);
 if (error instanceof Error && error.message === 'NOT_FOUND') return response({error:'La idea ya no existe. Recarga las ideas.'},404);
 return response({error:'No se pudieron guardar o cargar las ideas. Inténtalo de nuevo.'},503);
}
export async function GET(req: NextRequest) {
 if (!await identity(req)) return response({error:'Unauthorized'},401);
 try { return response({items:await listGifts()}); } catch (e) { return failure(e); }
}
export async function POST(req: NextRequest) {
 const createdBy = await identity(req);
 if (!createdBy) return response({error:'Unauthorized'},401);
 try { return response({item:await createGift({...fields(await body(req),true) as GiftFields,createdBy})},201); } catch (e) { return failure(e); }
}
export async function PATCH(req: NextRequest) {
 if (!await identity(req)) return response({error:'Unauthorized'},401);
 try {
  const raw = await body(req), {id,revision} = target(raw);
  return response({item:await updateGift(id,revision,fields(raw))});
 } catch (e) { return failure(e); }
}
export async function DELETE(req: NextRequest) {
 if (!await identity(req)) return response({error:'Unauthorized'},401);
 try {
  const {id,revision} = target(await body(req));
  await deleteGift(id,revision);
  return response({ok:true});
 } catch (e) { return failure(e); }
}
