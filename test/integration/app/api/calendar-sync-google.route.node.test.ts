import { describe,it,expect,vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/calendar-sync-auth', () => ({ requireCalendarSyncRouteAuth:vi.fn() }));
vi.mock('@/lib/google-calendar/sync', () => ({ runGoogleCalendarSync:vi.fn(), getGoogleCalendarStatus:vi.fn() }));
import { requireCalendarSyncRouteAuth } from '@/lib/calendar-sync-auth';
import { runGoogleCalendarSync } from '@/lib/google-calendar/sync';
import { POST } from '@/app/api/calendar-sync/google/run/route';
describe('Google calendar sync route',()=>{
 it('does not run an unauthenticated sync',async()=>{
  vi.mocked(requireCalendarSyncRouteAuth).mockResolvedValue({authorized:false,reason:'missing'});
  const r=await POST(new NextRequest('https://example.test/api/calendar-sync/google/run',{method:'POST'}));
  expect(r.status).toBe(401);expect(runGoogleCalendarSync).not.toHaveBeenCalled();
 });
 it('does not leak upstream errors or private URLs',async()=>{
  vi.mocked(requireCalendarSyncRouteAuth).mockResolvedValue({authorized:true,kind:'cron'});
  vi.mocked(runGoogleCalendarSync).mockRejectedValue(new Error('https://calendar.google.com/private-secret'));
  const r=await POST(new NextRequest('https://example.test/api/calendar-sync/google/run',{method:'POST'}));
  expect(r.status).toBe(502);expect(await r.text()).not.toContain('private-secret');
 });
});
