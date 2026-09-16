import {beforeEach,describe,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
vi.mock('@/lib/cloudflare-family-access',()=>({isVerifiedFamilyParent:vi.fn(async()=>false)}));
import {isVerifiedFamilyParent} from '@/lib/cloudflare-family-access';
import {middleware} from '@/middleware';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
describe('email-only family access',()=>{
 beforeEach(()=>{vi.mocked(isVerifiedFamilyParent).mockResolvedValue(false);process.env.CALENDAR_SYNC_CRON_SECRET='test-service';});
 it('lets verified email users enter without device cookies or PIN',async()=>{vi.mocked(isVerifiedFamilyParent).mockResolvedValue(true);const r=await middleware(new NextRequest('https://apalas.apaniel.dev/'));expect(r.headers.get('x-middleware-next')).toBe('1');expect(r.headers.get('set-cookie')).toBeNull();});
 it('rejects the old device-cookie bypass',async()=>{const r=await middleware(new NextRequest('https://apalas.apaniel.dev/',{headers:{cookie:'family_device_auth=true'}}));expect(r.status).toBe(403);});
 it('retires the PIN API',async()=>{expect((await middleware(new NextRequest('https://apalas.apaniel.dev/api/instant-auth-parent-token'))).status).toBe(404);});
 it('routes legacy bookmarks back to the new planner',async()=>{vi.mocked(isVerifiedFamilyParent).mockResolvedValue(true);expect((await middleware(new NextRequest('https://apalas.apaniel.dev/legacy'))).headers.get('location')).toBe('https://apalas.apaniel.dev/');});
 it('uses verified email for data access',async()=>{vi.mocked(isVerifiedFamilyParent).mockResolvedValue(true);expect((await requireCalendarSyncRouteAuth(new NextRequest('https://apalas.apaniel.dev/api/family/records'))).authorized).toBe(true);});
 it('keeps the Hermes service working',async()=>{expect((await requireCalendarSyncRouteAuth(new NextRequest('https://apalas.apaniel.dev/api/family/records',{headers:{'x-calendar-sync-secret':'test-service'}}))).authorized).toBe(true);});
 it('does not accept old parent tokens or cookies for data access',async()=>{expect((await requireCalendarSyncRouteAuth(new NextRequest('https://apalas.apaniel.dev/api/family/records',{headers:{cookie:'family_device_auth=true','x-instant-auth-token':'old-token'}}))).authorized).toBe(false);});
});
