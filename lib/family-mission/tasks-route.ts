import {NextRequest} from 'next/server';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
import {verifiedFamilyEmail} from '@/lib/cloudflare-family-access';
export async function taskActor(req:NextRequest){const auth=await requireCalendarSyncRouteAuth(req);if(!auth.authorized)return null;if(auth.kind==='service')return 'service';if(req.method!=='GET'&&req.headers.get('origin')!==new URL(req.url).origin)return null;return await verifiedFamilyEmail(req.headers.get('cf-access-jwt-assertion'));}
