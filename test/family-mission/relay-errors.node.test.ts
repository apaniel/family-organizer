import {it,expect,vi,beforeEach} from 'vitest';
import {NextRequest} from 'next/server';
import {POST} from '@/app/api/family/tasks/relay/route';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
import {workerRelay} from '@/lib/family-mission/tasks-relay';
import {classifyRelayError} from '@/lib/family-mission/relay-errors';
vi.mock('server-only',()=>({}));
vi.mock('@/lib/calendar-sync-auth',()=>({requireCalendarSyncRouteAuth:vi.fn()}));
vi.mock('@/lib/family-mission/tasks-relay',()=>({workerRelay:vi.fn(),getTaskOperation:vi.fn(),taskSnapshot:vi.fn()}));
vi.mock('@/lib/family-mission/tasks-route',()=>({taskActor:vi.fn()}));
beforeEach(()=>{vi.mocked(requireCalendarSyncRouteAuth).mockResolvedValue({authorized:true,kind:'service'});vi.spyOn(console,'error').mockImplementation(()=>{});});
const post=(text=JSON.stringify({action:'claim'}))=>POST(new NextRequest('https://dashboard.test/api/family/tasks/relay',{method:'POST',body:text}));
it('distinguishes the D1 daily write quota from protocol rejection without logging private data',async()=>{
 vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-03T23:59:30Z'));
 vi.mocked(workerRelay).mockRejectedValue(new Error("D1_ERROR: Your account has exceeded D1's free tier daily row write limit. SQL private-token"));
 const res=await post();expect(res.status).toBe(503);expect(await res.json()).toEqual({error:'Relay unavailable',reason:'d1_daily_write_limit'});expect(res.headers.get('Retry-After')).toBe('30');expect(res.headers.get('Cache-Control')).toBe('no-store');
 expect(console.error).toHaveBeenCalledExactlyOnceWith(JSON.stringify({event:'tasks_relay_error',action:'claim',status:503,reason:'d1_daily_write_limit',errorName:'Error'}));
});

it.each([
 ['2026-10-03T00:00:00Z',86400],['2026-12-31T23:59:59.500Z',1],['2026-10-03T23:59:58.001Z',2]
])('retries daily read quotas at the next UTC midnight from %s', (now,retryAfter)=>{
 expect(classifyRelayError(new Error("D1_ERROR: exceeded D1's free tier daily row READ limit"),Date.parse(now))).toEqual({status:503,reason:'d1_daily_read_limit',retryAfter});
});
it.each(['D1_ERROR: failed','D1 unavailable','SQLITE_BUSY','storage failure','network connection lost','Worker overloaded'])('classifies storage failure %s',message=>{
 expect(classifyRelayError(new Error(message))).toEqual({status:503,reason:'storage_unavailable',retryAfter:30});
});
it.each(['Invalid transition','Invalid Google mirror','Missing capture generation','Invalid result','Unverified result','Relay unavailable'])('preserves protocol rejection %s',async message=>{
 vi.mocked(workerRelay).mockRejectedValue(new Error(message));const res=await post();expect(res.status).toBe(409);expect(await res.json()).toEqual({error:'Relay request rejected',reason:'rejected'});expect(res.headers.get('Retry-After')).toBeNull();expect(res.headers.get('Cache-Control')).toBe('no-store');expect(console.error).toHaveBeenCalledTimes(1);
});
it('returns invalid_json for malformed JSON before calling the worker',async()=>{
 const res=await post('{private invalid json');expect(res.status).toBe(400);expect(await res.json()).toEqual({error:'Relay request rejected',reason:'invalid_json'});expect(res.headers.get('Retry-After')).toBeNull();expect(res.headers.get('Cache-Control')).toBe('no-store');expect(workerRelay).not.toHaveBeenCalled();expect(console.error).toHaveBeenCalledExactlyOnceWith(JSON.stringify({event:'tasks_relay_error',action:'unknown',status:400,reason:'invalid_json',errorName:'SyntaxError'}));
});
it.each(['claim','snapshot-start','snapshot','begin','finish','private-id',42,null])('logs only allowed actions for %s',async action=>{
 vi.mocked(workerRelay).mockRejectedValue(new Error('SQLITE private SQL'));const res=await post(JSON.stringify({action,records:[{id:'private-id'}],leaseToken:'private-token'}));expect(res.status).toBe(503);expect(await res.json()).toEqual({error:'Relay unavailable',reason:'storage_unavailable'});expect(res.headers.get('Retry-After')).toBe('30');expect(console.error).toHaveBeenCalledExactlyOnceWith(JSON.stringify({event:'tasks_relay_error',action:typeof action==='string'&&['claim','snapshot-start','snapshot','begin','finish'].includes(action)?action:'unknown',status:503,reason:'storage_unavailable',errorName:'Error'}));
});
it.each([null,undefined,42,{},'Invalid result'])('handles non-Error exceptions %s',async error=>{
 expect(classifyRelayError(error)).toEqual({status:409,reason:'rejected'});vi.mocked(workerRelay).mockRejectedValue(error);expect((await post('null')).status).toBe(409);expect(console.error).toHaveBeenCalledExactlyOnceWith(JSON.stringify({event:'tasks_relay_error',action:'unknown',status:409,reason:'rejected',errorName:'Unknown'}));
});
it.each([{authorized:false,kind:'service'},{authorized:true,kind:'email'}])('preserves auth rejection %j',async auth=>{
 vi.mocked(requireCalendarSyncRouteAuth).mockResolvedValue(auth);const res=await post('{');expect(res.status).toBe(401);expect(await res.json()).toEqual({error:'Unauthorized'});expect(workerRelay).not.toHaveBeenCalled();expect(console.error).not.toHaveBeenCalled();
});
it('preserves the body size limit',async()=>{const res=await post(' '.repeat(2100001));expect(res.status).toBe(413);expect(await res.json()).toEqual({error:'Too large'});expect(workerRelay).not.toHaveBeenCalled();expect(console.error).not.toHaveBeenCalled();});
it('preserves successful relay responses and accepts the size boundary',async()=>{
 vi.mocked(workerRelay).mockResolvedValue({ok:true});const res=await post('{"action":"claim"}'.padEnd(2100000));expect(res.status).toBe(200);expect(await res.json()).toEqual({ok:true});expect(res.headers.get('Cache-Control')).toBe('no-store');expect(workerRelay).toHaveBeenCalledExactlyOnceWith({action:'claim'});expect(console.error).not.toHaveBeenCalled();
});
