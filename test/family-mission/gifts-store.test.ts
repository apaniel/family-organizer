import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {getCloudflareContext} from '@opennextjs/cloudflare';
import {listGifts,createGift,updateGift,deleteGift} from '@/lib/family-mission/gift-store';
import {readRecords} from '@/lib/family-mission/store';
vi.mock('@opennextjs/cloudflare',()=>({getCloudflareContext:vi.fn()}));
const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite');
let sqlite:any;
beforeEach(()=>{
 sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync('migrations/0001_family_mission.sql','utf8'));
 const db={prepare(sql:string){const stmt=sqlite.prepare(sql);let args:any[]=[];const bound={bind(...values:any[]){args=values;return bound;},async all(){return {results:stmt.all(...args)};},async first(){return stmt.get(...args)??null;},run(){return {meta:{changes:stmt.run(...args).changes}};}};return bound;},async batch(statements:any[]){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 vi.mocked(getCloudflareContext).mockResolvedValue({env:{FAMILY_DB:db}} as any);
});
afterEach(()=>sqlite.close());
it('seeds exactly five Paula ideas once, including concurrent reads, and hides internal gifts from the planner',async()=>{
 const [items]=await Promise.all([listGifts(),listGifts()]);
 expect(items.map(x=>x.title).sort()).toEqual(['Capibara','Zapatos tacones','Lupa','Plancha','Coche teledirigido'].sort());
 for(const item of items)expect(item).toMatchObject({child:'Paula',occasion:'unassigned',status:'idea',revision:1});
 expect(await listGifts()).toEqual(items);
 expect(sqlite.prepare('SELECT COUNT(*) n FROM family_records').get().n).toBe(5);
 sqlite.prepare('INSERT INTO family_records VALUES(?,?,?,?,?,?,?)').run('ordinary','task','{"title":"Visible"}',null,1,'now','now');
 expect((await readRecords()).map(x=>x.title)).toEqual(['Visible']);
});
it('persists CRUD and rejects stale updates and deletes without overwriting changes',async()=>{
 const item=await createGift({title:'Libro',child:'Alejandra',occasion:'unassigned',status:'idea',createdBy:'Cris'});
 expect(item).toMatchObject({revision:1,createdBy:'Cris'});
 const updated=await updateGift(item.id,1,{title:'Cuentos',child:'Paula',notes:'Ilustrados',occasion:'christmas',status:'bought'});
 expect(updated).toMatchObject({id:item.id,revision:2,createdAt:item.createdAt,createdBy:'Cris',title:'Cuentos',child:'Paula',notes:'Ilustrados',occasion:'christmas',status:'bought'});
 await expect(updateGift(item.id,1,{title:'Stale'})).rejects.toThrow('CONFLICT');
 await expect(deleteGift(item.id,1)).rejects.toThrow('CONFLICT');
 expect((await listGifts()).find(x=>x.id===item.id)).toEqual(updated);
 await deleteGift(item.id,2);
 expect((await listGifts()).find(x=>x.id===item.id)).toBeUndefined();
 await expect(updateGift(item.id,2,{status:'idea'})).rejects.toThrow('NOT_FOUND');
 await expect(deleteGift('missing',1)).rejects.toThrow('NOT_FOUND');
});
it('does not recreate or reset seeded ideas after editing or deleting them',async()=>{
 const items=await listGifts();
 await updateGift(items[0].id,1,{occasion:'birthday',status:'bought'});
 await deleteGift(items[1].id,1);
 const again=await listGifts();
 expect(again).toHaveLength(4);
 expect(again.find(x=>x.id===items[0].id)).toMatchObject({occasion:'birthday',status:'bought',revision:2});
 expect(again.some(x=>x.id===items[1].id)).toBe(false);
 expect(await readRecords()).toEqual([]);
});
