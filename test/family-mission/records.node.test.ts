import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {NextRequest} from 'next/server';
import {getCloudflareContext} from '@opennextjs/cloudflare';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
import {GET,POST} from '@/app/api/family/records/route';
import {attentionReport,completionAction,triageTask,normalTasks} from '@/lib/family-mission/attention';
import {dateKey,addDays,validateRecord,reminderCandidates,type FamilyRecord} from '@/lib/family-mission/model';
vi.mock('server-only',()=>({}));
vi.mock('@opennextjs/cloudflare',()=>({getCloudflareContext:vi.fn()}));
vi.mock('@/lib/calendar-sync-auth',()=>({requireCalendarSyncRouteAuth:vi.fn()}));
const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite');
let sqlite:any;
let beforeBatch:(()=>void)|undefined;
beforeEach(()=>{
 beforeBatch=undefined;
 sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../../migrations/0001_family_mission.sql',import.meta.url),'utf8'));
 const db={
  prepare(sql:string){
   const statement=sqlite.prepare(sql);let args:any[]=[];
   const bound={bind(...values:any[]){args=values;return bound;},
    async first(){return statement.get(...args)??null;},
    async all(){return {results:statement.all(...args)};},
    async run(){return {meta:{changes:statement.run(...args).changes}};}
   };return bound;
  },
  async batch(statements:any[]){
   beforeBatch?.();beforeBatch=undefined;
   sqlite.exec('BEGIN');
   try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}
   catch(error){sqlite.exec('ROLLBACK');throw error;}
  }
 };
 vi.mocked(getCloudflareContext).mockResolvedValue({env:{FAMILY_DB:db}} as any);
 vi.mocked(requireCalendarSyncRouteAuth).mockResolvedValue({authorized:true} as any);
});
afterEach(()=>sqlite.close());
const post=(value:unknown)=>POST(new NextRequest('http://localhost/api/family/records',{method:'POST',body:JSON.stringify(value)}));
const create=async(patch={})=>(await (await post({kind:'task',title:'Mochila',date:'2026-09-01',owner:'Dani',source:'Correo del colegio',sourceKey:'mail:1',...patch})).json()).record as FamilyRecord;
it('updates the same record for each triage action, retains cancelled data and audits, and rejects stale revisions',async()=>{
 let record=await create();
 const id=record.id;
 for(const action of [{type:'reschedule',date:'2026-09-02'},{type:'wait'},{type:'cancel'}] as const){
  const old=record;
  const response=await post(triageTask(record,action));
  expect(response.status).toBe(200);
  record=(await response.json()).record;
  expect(record).toMatchObject({id,revision:old.revision+1,sourceKey:'mail:1',source:'Correo del colegio'});
 }
 const loaded=await (await GET(new NextRequest('http://localhost/api/family/records'))).json();
 expect(loaded.records).toHaveLength(1);
 expect(loaded.records[0]).toMatchObject({id,status:'cancelled',revision:4});
 const reminders=await (await GET(new NextRequest('http://localhost/api/family/records?reminders=1'))).json();
 expect(reminders.records).toEqual([]);
 const audits=sqlite.prepare('SELECT action,before_data,after_data FROM family_audit ORDER BY rowid').all();
 expect(audits.map((a:any)=>a.action)).toEqual(['create','update','update','update']);
 expect(JSON.parse(audits[3].before_data).status).toBe('waiting');
 expect(JSON.parse(audits[3].after_data).status).toBe('cancelled');
 expect((await post({...record,revision:3,status:'open'})).status).toBe(400);
 expect(sqlite.prepare('SELECT COUNT(*) n FROM family_audit').get().n).toBe(4);
});
it('persists partial and full occurrence decisions without modifying the recurring template',async()=>{
 const template=await create({recurrence:'daily',checklist:[{text:'Libro',done:false}]});
 async function complete(records:FamilyRecord[],choice:'all'|'partial'){
  const action=completionAction(template,dateKey(),records,choice);
  expect(action.type).toBe('save');
  if(action.type!=='save')throw new Error('Expected save');
  const response=await post(action.record);expect(response.status).toBe(200);
  return (await response.json()).record as FamilyRecord;
 }
 const partial=await complete([],'partial');
 expect(partial).toMatchObject({revision:1,completionDecision:'partial',status:'done',checklist:[{text:'Libro',done:false}]});
 const full=await complete([partial],'all');
 expect(full).toMatchObject({id:partial.id,revision:2,completionDecision:'all',checklist:[{text:'Libro',done:true}]});
 const {records}=await (await GET(new NextRequest('http://localhost/api/family/records'))).json();
 expect(records).toHaveLength(2);
 expect(records.find((r:FamilyRecord)=>r.id===template.id)).toMatchObject({revision:1,status:'open',checklist:[{text:'Libro',done:false}]});
});
it('rejects contradictory full completion before storage',async()=>{
 const record=await create({checklist:[{text:'Libro',done:false}]});
 expect((await post({...record,status:'done',completionDecision:'all'})).status).toBe(400);
 expect(sqlite.prepare('SELECT COUNT(*) n FROM family_audit').get().n).toBe(1);
});
it('preserves authentication for reads and updates',async()=>{
 vi.mocked(requireCalendarSyncRouteAuth).mockResolvedValue({authorized:false} as any);
 expect((await GET(new NextRequest('http://localhost/api/family/records'))).status).toBe(401);
 expect((await post({kind:'task'})).status).toBe(401);
 expect(sqlite.prepare('SELECT COUNT(*) n FROM family_records').get().n).toBe(0);
});

it('persists two new completed daily tasks as distinct templates before completing their occurrences',async()=>{
 const today=dateKey();
 const saved:FamilyRecord[]=[];
 for(const title of ['Mochila','Agua']){
  const draft:FamilyRecord={...validateRecord({kind:'task',title,date:today,recurrence:'daily',status:'done'}),id:'',revision:0};
  const first=completionAction(draft,today,saved);
  expect(first.type).toBe('create-template');
  if(first.type!=='create-template')throw new Error('Expected template first');
  const template=(await (await post(first.record)).json()).record as FamilyRecord;
  expect(template).toMatchObject({recurrence:'daily',status:'open',revision:1});
  expect(template.id).not.toBe('');
  saved.push(template);
  const action=completionAction(template,today,saved);
  if(action.type!=='save')throw new Error('Expected occurrence');
  const occurrence=(await (await post(action.record)).json()).record as FamilyRecord;
  expect(occurrence.sourceKey).toBe(`completion:${template.id}:${today}`);
  saved.push(occurrence);
 }
 const {records}=await (await GET(new NextRequest('http://localhost/api/family/records'))).json();
 expect(records).toHaveLength(4);
 expect(new Set(records.filter((r:FamilyRecord)=>r.recurrence==='daily').map((r:FamilyRecord)=>r.id)).size).toBe(2);
 expect(new Set(records.filter((r:FamilyRecord)=>r.sourceKey).map((r:FamilyRecord)=>r.sourceKey)).size).toBe(2);
 expect(normalTasks(records,addDays(today,1),addDays(today,1)).map(r=>r.title).sort()).toEqual(['Agua','Mochila']);
});
it('rejects a refreshed completion decision after cancellation without overwriting its audit',async()=>{
 const template=await create({recurrence:'daily',checklist:[{text:'Libro',done:false}]});
 const action=completionAction(template,dateKey(),[],'partial');
 if(action.type!=='save')throw new Error('Expected occurrence');
 const occurrence=(await (await post(action.record)).json()).record as FamilyRecord;
 const snapshot=[template,occurrence];
 expect(completionAction(template,dateKey(),snapshot,'all').type).toBe('save');
 const cancelled=(await (await post(triageTask(occurrence,{type:'cancel'}))).json()).record as FamilyRecord;
 const auditsBefore=sqlite.prepare('SELECT * FROM family_audit ORDER BY rowid').all();
 expect(()=>completionAction(template,dateKey(),[template,cancelled],'all',snapshot)).toThrow('ha cambiado');
 expect(()=>completionAction(template,dateKey(),[template,{...occurrence,revision:occurrence.revision+1}],'all',snapshot)).toThrow('ha cambiado');
 const stale=await post({...occurrence,status:'done',completionDecision:'all',checklist:[{text:'Libro',done:true}]});
 expect(stale.status).toBe(400);
 const {records}=await (await GET(new NextRequest('http://localhost/api/family/records'))).json();
 expect(records.find((r:FamilyRecord)=>r.id===occurrence.id)).toMatchObject({status:'cancelled',revision:cancelled.revision});
 expect(sqlite.prepare('SELECT * FROM family_audit ORDER BY rowid').all()).toEqual(auditsBefore);
});
it('conflicts when an absent occurrence is cancelled while its completion dialog is open',async()=>{
 const template=await create({recurrence:'daily',checklist:[{text:'Libro',done:false}]});
 const snapshot=[template];
 expect(completionAction(template,dateKey(),snapshot)).toEqual({type:'choose'});
 const pending=completionAction(template,dateKey(),snapshot,'all',snapshot);
 if(pending.type!=='save')throw new Error('Expected occurrence');
 const cancelled=(await (await post({...pending.record,status:'cancelled'})).json()).record as FamilyRecord;
 expect(()=>completionAction(template,dateKey(),[template,cancelled],'all',snapshot)).toThrow('ha cambiado');
 const auditsBefore=sqlite.prepare('SELECT * FROM family_audit ORDER BY rowid').all();
 const response=await post(pending.record);
 expect(response.status).toBe(400);
 expect((await response.json()).error).toContain('ha cambiado');
 expect(sqlite.prepare('SELECT * FROM family_audit ORDER BY rowid').all()).toEqual(auditsBefore);
 const {records}=await (await GET(new NextRequest('http://localhost/api/family/records'))).json();
 expect(records.find((r:FamilyRecord)=>r.id===cancelled.id).status).toBe('cancelled');
});
it('shows a reopened occurrence rescheduled to a future date independently and preserves its audit',async()=>{
 const past='2026-09-23',future='2026-09-28';
 const template=await create({recurrence:'daily'});
 const action=completionAction(template,past,[template],'all');
 if(action.type!=='save')throw new Error('Expected occurrence');
 const completed=(await (await post(action.record)).json()).record as FamilyRecord;
 const reopen=completionAction(completed,past,[template,completed],'keep');
 if(reopen.type!=='save')throw new Error('Expected reopen');
 const reopened=(await (await post(reopen.record)).json()).record as FamilyRecord;
 const moved=(await (await post(triageTask(reopened,{type:'reschedule',date:future}))).json()).record as FamilyRecord;
 const {records}=await (await GET(new NextRequest('http://localhost/api/family/records'))).json();
 for(const today of ['2026-09-24',future])expect(normalTasks(records,future,today).map(r=>r.id).sort()).toEqual([template.id,moved.id].sort());
 expect(normalTasks(records,'2026-09-24','2026-09-24').map(r=>r.id)).toEqual([template.id]);
 const beforeStale=sqlite.prepare('SELECT * FROM family_audit ORDER BY rowid').all();
 expect(normalTasks(records,past,past).map(r=>r.id)).toContain(template.id);
 expect(()=>completionAction(template,past,records,'all')).toThrow('ha cambiado');
 expect(records.find((r:FamilyRecord)=>r.id===moved.id)).toMatchObject({status:'open',date:future});
 expect(reminderCandidates(records,future).map(r=>r.id)).toContain(moved.id);
 expect(sqlite.prepare('SELECT * FROM family_audit ORDER BY rowid').all()).toEqual(beforeStale);
 expect(moved).toMatchObject({id:completed.id,revision:3,sourceKey:`completion:${template.id}:${past}`,source:completed.source,date:future});
 const audits=sqlite.prepare('SELECT before_data,after_data FROM family_audit WHERE record_id=? ORDER BY rowid').all(moved.id);
 expect(audits).toHaveLength(3);
 expect(JSON.parse(audits[2].before_data).date).toBe(past);
 expect(JSON.parse(audits[2].after_data).date).toBe(future);
});
it.each(['all','partial'] as const)('conflicts on %s when the recurring template changes while the dialog is open',async(choice)=>{
 const template=await create({recurrence:'daily',checklist:[{text:'Libro',done:false}]});
 const snapshot=[template];
 expect(completionAction(template,dateKey(),snapshot)).toEqual({type:'choose'});
 for(const status of ['open','cancelled'] as const){
  const current={...template,revision:2,status};
  expect(()=>completionAction(template,dateKey(),[current],choice,snapshot)).toThrow('Esta tarea ha cambiado. Actualiza la página y vuelve a abrir la decisión.');
 }
 const {records}=await (await GET(new NextRequest('http://localhost/api/family/records'))).json();
 expect(records).toHaveLength(1);
 expect(records[0]).toMatchObject(template);
 expect(sqlite.prepare('SELECT COUNT(*) n FROM family_audit').get().n).toBe(1);
});

it.each(['update','cancel','delete'] as const)('rejects a stale occurrence insert after another client performs parent %s',async change=>{
 const template=await create({recurrence:'daily',checklist:[{text:'Libro',done:false}]});
 const pending=completionAction(template,dateKey(),[template],'partial');
 if(pending.type!=='save')throw new Error('Expected occurrence');
 if(change==='delete')sqlite.prepare('DELETE FROM family_records WHERE id=?').run(template.id);
 else expect((await post({...template,title:'Updated by B',status:change==='cancel'?'cancelled':'open'})).status).toBe(200);
 const rowsBefore=sqlite.prepare('SELECT * FROM family_records').all();
 const auditsBefore=sqlite.prepare('SELECT * FROM family_audit').all();
 const response=await post(pending.record);
 expect(response.status).toBe(400);
 expect((await response.json()).error).toBe('Esta tarea ha cambiado. Actualiza la página y vuelve a abrir la decisión.');
 expect(sqlite.prepare('SELECT * FROM family_records').all()).toEqual(rowsBefore);
 expect(sqlite.prepare('SELECT * FROM family_audit').all()).toEqual(auditsBefore);
});
it('carries validated parent identity/revision and inserts one audited occurrence for an unchanged parent',async()=>{
 const template=await create({recurrence:'daily'});
 const pending=completionAction(template,dateKey(),[template],'all');
 if(pending.type!=='save')throw new Error('Expected occurrence');
 expect(pending.record).toMatchObject({completionParent:{id:template.id,revision:1}});
 const response=await post(pending.record);
 expect(response.status).toBe(200);
 expect((await response.json()).record).toMatchObject({completionParent:{id:template.id,revision:1}});
 expect((await post(pending.record)).status).toBe(400);
 expect(sqlite.prepare('SELECT COUNT(*) n FROM family_records').get().n).toBe(2);
 expect(sqlite.prepare('SELECT COUNT(*) n FROM family_audit').get().n).toBe(2);
});
it.each([undefined,{id:'other',revision:1},{id:'PARENT',revision:0},{id:'PARENT',revision:'1'},{id:'PARENT',revision:1.5}])('rejects missing or malformed completion parent metadata %j',async metadata=>{
 const template=await create({recurrence:'daily'});
 const pending=completionAction(template,dateKey(),[template],'all');
 if(pending.type!=='save')throw new Error('Expected occurrence');
 const completionParent=metadata&&{...metadata,id:metadata.id==='PARENT'?template.id:metadata.id};
 expect((await post({...pending.record,completionParent})).status).toBe(400);
 expect(sqlite.prepare('SELECT COUNT(*) n FROM family_records').get().n).toBe(1);
 expect(sqlite.prepare('SELECT COUNT(*) n FROM family_audit').get().n).toBe(1);
});
it('reads and updates historical completion records without parent metadata',async()=>{
 const historical={...validateRecord({kind:'task',title:'Histórica',date:dateKey(),status:'done',sourceKey:`completion:old-parent:${dateKey()}`})};
 sqlite.prepare('INSERT INTO family_records(id,kind,data,source_key,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('historical','task',JSON.stringify(historical),historical.sourceKey,'then','then');
 const {records}=await (await GET(new NextRequest('http://localhost/api/family/records'))).json();
 expect(records[0]).toMatchObject({id:'historical',status:'done'});
 expect((await post({...records[0],status:'open'})).status).toBe(200);
});

it('checks D1 parent state at insertion even if cancellation happens immediately before the batch',async()=>{
 const template=await create({recurrence:'daily'});
 const pending=completionAction(template,dateKey(),[template],'all');
 if(pending.type!=='save')throw new Error('Expected occurrence');
 beforeBatch=()=>sqlite.prepare("UPDATE family_records SET revision=2,data=json_set(data,'$.status','cancelled') WHERE id=?").run(template.id);
 const response=await post(pending.record);
 expect(response.status).toBe(400);
 expect((await response.json()).error).toContain('Esta tarea ha cambiado');
 expect(sqlite.prepare('SELECT COUNT(*) n FROM family_records').get().n).toBe(1);
 expect(sqlite.prepare('SELECT COUNT(*) n FROM family_audit').get().n).toBe(1);
});
it.each([{status:'cancelled',recurrence:'daily'},{status:'open',recurrence:'none'}])('queries stored parent status and recurrence despite a forged parent payload %j',async patch=>{
 const template=await create(patch);
 const occurrence={...template,id:'',revision:0,recurrence:'none',status:'done',sourceKey:`completion:${template.id}:${dateKey()}`,completionParent:{id:template.id,revision:1,status:'open',recurrence:'daily'}};
 const response=await post(occurrence);
 expect(response.status).toBe(400);
 expect((await response.json()).error).toContain('Esta tarea ha cambiado');
 expect(sqlite.prepare('SELECT COUNT(*) n FROM family_records').get().n).toBe(1);
 expect(sqlite.prepare('SELECT COUNT(*) n FROM family_audit').get().n).toBe(1);
});

it('atomically saves a new recurring task and its completed occurrence on the submitted date',async()=>{
 const date=addDays(dateKey(),1);
 const response=await post({kind:'task',title:'Tomorrow',date,recurrence:'daily',status:'done',completeOn:date});
 expect(response.status).toBe(200);
 const {records}=await (await GET(new NextRequest('http://localhost/api/family/records'))).json();
 expect(records).toHaveLength(2);
 const template=records.find((r:FamilyRecord)=>r.recurrence==='daily');
 expect(template).toMatchObject({status:'open',date});
 expect(records.find((r:FamilyRecord)=>r.recurrence==='none')).toMatchObject({status:'done',date,sourceKey:`completion:${template.id}:${date}`});
 expect(sqlite.prepare('SELECT COUNT(*) n FROM family_audit').get().n).toBe(2);
});
it('leaves no new template or audit when the completed occurrence insert fails',async()=>{
 sqlite.exec("CREATE TRIGGER fail_completion BEFORE INSERT ON family_records WHEN NEW.source_key LIKE 'completion:%' BEGIN SELECT RAISE(ABORT, 'completion failed'); END");
 const response=await post({kind:'task',title:'Tomorrow',date:'2026-09-25',recurrence:'daily',status:'done',completeOn:'2026-09-25'});
 expect(response.status).toBe(400);
 expect(sqlite.prepare('SELECT COUNT(*) n FROM family_records').get().n).toBe(0);
 expect(sqlite.prepare('SELECT COUNT(*) n FROM family_audit').get().n).toBe(0);
});

it('atomically converts an existing one-off task to daily and completes the submitted date',async()=>{
 const original=await create();
 const response=await post({...original,date:'2026-09-25',recurrence:'daily',status:'done',completeOn:'2026-09-25'});
 expect(response.status).toBe(200);
 const {records}=await response.json();
 expect(records).toHaveLength(2);
 expect(records[0]).toMatchObject({id:original.id,revision:2,date:'2026-09-25',recurrence:'daily',status:'open'});
 expect(records[1]).toMatchObject({date:'2026-09-25',status:'done',completionParent:{id:original.id,revision:2}});
 expect(sqlite.prepare('SELECT COUNT(*) n FROM family_audit').get().n).toBe(3);
});
it('rolls back conversion and audits if the occurrence insert fails',async()=>{
 const original=await create();
 const before=sqlite.prepare('SELECT * FROM family_records').all();
 const audits=sqlite.prepare('SELECT * FROM family_audit').all();
 sqlite.exec("CREATE TRIGGER fail_completion BEFORE INSERT ON family_records WHEN NEW.source_key LIKE 'completion:%' BEGIN SELECT RAISE(ABORT, 'completion failed'); END");
 expect((await post({...original,recurrence:'daily',status:'done',completeOn:original.date})).status).toBe(400);
 expect(sqlite.prepare('SELECT * FROM family_records').all()).toEqual(before);
 expect(sqlite.prepare('SELECT * FROM family_audit').all()).toEqual(audits);
});
it.each(['update','cancel','delete'] as const)('rejects conversion with no partial state when a concurrent %s wins before the batch',async change=>{
 const original=await create();
 let before:any;
 beforeBatch=()=>{
  if(change==='delete')sqlite.prepare('DELETE FROM family_records WHERE id=?').run(original.id);
  else sqlite.prepare("UPDATE family_records SET revision=revision+1,data=json_set(data,'$.status',?) WHERE id=?").run(change==='cancel'?'cancelled':'open',original.id);
  before=sqlite.prepare('SELECT * FROM family_records').all();
 };
 const response=await post({...original,recurrence:'daily',status:'done',completeOn:original.date});
 expect(response.status).toBe(400);
 expect((await response.json()).error).toContain('ha cambiado');
 expect(sqlite.prepare('SELECT * FROM family_records').all()).toEqual(before);
 expect(sqlite.prepare('SELECT COUNT(*) n FROM family_audit').get().n).toBe(1);
});

it.each([false,true])('completes the checklist only on the occurrence (conversion: %s)',async existing=>{
 const draft={kind:'task',title:'Mochila',date:'2026-09-25',checklist:[{text:'Libro',done:false}]};
 const original=existing?await create(draft):draft;
 const response=await post({...original,recurrence:'daily',status:'done',completeOn:draft.date,completeChoice:'all'});
 expect(response.status).toBe(200);
 const {records}=await response.json();
 expect(records[0]).toMatchObject({status:'open',checklist:[{done:false}]});
 expect(records[1]).toMatchObject({status:'done',completionDecision:'all',checklist:[{done:true}]});
});

it.each(['all','partial','keep'] as const)('resolves the actual legacy completed recurring template with %s',async choice=>{
 const legacy=await create({recurrence:'weekly',status:'done',checklist:[{text:'Libro',done:false}]});
 // Today is not this template's occurrence date; the health alert concerns the template itself.
 const other=await create({sourceKey:`completion:${legacy.id}:2026-09-01`,recurrence:'none',status:'open',completionParent:{id:legacy.id,revision:legacy.revision}});
 const records=[legacy,other];
 expect(attentionReport(records,[],'2026-09-24').health.incomplete).toBe(1);
 expect(completionAction(legacy,'2026-09-24',records)).toEqual({type:'choose'});
 const action=completionAction(legacy,'2026-09-24',records,choice,structuredClone(records));
 expect(action.type).toBe('save');
 if(action.type!=='save')throw new Error('Expected legacy update');
 expect(action.record).toMatchObject({id:legacy.id,revision:legacy.revision,recurrence:'weekly',sourceKey:legacy.sourceKey});
 const response=await post(action.record);
 expect(response.status).toBe(200);
 const loaded=await (await GET(new NextRequest('http://localhost/api/family/records'))).json();
 expect(loaded.records).toHaveLength(2);
 const resolved=loaded.records.find((r:FamilyRecord)=>r.id===legacy.id);
 expect(resolved).toMatchObject({status:choice==='keep'?'open':'done',checklist:[{done:choice==='all'}],revision:2});
 expect(resolved.completionDecision).toBe(choice==='keep'?undefined:choice);
 expect(loaded.records.find((r:FamilyRecord)=>r.id===other.id)).toMatchObject(other);
 expect(attentionReport(loaded.records,[],'2026-09-24').health.incomplete).toBe(0);
 expect(sqlite.prepare('SELECT record_id FROM family_audit ORDER BY rowid').all().map((r:any)=>r.record_id)).toEqual([legacy.id,other.id,legacy.id]);
});
