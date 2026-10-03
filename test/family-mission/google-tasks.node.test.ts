import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
vi.mock('server-only',()=>({}));
type Task={id:string;title:string;notes?:string;updated:string;status:string;due?:string|null;completed?:string|null;webViewLink?:string};
const updated='2026-10-01T10:12:13.456Z';
const revision=(value:string)=>parseInt(createHash('sha256').update(value).digest('hex').slice(0,13),16);
let tasks:Map<string,Task>;let events:Map<string,Record<string,unknown>>;let calls:{url:URL;method:string;body:Record<string,unknown>}[];let rejectPost:boolean;let failPostStatus:number;let failPatchAfterEventDelete:boolean;
const response=(body:unknown,status=200)=>new Response(status===204?null:JSON.stringify(body),{status});
const draft={kind:'task' as const,title:'Private title',date:'',time:'',notes:'Private notes',owner:'Familia',category:'family',status:'open' as const,recurrence:'none' as const,checklist:[],reminderDays:0,sourceKey:'dashboard:fixture'};
beforeEach(()=>{
 vi.resetModules();vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
 for(const name of ['TASKS','CALENDAR'])for(const part of ['CLIENT_ID','CLIENT_SECRET','REFRESH_TOKEN'])vi.stubEnv(`GOOGLE_${name}_${part}`,`${name}_${part}_secret`);
 tasks=new Map();events=new Map();calls=[];rejectPost=false;failPostStatus=0;failPatchAfterEventDelete=false;
 vi.stubGlobal('fetch',vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);const method=init?.method||'GET';
  const body=init?.body&&typeof init.body==='string'?JSON.parse(init.body):{};calls.push({url,method,body});
  if(url.hostname==='oauth2.googleapis.com')return response({access_token:'private-access-token',expires_in:3600});
  if(url.pathname.endsWith('/users/@me/lists'))return response({items:[{id:'familia-list',title:'Familia'}]});
  if(url.pathname.includes('/calendar/v3/')){
   const id=url.pathname.split('/events/')[1];
   if(method==='POST'){const id=String(body.id||'event-1');if(events.has(id))return response({},409);const event={...body,id};events.set(id,event);return response(event);}
   if(method==='DELETE'){events.delete(id);return response(null,204);}
   if(method==='PATCH'||method==='PUT'){const old=events.get(id);if(!old)return response({},404);const previous=old.extendedProperties;const next=body.extendedProperties;const oldPrivate=previous&&typeof previous==='object'&&'private' in previous?previous.private:{};const newPrivate=next&&typeof next==='object'&&'private' in next?next.private:{};const event={...old,...body,id,extendedProperties:{private:{...(oldPrivate&&typeof oldPrivate==='object'?oldPrivate:{}),...(newPrivate&&typeof newPrivate==='object'?newPrivate:{})}}};events.set(id,event);return response(event);}
   if(id)return events.has(id)?response(events.get(id)):response({},404);
   return response({items:Array.from(events.values())});
  }
  const id=url.pathname.match(/\/lists\/[^/]+\/tasks\/([^/]+)$/)?.[1]||'';
  if(method==='POST'){
   if(rejectPost)throw new Error('Network error private-access-token Private title Private notes');
   if(failPostStatus)return response({error:{message:'Private notes private-access-token'}},failPostStatus);
   const task={...body,id:'task-1',updated,status:typeof body.status==='string'?body.status:'needsAction',title:String(body.title||'')};tasks.set(task.id,task);return response(task);
  }
  if(method==='PATCH'){
   if(failPatchAfterEventDelete&&calls.some(c=>c.method==='DELETE'&&c.url.pathname.includes('/calendar/v3/')))return response({},412);
   const old=tasks.get(id);if(!old)return response({},404);
   const task={...old,...body,updated};for(const key of ['completed','due'] as const)if(task[key]===null)delete task[key];tasks.set(id,task);return response(task);
  }
  if(method==='DELETE'){tasks.delete(id);return response(null,204);}
  if(id)return tasks.has(id)?response(tasks.get(id)):response({},404);
  return response({items:Array.from(tasks.values())});
 }));
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();});
const api=()=>import('@/lib/family-mission/google-tasks');
const seed=(patch:Partial<Task>={})=>{tasks.set('task-1',{id:'task-1',title:'Private title',notes:'Private notes\n\n#hermes cat=family&key=dashboard%3Afixture',updated,status:'needsAction',...patch});};
it('preserves the exact relay snapshot shape and Python revision formula',async()=>{
 seed({due:'2026-10-04T00:00:00.000Z',notes:'Visible\nResponsable (Dashboard): Sin asignar\n\n#hermes aviso=2&cat=admin&estado=esperando&evento=event-1&hora=09%3A30&key=dashboard%3Afixture',webViewLink:'https://tasks.google.com/task-1'});
 const {listTasks}=await api();expect(await listTasks()).toEqual([{kind:'task',id:'task-1',title:'Private title',date:'2026-10-04',endDate:'',time:'09:30',endTime:'',owner:'Sin asignar',status:'waiting',category:'admin',notes:'Visible',checklist:[],audience:'adults',recurrence:'none',confirmed:true,reminderDays:2,sourceKey:'dashboard:fixture',updatedAt:updated,completedAt:null,eventId:'event-1',webViewLink:'https://tasks.google.com/task-1',store:'google-tasks',revision:revision(updated),slot:'dinner',source:'Google Tasks'}]);
});
it('caches reads for 15 seconds and access tokens until 60 seconds before expiry',async()=>{
 const {listTasks}=await api();await listTasks();const count=calls.length;await listTasks();expect(calls).toHaveLength(count);
 vi.advanceTimersByTime(15001);await listTasks();expect(calls.length).toBeGreaterThan(count);expect(calls.filter(c=>c.url.hostname==='oauth2.googleapis.com')).toHaveLength(1);
 vi.advanceTimersByTime(3525000);await listTasks();expect(calls.filter(c=>c.url.hostname==='oauth2.googleapis.com')).toHaveLength(2);
});
it('dedupes creation by sourceKey without reopening an already completed task',async()=>{
 seed({status:'completed',completed:'2026-10-01T11:00:00.000Z'});const {saveTask}=await api();const result=await saveTask(draft);
 expect(result).toMatchObject({created:false,duplicate:true,record:{id:'task-1',status:'done'}});expect(calls.filter(c=>c.method==='POST'&&c.url.hostname!=='oauth2.googleapis.com')).toHaveLength(0);
});
it('rejects stale revisions before making a Google mutation',async()=>{
 seed();const {saveTask,GoogleTasksConflict}=await api();await expect(saveTask({...draft,id:'task-1',revision:revision(updated)-1})).rejects.toBeInstanceOf(GoogleTasksConflict);
 expect(calls.filter(c=>['POST','PATCH','DELETE'].includes(c.method)&&c.url.hostname!=='oauth2.googleapis.com')).toHaveLength(0);
});
it('creates one linked event, updates it on retries, and removes it when the task loses its time',async()=>{
 const {saveTask,listTasks}=await api();const timed={...draft,date:'2026-10-04',time:'09:30',reminderDays:2};const first=await saveTask(timed);const eventId='4210b937a4a96787f61699c742b87a4636d93260b1a39599452e07d2b5116bc6';expect(first.record.eventId).toBe(eventId);
 await saveTask(timed);expect(calls.filter(c=>c.method==='POST'&&c.url.pathname.includes('/calendar/v3/'))).toHaveLength(1);
 const event=events.get(eventId);expect(event).toMatchObject({summary:'Private title',description:'Private notes',start:{dateTime:'2026-10-04T09:30:00+02:00',timeZone:'Europe/Madrid'},end:{dateTime:'2026-10-04T10:00:00+02:00',timeZone:'Europe/Madrid'},reminders:{useDefault:false,overrides:[{method:'popup',minutes:0},{method:'popup',minutes:2880}]}});
 await saveTask({...timed,id:first.record.id,revision:first.record.revision,time:''});expect(events.size).toBe(0);expect((await listTasks())[0].eventId).toBeNull();
});
it('deletes the linked Calendar event before deleting the task and verifies absence',async()=>{
 seed({notes:'Private notes\n\n#hermes evento=event-1&key=dashboard%3Afixture'});events.set('event-1',{id:'event-1'});const {deleteTask,listTasks}=await api();await deleteTask('task-1',revision(updated));
 expect(events.size).toBe(0);expect(await listTasks()).toEqual([]);const deletes=calls.filter(c=>c.method==='DELETE');expect(deletes).toHaveLength(2);expect(deletes[0].url.pathname).toContain('/calendar/v3/');
});
it('completes a task using Google Tasks status',async()=>{
 seed();const {saveTask}=await api();expect(await saveTask({...draft,id:'task-1',revision:revision(updated),status:'done'})).toMatchObject({record:{status:'done'}});
 expect(calls.find(c=>c.method==='PATCH')?.body.status).toBe('completed');
});
it('invalidates the read cache after a write',async()=>{
 const {listTasks,saveTask}=await api();expect(await listTasks()).toEqual([]);await saveTask(draft);expect(await listTasks()).toMatchObject([{id:'task-1'}]);
});
it('never retries an uncertain POST and logs only a sanitized failure',async()=>{
 rejectPost=true;const log=vi.spyOn(console,'error').mockImplementation(()=>{});const {saveTask,GoogleTasksUnconfirmed}=await api();await expect(saveTask(draft)).rejects.toBeInstanceOf(GoogleTasksUnconfirmed);
 expect(calls.filter(c=>c.method==='POST'&&c.url.hostname!=='oauth2.googleapis.com')).toHaveLength(1);
 expect(log).toHaveBeenCalledTimes(1);const logged=JSON.stringify(log.mock.calls);expect(logged).toContain('google_tasks_error');for(const secret of ['Private notes','Private title','private-access-token','TASKS_REFRESH_TOKEN_secret'])expect(logged).not.toContain(secret);
});

it('treats a Google 5xx after POST as unconfirmed without replaying the write',async()=>{
 failPostStatus=503;const log=vi.spyOn(console,'error').mockImplementation(()=>{});const {saveTask,GoogleTasksUnconfirmed}=await api();await expect(saveTask(draft)).rejects.toBeInstanceOf(GoogleTasksUnconfirmed);
 expect(calls.filter(c=>c.method==='POST'&&c.url.hostname!=='oauth2.googleapis.com')).toHaveLength(1);expect(log).toHaveBeenCalledTimes(1);expect(JSON.stringify(log.mock.calls)).not.toContain('Private notes');
});

const eventId='4210b937a4a96787f61699c742b87a4636d93260b1a39599452e07d2b5116bc6';
const seedTimed=(event?:string)=>seed({due:'2026-10-04T00:00:00.000Z',notes:'Private notes\n\n#hermes cat=family&'+(event?'evento='+event+'&':'')+'hora=09%3A30&key=dashboard%3Afixture',webViewLink:'https://tasks.google.com/task-1'});
const calendarCalls=()=>calls.filter(c=>c.url.pathname.includes('/calendar/v3/'));
it('creates with the exact VPS identifier and private source metadata, then updates only task metadata',async()=>{
 seedTimed();const {saveTask}=await api();const result=await saveTask(draft);
 expect(result.record.eventId).toBe(eventId);
 expect(calendarCalls().map(c=>c.method)).toEqual(['POST']);
 expect(calendarCalls()[0].body).toEqual({id:eventId,summary:'Private title',description:'Private notes\n\nTarea: https://tasks.google.com/task-1',start:{dateTime:'2026-10-04T09:30:00+02:00',timeZone:'Europe/Madrid'},end:{dateTime:'2026-10-04T10:00:00+02:00',timeZone:'Europe/Madrid'},reminders:{useDefault:false,overrides:[{method:'popup',minutes:0}]},extendedProperties:{private:{hermesProfile:'familia',sourceKey:'task:task-1',taskId:'task-1',taskListId:'familia-list'}}});
 await saveTask(draft);
 expect(calendarCalls().at(-1)?.body.extendedProperties).toEqual({private:{taskId:'task-1',taskListId:'familia-list'}});
 expect(events.get(eventId)?.extendedProperties).toEqual({private:{hermesProfile:'familia',sourceKey:'task:task-1',taskId:'task-1',taskListId:'familia-list'}});
});
it('recovers a live deterministic event after a 409 by updating and linking it',async()=>{
 seedTimed();events.set(eventId,{id:eventId,summary:'Old title'});
 const {saveTask}=await api();const result=await saveTask(draft);
 expect(result.record.eventId).toBe(eventId);expect(events.size).toBe(1);
 expect(calendarCalls().map(c=>c.method)).toEqual(['POST','GET','PATCH']);
 expect(calendarCalls()[2].body.extendedProperties).toEqual({private:{taskId:'task-1',taskListId:'familia-list'}});
 expect(events.get(eventId)?.summary).toBe('Private title');
});
it('replaces a cancelled linked event using a server ID after the deterministic ID conflicts',async()=>{
 seedTimed('old-event');events.set('old-event',{id:'old-event',status:'cancelled'});events.set(eventId,{id:eventId,status:'cancelled'});
 const {saveTask}=await api();const result=await saveTask(draft);
 expect(result).toMatchObject({duplicate:true,record:{eventId:'event-1',time:'09:30'}});
 expect(calendarCalls().map(c=>c.method)).toEqual(['GET','POST','GET','POST']);
 const posts=calendarCalls().filter(c=>c.method==='POST');expect(posts[0].body.id).toBe(eventId);expect(posts[1].body).not.toHaveProperty('id');
 expect(posts[1].body.extendedProperties).toEqual({private:{hermesProfile:'familia',sourceKey:'task:task-1',taskId:'task-1',taskListId:'familia-list'}});
 expect(Array.from(events.values()).filter(e=>e.status!=='cancelled')).toHaveLength(1);await saveTask(draft);
 expect(calendarCalls().filter(c=>c.method==='POST')).toHaveLength(2);
});
it('replaces a missing linked event with the deterministic event',async()=>{
 seedTimed('missing-event');const {saveTask}=await api();expect((await saveTask(draft)).record.eventId).toBe(eventId);
 expect(calendarCalls().map(c=>c.method)).toEqual(['GET','POST']);
});
it('reports an unconfirmed write if unlinking the event succeeds before a task patch conflicts',async()=>{
 seed({notes:'Private notes\n\n#hermes cat=family&evento=event-1&key=dashboard%3Afixture'});events.set('event-1',{id:'event-1'});failPatchAfterEventDelete=true;
 vi.spyOn(console,'error').mockImplementation(()=>{});const {saveTask,GoogleTasksUnconfirmed}=await api();await expect(saveTask(draft)).rejects.toBeInstanceOf(GoogleTasksUnconfirmed);
 expect(events.size).toBe(0);expect(calls.filter(c=>c.method==='PATCH')).toHaveLength(1);
});
it('ports source annotations and drops metadata keys the Python model does not recognize',async()=>{
 const {saveTask}=await api();const created=await saveTask({...draft,source:'Dashboard import'});expect(created.record.notes).toBe('Private notes\nOrigen: Dashboard import');
 const task=tasks.get('task-1');if(!task)throw new Error('Missing fixture task');task.notes+='&unknown=must-disappear';
 await saveTask({...draft,id:'task-1',revision:revision(updated)});
 expect(tasks.get('task-1')?.notes).not.toContain('unknown');expect(tasks.get('task-1')?.notes).toContain('key=dashboard%3Afixture');
});
it('uses the Madrid winter offset for timed Calendar events',async()=>{
 const {saveTask}=await api();const saved=await saveTask({...draft,date:'2026-12-15',time:'09:30'});expect(events.get(saved.record.eventId||'')).toMatchObject({start:{dateTime:'2026-12-15T09:30:00+01:00'},end:{dateTime:'2026-12-15T10:00:00+01:00'}});
});
