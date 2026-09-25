import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {NextRequest} from 'next/server';
import {getCloudflareContext} from '@opennextjs/cloudflare';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
import {GET} from '@/app/api/family/records/route';
import {validateRecord,type FamilyRecord} from '@/lib/family-mission/model';
vi.mock('server-only',()=>({}));
vi.mock('@opennextjs/cloudflare',()=>({getCloudflareContext:vi.fn()}));
vi.mock('@/lib/calendar-sync-auth',()=>({requireCalendarSyncRouteAuth:vi.fn()}));
const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite');
let sqlite:any;
let batches:number;
let executedQueries:{sql:string;args:any[]}[];
let beforeBatch:(()=>void)|undefined;
beforeEach(()=>{
 batches=0;
 beforeBatch=undefined;
 executedQueries=[];
 sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../../migrations/0001_family_mission.sql',import.meta.url),'utf8'));
 sqlite.exec(readFileSync(new URL('../../migrations/0006_completion_provenance.sql',import.meta.url),'utf8'));
 const db={
  prepare(sql:string){
   if(/changes\(\)/i.test(sql))throw new Error('Do not assume cross-statement D1 connection state');
   const statement=sqlite.prepare(sql);let args:any[]=[];
   const bound={bind(...values:any[]){args=values;return bound;},
    async first(){return statement.get(...args)??null;},
    async all(){executedQueries.push({sql,args:[...args]});return {results:statement.all(...args)};},
    async run(){return {meta:{changes:statement.run(...args).changes}};}
   };return bound;
  },
  async batch(statements:any[]){
   batches++;
   beforeBatch?.();beforeBatch=undefined;
   sqlite.exec('BEGIN');
   try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}
   catch(error){sqlite.exec('ROLLBACK');throw error;}
  }
 };
 vi.mocked(getCloudflareContext).mockResolvedValue({env:{FAMILY_DB:db}} as any);
 vi.mocked(requireCalendarSyncRouteAuth).mockResolvedValue({authorized:true,kind:'email'} as any);
});
afterEach(()=>sqlite.close());
const seed=(patch:Partial<FamilyRecord>={})=>{
 const record={...validateRecord({kind:'task',title:'Cambiar el día del showroom',date:'2026-08-01',status:'done',owner:'Cris',category:'home',audience:'kids',source:'Correo',sourceKey:'mail:original',notes:'Contexto original',checklist:[{text:'Visitado',done:true},{text:'Acordar el nuevo día y hora',done:false},{text:'Dani: Actualizar el evento del calendario',done:false}]}),id:'parent',revision:3,...patch};
 sqlite.prepare('INSERT INTO family_records(id,kind,data,source_key,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(record.id,record.kind,JSON.stringify(record),record.sourceKey,record.revision,'before','before');
 return record;
};
const flatten=async(patch:unknown={},service=true)=>{
 if(service)vi.mocked(requireCalendarSyncRouteAuth).mockResolvedValue({authorized:true,kind:'service'});
 const {POST}=await import('@/app/api/family/records/flatten/route');
 return POST(new NextRequest('http://localhost/api/family/records/flatten',{method:'POST',body:JSON.stringify(patch)}));
};
const input={id:'parent',revision:3,localToday:'2026-09-25',confirm:false};
it.each(['done','open','waiting'] as const)('previews %s without writes, preserving parent meaning/history and child context',async status=>{
 const parent=seed({status});
 const before=sqlite.prepare('SELECT * FROM family_records').all();
 const response=await flatten(input);expect(response.status).toBe(200);
 const body=await response.json();
 expect(body).toMatchObject({dryRun:true,counts:{created:2,checked:1,moved:2},record:{...JSON.parse(JSON.stringify(parent)),checklist:[],notes:expect.any(String)},children:expect.any(Array)});
 expect(body.record.notes).toContain('Contexto original');expect(body.record.notes).toContain('Historial');expect(body.record.notes).toContain('Visitado');
 expect(body.record.notes).toContain('Acordar el nuevo día y hora');expect(body.record.notes).toContain('Dani: Actualizar el evento del calendario');
 expect(body.children.map((r:FamilyRecord)=>[r.title,r.owner])).toEqual([['Acordar el nuevo día y hora','Cris'],['Actualizar el evento del calendario','Dani']]);
 body.children.forEach((r:FamilyRecord)=>{expect(r).toMatchObject({date:status==='done'?input.localToday:parent.date,status:'open',checklist:[],recurrence:'none',source:'Correo',category:'home',audience:'kids'});expect(r.notes).toContain(parent.id);expect(r.notes).toContain(parent.title);});
 expect(batches).toBe(0);
 expect(sqlite.prepare('SELECT * FROM family_records').all()).toEqual(before);
 expect(sqlite.prepare('SELECT COUNT(*) n FROM family_audit').get().n).toBe(0);
 expect((await (await flatten(input)).json()).children).toEqual(body.children);
});
it.each([['Saida — Comprar','Saida','Comprar'],['Familia, preguntar','Familia','preguntar'],['Cris llamar','Cris','llamar'],['Dani. llamar','Dani','llamar'],['Daniel llamar','Cris','Daniel llamar'],['cris llamar','Cris','cris llamar'],['Consultar a Dani','Cris','Consultar a Dani']])('recognizes only exact owner prefixes: %s',async(text,owner,title)=>{
 seed({checklist:[{text,done:false}]});const body=await (await flatten(input)).json();expect(body.children[0]).toMatchObject({owner,title});
});
it('previews checked-only lists as historical notes without children',async()=>{
 seed({checklist:[{text:'Ya hecho',done:true}]});const response=await flatten(input);expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({children:[],counts:{created:0,checked:1,moved:0},record:{checklist:[],status:'done',notes:expect.stringContaining('Ya hecho')}});
});
it.each([null,{}, {...input,localToday:'2026-02-30'},{...input,localToday:'2026-9-25'},{...input,revision:'3'},{...input,confirm:'true'},{...input,id:[]},{...input,revision:0}])('rejects malformed input %j',async raw=>{
 expect((await flatten(raw)).status).toBe(400);expect(sqlite.prepare('SELECT COUNT(*) n FROM family_audit').get().n).toBe(0);
});
it.each([{readOnly:true},{kind:'event'},{sourceKey:'approval:1'},{sourceKey:'capability:1'},{sourceKey:'chat-thread:1'},{sourceKey:'chat-conversation:1'},{sourceKey:'system:1'},{sourceKey:'internal:1'},{checklist:[]},{notes:'n'.repeat(5000)}] as Partial<FamilyRecord>[])('rejects protected or unsupported targets %j',async patch=>{
 seed(patch);expect((await flatten(input)).status).toBe(400);
});
it.each([{authorized:true,kind:'email'},{authorized:false,kind:'email'}])('rejects non-service auth before storage',async auth=>{
 vi.mocked(requireCalendarSyncRouteAuth).mockResolvedValue(auth);vi.mocked(getCloudflareContext).mockClear();
 expect((await flatten(null,false)).status).toBe(auth.authorized?403:401);expect(getCloudflareContext).not.toHaveBeenCalled();
});
it.each([false,true])('confirms atomically with complete audits and rejects retry (checked-only=%s)',async checkedOnly=>{
 const parent=seed(checkedOnly?{checklist:[{text:'Histórico',done:true}]}:{});
 const preview=await (await flatten(input)).json();
 const response=await flatten({...input,confirm:true});expect(response.status).toBe(200);
 expect(batches).toBe(1);
 const result=await response.json();expect(result).toMatchObject({dryRun:false,record:{id:parent.id,revision:4,status:'done',checklist:[]},children:preview.children.map((r:FamilyRecord)=>({...r,updatedAt:expect.any(String)}))});
 const records=sqlite.prepare('SELECT * FROM family_records ORDER BY id').all();
 expect(records).toHaveLength(1+preview.children.length);
 const audits=sqlite.prepare('SELECT * FROM family_audit ORDER BY id').all();expect(audits).toHaveLength(1+preview.children.length);
 expect(audits[0]).toMatchObject({record_id:'parent',action:'flatten',completion_mode:null,completion_channel:null});
 expect(JSON.parse(audits[0].before_data).checklist).toEqual(parent.checklist);
 expect(JSON.parse(audits[0].after_data)).toMatchObject({checklist:[],status:'done',notes:result.record.notes});
 result.children.forEach((child:FamilyRecord,index:number)=>{expect(audits[index+1]).toMatchObject({record_id:child.id,action:'create',before_data:null});expect(JSON.parse(audits[index+1].after_data)).toMatchObject({title:child.title,checklist:[],status:'open',sourceKey:child.sourceKey});});
 expect((await flatten({...input,confirm:true})).status).toBe(409);
 expect(sqlite.prepare('SELECT * FROM family_records ORDER BY id').all()).toEqual(records);expect(sqlite.prepare('SELECT * FROM family_audit ORDER BY id').all()).toEqual(audits);
});
it.each(['update','delete'])('rolls back a stale in-batch parent %s without children or audit',async action=>{
 seed();beforeBatch=()=>sqlite.exec(action==='update'?"UPDATE family_records SET revision=revision+1":"DELETE FROM family_records");
 expect((await flatten({...input,confirm:true})).status).toBe(409);
 expect(sqlite.prepare("SELECT COUNT(*) n FROM family_records WHERE id<>'parent'").get().n).toBe(0);
 expect(sqlite.prepare('SELECT COUNT(*) n FROM family_audit').get().n).toBe(0);
});
it.each(['child','audit','ignored-update'])('rolls back every statement on %s failure and sanitizes errors',async failure=>{
 seed();const before=sqlite.prepare('SELECT * FROM family_records').all();
 sqlite.exec(failure==='child'?"CREATE TRIGGER fail BEFORE INSERT ON family_records WHEN NEW.source_key LIKE 'flatten:%:2' BEGIN SELECT RAISE(ABORT, 'secret database detail'); END":failure==='audit'?"CREATE TRIGGER fail BEFORE INSERT ON family_audit WHEN NEW.action='create' BEGIN SELECT RAISE(ABORT, 'secret database detail'); END":"CREATE TRIGGER fail BEFORE UPDATE ON family_records BEGIN SELECT RAISE(IGNORE); END");
 const response=await flatten({...input,confirm:true});expect(response.status).toBe(400);expect((await response.json()).error).not.toMatch(/secret|constraint|SQL|D1/);
 expect(sqlite.prepare('SELECT * FROM family_records').all()).toEqual(before);expect(sqlite.prepare('SELECT COUNT(*) n FROM family_audit').get().n).toBe(0);
});
it('preserves recurring parent metadata and bounds new titles without losing item history',async()=>{
 const text='Saida: '+ 'a'.repeat(250);
 const original=seed({recurrence:'weekly',time:'12:30',endTime:'13:00',reminderDays:7,completionDecision:'partial',checklist:[{text,done:false}]});
 const body=await (await flatten({...input,confirm:true})).json();
 expect(body.record).toMatchObject({status:'done',recurrence:'weekly',time:'12:30',endTime:'13:00',reminderDays:7,completionDecision:'partial'});
 expect(body.record.notes).toContain(text);
 expect(body.children[0]).toMatchObject({title:'a'.repeat(200),owner:'Saida',recurrence:'none',time:'',endTime:'',sourceKey:`flatten:${original.id}:3:0`});
 expect(body.children[0].completionParent).toBeUndefined();expect(body.children[0].completionDecision).toBeUndefined();
});
it('retains legacy checklists in generic reads and keeps internal records filtered',async()=>{
 const original=seed();
 seed({id:'hidden',sourceKey:'approval:hidden'});
 const response=await GET(new NextRequest('http://localhost/api/family/records'));
 const body=await response.json();expect(body.records).toHaveLength(1);expect(body.records[0]).toMatchObject({id:original.id,checklist:original.checklist});
});
it('does not overwrite an existing deterministic child or partially migrate its parent',async()=>{
 seed();const preview=await (await flatten(input)).json();
 const child=preview.children[1];
 sqlite.prepare('INSERT INTO family_records(id,kind,data,source_key,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(child.id,'task',JSON.stringify(child),child.sourceKey,'before','before');
 const before=sqlite.prepare('SELECT * FROM family_records ORDER BY id').all();
 expect((await flatten({...input,confirm:true})).status).toBe(400);
 expect(sqlite.prepare('SELECT * FROM family_records ORDER BY id').all()).toEqual(before);expect(sqlite.prepare('SELECT COUNT(*) n FROM family_audit').get().n).toBe(0);
});
