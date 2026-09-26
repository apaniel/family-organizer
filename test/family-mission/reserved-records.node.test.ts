import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {NextRequest} from 'next/server';
import {getCloudflareContext} from '@opennextjs/cloudflare';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
import {GET,POST,DELETE} from '@/app/api/family/records/route';
import {validateRecord} from '@/lib/family-mission/model';
import {saveRecord,saveCompletedTask,removeRecord,readRecords} from '@/lib/family-mission/store';
import {flattenRecord} from '@/lib/family-mission/flatten';
import {POST as flattenPOST} from '@/app/api/family/records/flatten/route';
import {listGifts} from '@/lib/family-mission/gift-store';
vi.mock('server-only',()=>({}));
vi.mock('@opennextjs/cloudflare',()=>({getCloudflareContext:vi.fn()}));
vi.mock('@/lib/calendar-sync-auth',()=>({requireCalendarSyncRouteAuth:vi.fn()}));
const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite');
let sqlite:any;
beforeEach(()=>{
 sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../../migrations/0001_family_mission.sql',import.meta.url),'utf8'));
 sqlite.exec(readFileSync(new URL('../../migrations/0006_completion_provenance.sql',import.meta.url),'utf8'));
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
   sqlite.exec('BEGIN');
   try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}
   catch(error){sqlite.exec('ROLLBACK');throw error;}
  }
 };
 vi.mocked(getCloudflareContext).mockResolvedValue({env:{FAMILY_DB:db}} as any);
 vi.mocked(requireCalendarSyncRouteAuth).mockResolvedValue({authorized:true,kind:'email'} as any);
});
afterEach(()=>sqlite.close());
const draft={kind:'task',title:'Planner task',date:'2026-09-26',status:'open',recurrence:'none'};
const prefixes=['gift-idea:','approval:','capability:','chat-conversation:','chat-thread:','system:','internal:'];
const snapshot=()=>({records:sqlite.prepare('SELECT * FROM family_records ORDER BY id').all(),audits:sqlite.prepare('SELECT * FROM family_audit ORDER BY id').all()});
const seed=(marker:string,key='gift-idea:private')=>{
 const id=marker==='id'?key:'opaque-id';
 const data={...validateRecord(draft),sourceKey:marker==='json'?key:'mail:ordinary',checklist:[{text:'Private item',done:false}]};
 sqlite.prepare('INSERT INTO family_records(id,kind,data,source_key,revision,created_at,updated_at) VALUES(?,?,?,?,1,?,?)').run(id,'task',JSON.stringify(data),marker==='column'?key:'mail:ordinary','before','before');
 return id;
};
const request=(path:string,method:string,body:unknown)=>new NextRequest(`http://localhost/api/family/records${path}`,{method,body:JSON.stringify(body)});
async function invoke(via:string,operation:string,raw:any){
 if(via==='store'){
  const action=operation==='delete'?()=>removeRecord(raw.id,raw.revision):operation==='flatten'?()=>flattenRecord(raw):operation==='complete'?()=>saveCompletedTask(raw):()=>saveRecord(raw);
  await expect(action()).rejects.toThrow(/reservad|migración/);
 }else{
  vi.mocked(requireCalendarSyncRouteAuth).mockResolvedValue({authorized:true,kind:'service'} as any);
  const response=operation==='delete'?await DELETE(request('','DELETE',raw)):operation==='flatten'?await flattenPOST(request('/flatten','POST',raw)):await POST(request('','POST',raw));
  expect(response.status).toBe(operation==='delete'?409:400);
 }
}
for(const via of ['store','route']){
 it.each(prefixes)(`${via} rejects creation and reservation of %s source keys`,async prefix=>{
  const before=snapshot();
  await invoke(via,'save',{...draft,sourceKey:prefix+'seed-paula-capibara'});
  expect(snapshot()).toEqual(before);
 });
 it.each(['id','column','json'].flatMap(marker=>['save','complete','delete','flatten'].map(operation=>[marker,operation])))(`${via} protects persisted %s namespace from %s`,async(marker,operation)=>{
  const id=seed(marker),before=snapshot();
   for(const confirm of operation==='flatten'?[false,true]:[false]){
    await invoke(via,operation,{...draft,id,revision:1,sourceKey:'mail:moved',...(operation==='complete'?{status:'done',recurrence:'daily',completeOn:draft.date}:{}),localToday:draft.date,confirm});
    expect(snapshot()).toEqual(before);
   }
 });
 it(''+via+' rejects moving ordinary records or completed templates into gifts',async()=>{
  const record=await saveRecord(draft),before=snapshot();
  for(const operation of ['save','complete'])for(const existing of [false,true]){
   await invoke(via,operation,{...draft,...(existing?{id:record.id,revision:1}:{}),sourceKey:'gift-idea:seed-paula-capibara',...(operation==='complete'?{status:'done',recurrence:'daily',completeOn:draft.date}:{})});
   expect(snapshot()).toEqual(before);
  }
 });
 it(''+via+' rejects requested reserved metadata even on an ordinary flatten target',async()=>{
  const id=seed('ordinary'),before=snapshot();
  await invoke(via,'flatten',{id,revision:1,sourceKey:'gift-idea:private',localToday:draft.date,confirm:true});
  expect(snapshot()).toEqual(before);
 });
 it(''+via+' cannot suppress a gift seed or return an existing gift through create',async()=>{
  await invoke(via,'save',{...draft,sourceKey:'gift-idea:seed-paula-capibara'});
  const gifts=await listGifts();
  expect(gifts).toHaveLength(5);
  expect(gifts.find(g=>g.id==='seed-paula-capibara')?.title).toBe('Capibara');
  const before=snapshot();
  await invoke(via,'save',{...draft,sourceKey:'gift-idea:seed-paula-capibara'});
  await invoke(via,'save',{...draft,id:'gift-idea:seed-paula-capibara',revision:1});
  await invoke(via,'delete',{id:'gift-idea:seed-paula-capibara',revision:1});
  expect(snapshot()).toEqual(before);
 });
}
it.each(['id','column','json'])('does not expose internal %s records through reads or source-key collisions',async marker=>{
 seed(marker);
 expect(await readRecords()).toEqual([]);
 expect(await (await GET(new NextRequest('http://localhost/api/family/records'))).json()).toEqual({records:[]});
 const before=snapshot();
 await expect(saveRecord({...draft,sourceKey:marker==='column'?'gift-idea:private':'mail:ordinary'})).rejects.toThrow(/reservad/);
 expect(snapshot()).toEqual(before);
});
it.each(['id','column','json'])('rejects occurrence creation referencing an internal %s parent',async marker=>{
 const id=seed(marker);
 const row=sqlite.prepare('SELECT data FROM family_records WHERE id=?').get(id);
 sqlite.prepare('UPDATE family_records SET data=? WHERE id=?').run(JSON.stringify({...JSON.parse(row.data),recurrence:'daily'}),id);
 const before=snapshot();
 await expect(saveRecord({...draft,status:'done',sourceKey:`completion:${id}:${draft.date}`,completionParent:{id,revision:1}})).rejects.toThrow(/reservad/);
 expect(snapshot()).toEqual(before);
});

it('rejects a DELETE request carrying a reserved source key without deleting an ordinary row',async()=>{
 const record=await saveRecord(draft),before=snapshot();
 await invoke('route','delete',{id:record.id,revision:record.revision,sourceKey:'gift-idea:private'});
 expect(snapshot()).toEqual(before);
});
