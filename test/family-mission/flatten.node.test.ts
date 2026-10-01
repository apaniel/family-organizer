import {it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
import {flattenRecord} from '@/lib/family-mission/flatten';
import {POST} from '@/app/api/family/records/flatten/route';
vi.mock('server-only',()=>({}));
vi.mock('@/lib/calendar-sync-auth',()=>({requireCalendarSyncRouteAuth:vi.fn()}));
it.each([null,{}, {id:'old',confirm:false},{id:'old',confirm:true}])('never migrates stale D1 tasks: %j',async raw=>{await expect(flattenRecord(raw)).rejects.toThrow('migración');vi.mocked(requireCalendarSyncRouteAuth).mockResolvedValue({authorized:true,kind:'service'} as any);expect((await POST(new NextRequest('https://dashboard.test/api/family/records/flatten',{method:'POST',body:JSON.stringify(raw)}))).status).toBe(409);});
it.each([{authorized:false,kind:'email',status:401},{authorized:true,kind:'email',status:403}])('preserves auth rejection %j',async auth=>{vi.mocked(requireCalendarSyncRouteAuth).mockResolvedValue(auth as any);expect((await POST(new NextRequest('https://dashboard.test/api/family/records/flatten',{method:'POST',body:'{}'}))).status).toBe(auth.status);});
