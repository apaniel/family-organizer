import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {NextRequest} from 'next/server';
import {POST,DELETE,GET} from '@/app/api/family/records/route';
import {taskSnapshot,workerRelay} from '@/lib/family-mission/tasks-relay';
import {saveTask,deleteTask,listTasks,GoogleTasksConflict,GoogleTasksUnconfirmed} from '@/lib/family-mission/google-tasks';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
import {taskActor} from '@/lib/family-mission/tasks-route';
import {readNonTaskRecords} from '@/lib/family-mission/store';
import {getCloudflareContext} from '@opennextjs/cloudflare';
vi.mock('server-only',()=>({}));
vi.mock('@opennextjs/cloudflare',()=>({getCloudflareContext:vi.fn()}));
vi.mock('@/lib/calendar-sync-auth',()=>({requireCalendarSyncRouteAuth:vi.fn(async()=>({authorized:true,kind:'service'}))}));
vi.mock('@/lib/family-mission/tasks-route',()=>({taskActor:vi.fn(async()=> 'service')}));
vi.mock('@/lib/family-mission/store',()=>({readNonTaskRecords:vi.fn(async()=>[]),saveRecord:vi.fn(),saveCompletedTask:vi.fn(),removeRecord:vi.fn()}));
vi.mock('@/lib/family-mission/google-tasks',()=>({
 listTasks:vi.fn(),saveTask:vi.fn(),deleteTask:vi.fn(),
 GoogleTasksConflict:class extends Error {},GoogleTasksUnconfirmed:class extends Error {}
}));
const task={kind:'task',id:'task-id',revision:10,title:'Private title',date:'2026-10-01',time:'',notes:'Private notes',owner:'Familia',status:'open',recurrence:'none',checklist:[],store:'google-tasks'};
const draft={...task,id:'',revision:0};
const request=(method:string,body:unknown,key?:string)=>new NextRequest('https://dashboard.test/api/family/records',{method,body:JSON.stringify(body),headers:key?{'idempotency-key':key}:{}});
beforeEach(()=>{vi.mocked(requireCalendarSyncRouteAuth).mockResolvedValue({authorized:true,kind:'service'});vi.mocked(taskActor).mockResolvedValue('service');vi.mocked(readNonTaskRecords).mockResolvedValue([]);vi.stubEnv('TASKS_DIRECT','1');vi.mocked(listTasks).mockResolvedValue([task] as never);vi.mocked(saveTask).mockResolvedValue({record:task} as never);vi.mocked(deleteTask).mockResolvedValue({ok:true} as never);});
afterEach(()=>vi.unstubAllEnvs());
it('reads direct tasks with the snapshot contract without D1',async()=>{
 expect(await taskSnapshot()).toMatchObject({records:[task],store:'google-tasks',mirror:false,refreshedAt:expect.any(String)});
 expect(await (await GET(new NextRequest('https://dashboard.test/api/family/records'))).json()).toMatchObject({records:[task],taskMirror:false,taskAvailable:true});
 expect(getCloudflareContext).not.toHaveBeenCalled();
});
it('creates synchronously with an actor-scoped deterministic source key',async()=>{
 const result=await POST(request('POST',draft,'intent-123'));
 expect(result.status).toBe(200);expect(await result.json()).toEqual({operationId:'intent-123',state:'done',record:task});
 expect(saveTask).toHaveBeenCalledWith(expect.objectContaining({sourceKey:'dashboard:'+createHash('sha256').update('service\nintent-123').digest('hex')}));
 expect(getCloudflareContext).not.toHaveBeenCalled();
});
it('keyless creates deduplicate using the validated payload',async()=>{
 await POST(request('POST',draft));const first=vi.mocked(saveTask).mock.calls[0][0];await POST(request('POST',draft));expect(vi.mocked(saveTask).mock.calls[1][0]).toEqual(first);
});
it('rejects unsupported inputs before sending a direct write',async()=>{
 expect((await POST(request('POST',{...draft,recurrence:'daily'}))).status).toBe(400);expect(saveTask).not.toHaveBeenCalled();
});
it('returns stale-revision conflicts as failed 409',async()=>{
 vi.mocked(saveTask).mockRejectedValue(new GoogleTasksConflict('changed'));
 const result=await POST(request('POST',task,'intent-123'));expect(result.status).toBe(409);expect(await result.json()).toEqual({operationId:'intent-123',state:'failed',error:'Conflicto: la tarea cambió antes de ejecutar. Actualiza la página.'});
});
it('returns uncertain writes as ambiguous 503 without retry',async()=>{
 vi.mocked(saveTask).mockRejectedValue(new GoogleTasksUnconfirmed('uncertain'));
 const result=await POST(request('POST',draft,'intent-123'));expect(result.status).toBe(503);expect(await result.json()).toEqual({operationId:'intent-123',state:'ambiguous',error:'La operación está pendiente de verificación en Google. No está completada.'});expect(saveTask).toHaveBeenCalledTimes(1);
});
it('passes the deletion revision and returns synchronous success',async()=>{
 const result=await DELETE(request('DELETE',task,'intent-123'));expect(result.status).toBe(200);expect(await result.json()).toEqual({operationId:'intent-123',state:'done',ok:true});expect(deleteTask).toHaveBeenCalledWith('task-id',10);
});
it.each(['claim','snapshot-start','snapshot','begin','finish'])('keeps the running relay from accessing D1 for %s',async action=>{
 expect(await workerRelay({action})).toEqual(action==='claim'?{command:null}:action==='snapshot-start'?{generation:null}:{ok:false});expect(getCloudflareContext).not.toHaveBeenCalled();
});
it('keeps the flag-off snapshot path intact',async()=>{
 vi.stubEnv('TASKS_DIRECT','0');const refreshedAt=Date.now();const first=vi.fn(async()=>({records:JSON.stringify([task]),refreshed_at:refreshedAt}));const prepare=vi.fn(()=>({first}));vi.mocked(getCloudflareContext).mockResolvedValue({env:{FAMILY_DB:{prepare}}} as never);
 expect(await taskSnapshot()).toEqual({records:[task],store:'google-tasks',mirror:true,refreshedAt:new Date(refreshedAt).toISOString()});expect(listTasks).not.toHaveBeenCalled();expect(prepare).toHaveBeenCalledWith('SELECT * FROM google_tasks_mirror WHERE id=1');
});
it('keeps flag-off writes on the durable relay path',async()=>{
 vi.stubEnv('TASKS_DIRECT','0');const {commandPayload}=await import('@/lib/family-mission/tasks-relay');
 const row={id:'service:intent-123',actor:'service',payload:JSON.stringify(commandPayload('save',draft)),state:'done',result:JSON.stringify({record:task})};
 const first=vi.fn(async()=>row);const bind=vi.fn(()=>({first}));const prepare=vi.fn(()=>({bind}));vi.mocked(getCloudflareContext).mockResolvedValue({env:{FAMILY_DB:{prepare}}} as never);
 const result=await POST(request('POST',draft,'intent-123'));expect(result.status).toBe(200);expect(await result.json()).toEqual({operationId:'service:intent-123',state:'done',record:task});expect(saveTask).not.toHaveBeenCalled();expect(prepare).toHaveBeenCalledWith('SELECT * FROM google_tasks_commands WHERE id=?');
});
