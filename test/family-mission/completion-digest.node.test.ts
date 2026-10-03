import {it,expect,vi,beforeEach} from 'vitest';
import {NextRequest} from 'next/server';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {GET} from '@/app/api/family/completion-digest/route';
import {readCompletionDigest} from '@/lib/family-mission/completion-digest-store';
import {requireCalendarSyncRouteAuth} from '@/lib/calendar-sync-auth';
import {taskSnapshot} from '@/lib/family-mission/google-tasks';
vi.mock('server-only',()=>({}));
vi.mock('@/lib/calendar-sync-auth',()=>({requireCalendarSyncRouteAuth:vi.fn()}));
vi.mock('@/lib/family-mission/google-tasks',()=>({taskSnapshot:vi.fn()}));
beforeEach(()=>{vi.mocked(requireCalendarSyncRouteAuth).mockResolvedValue({authorized:true,kind:'email'} as any);vi.mocked(taskSnapshot).mockReset();});
const digest=(date:string)=>GET(new NextRequest('https://dashboard.test/api/family/completion-digest?date='+date));
it.each(['','2026-02-30','2026-13-01','2026-2-01','bad','2026-09-25T00:00:00Z'])('rejects invalid date %s before storage',async date=>{expect((await digest(date)).status).toBe(400);expect(taskSnapshot).not.toHaveBeenCalled();});
it('authenticates once before validating date or accessing snapshots',async()=>{vi.mocked(requireCalendarSyncRouteAuth).mockResolvedValue({authorized:false} as any);vi.mocked(requireCalendarSyncRouteAuth).mockClear();expect((await digest('bad')).status).toBe(401);expect(requireCalendarSyncRouteAuth).toHaveBeenCalledTimes(1);expect(taskSnapshot).not.toHaveBeenCalled();});
it.each([
 ['2026-01-15','2026-01-14T23:00:00.000Z','2026-01-15T23:00:00.000Z'],
 ['2026-07-15','2026-07-14T22:00:00.000Z','2026-07-15T22:00:00.000Z'],
 ['2026-03-29','2026-03-28T23:00:00.000Z','2026-03-29T22:00:00.000Z'],
 ['2026-10-25','2026-10-24T22:00:00.000Z','2026-10-25T23:00:00.000Z']
])('uses Madrid midnight and DST boundaries for %s',async(day,start,end)=>{
 const records=[Date.parse(start)-1,Date.parse(start),Date.parse(end)-1,Date.parse(end)].map((stamp,i)=>({id:String(i),title:'Done',owner:'Dani',status:'done',completedAt:new Date(stamp).toISOString()}));
 vi.mocked(taskSnapshot).mockResolvedValue({records} as any);
 expect(await readCompletionDigest(day)).toMatchObject({date:day,explicit:[],inferred:[{id:'1',channel:'other'},{id:'2',channel:'other'}]});
 expect((await digest(day)).status).toBe(200);
});
it('fails closed when the task snapshot is unavailable',async()=>{vi.mocked(taskSnapshot).mockRejectedValue(new Error('stale'));expect((await digest('2026-10-01')).status).toBe(503);});
it('preserves historical records and audits across provenance and relay retirement migrations',()=>{
 const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite');const db=new DatabaseSync(':memory:');
 try{const migration=(name:string)=>db.exec(readFileSync(new URL('../../migrations/'+name,import.meta.url),'utf8'));migration('0001_family_mission.sql');db.prepare('INSERT INTO family_audit(record_id,action,after_data,occurred_at) VALUES(?,?,?,?)').run('old','create','{"private":"unchanged"}','2026-09-25T00:00:00.000Z');db.prepare('INSERT INTO family_records(id,kind,data,created_at,updated_at) VALUES(?,?,?,?,?)').run('old-task','task','{"notes":"keep history"}','old','old');const audit=db.prepare('SELECT * FROM family_audit').get();const rows=db.prepare('SELECT * FROM family_records').all();migration('0006_completion_provenance.sql');migration('0008_google_tasks_relay.sql');migration('0009_google_tasks_fences.sql');migration('0010_drop_google_tasks_relay.sql');migration('0010_drop_google_tasks_relay.sql');expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'google_tasks_%'").all()).toEqual([]);expect(db.prepare('SELECT * FROM family_audit').get()).toEqual({...audit,completion_mode:null,completion_channel:null});expect(db.prepare('SELECT * FROM family_records').all()).toEqual(rows);expect(()=>db.exec("UPDATE family_audit SET completion_mode='guessed'")).toThrow();expect(()=>db.exec("UPDATE family_audit SET completion_channel='sms'")).toThrow();}finally{db.close();}
});
