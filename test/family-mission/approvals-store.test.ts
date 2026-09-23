import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {getCloudflareContext} from '@opennextjs/cloudflare';
import {createApproval,listPendingApprovals,decideApproval,consumeApproval} from '../../lib/family-mission/approval-store';
vi.mock('@opennextjs/cloudflare',()=>({getCloudflareContext:vi.fn()}));
// Node 22's SQLite executes the actual migration and store SQL.
const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite');
let sqlite:any;
const notify=vi.fn();
const queries:string[]=[];
beforeEach(()=>{
 sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../../migrations/0001_family_mission.sql',import.meta.url),'utf8'));
 sqlite.exec(readFileSync(new URL('../../migrations/0005_pending_approvals.sql',import.meta.url),'utf8'));
 queries.length=0;
 const db={prepare(sql:string){queries.push(sql);const stmt=sqlite.prepare(sql);let args:any[]=[];const bound={
  bind(...values:any[]){args=values;return bound;},
  async all(){return {results:stmt.all(...args)};},
  async first(){return stmt.get(...args)??null;},
  async run(){const result=stmt.run(...args);return {meta:{changes:result.changes}};},
 };return bound;}};
 notify.mockResolvedValue(new Response(null,{status:204}));
 vi.mocked(getCloudflareContext).mockResolvedValue({env:{FAMILY_DB:db,CHAT_NOTIFICATIONS:{idFromName:()=> 'chat',get:()=>({fetch:notify})}}} as any);
});
afterEach(()=>sqlite.close());
const approval=(id:string,extra={})=>({id,digest:'digest',command:'command',description:'Review',allowedChoices:['once'] as ['once'],status:'pending' as const,createdAt:'2026-01-01T00:00:00Z',expiresAt:'2099-01-01T00:00:00Z',...extra});
it('selects pending unexpired approvals before LIMIT and uses the partial index',async()=>{
 await createApproval(approval('wanted'));
 for(let i=0;i<25;i++)await createApproval(approval('decided'+i,{status:'decided'} as any));
 await createApproval(approval('expired',{expiresAt:'2000-01-01T00:00:00Z'}));
 const items=await listPendingApprovals();
 expect(items.map((x:any)=>x.id)).toEqual(['wanted']);
 const sql=queries.at(-1)!;
 const plan=sqlite.prepare('EXPLAIN QUERY PLAN '+sql).all(new Date().toISOString());
 expect(plan.some((row:any)=>row.detail.includes('USING INDEX family_pending_approvals'))).toBe(true);
 expect(sqlite.prepare('SELECT COUNT(*) n FROM family_records').get().n).toBe(27);
});
it('notifies browsers after durable changes and preserves decision conflict checks',async()=>{
 await createApproval(approval('a'));
 await decideApproval('a','once','Dani');
 await consumeApproval('a');
 expect(notify).toHaveBeenCalledTimes(3);
 for(const call of notify.mock.calls)expect(JSON.parse(call[1].body)).toEqual({tag:'approvals',wake:false});
 await expect(decideApproval('a','once','Dani')).rejects.toThrow('EXPIRED');
 expect(notify).toHaveBeenCalledTimes(3);
 expect(await listPendingApprovals()).toEqual([]);
});
it('keeps durable approvals available if notification delivery fails',async()=>{
 notify.mockRejectedValue(new Error('offline'));
 await createApproval(approval('a'));
 expect((await listPendingApprovals()).map((x:any)=>x.id)).toEqual(['a']);
});
