import 'server-only';
import type {NextRequest} from 'next/server';
import {isVerifiedFamilyParent} from './cloudflare-family-access';
export async function requireCalendarSyncRouteAuth(request:NextRequest){
 const secret=process.env.CALENDAR_SYNC_CRON_SECRET;
 if(secret && request.headers.get('x-calendar-sync-secret')===secret)return {authorized:true,kind:'service'};
 return {authorized:await isVerifiedFamilyParent(request.headers.get('cf-access-jwt-assertion')),kind:'email'};
}
