import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {validateRecord,occursOn,reminderCandidates,addDays,dateKey,type FamilyRecord} from '@/lib/family-mission/model';
import {expandGoogleCalendar} from '@/lib/family-mission/google';
const task=(patch:any={}):FamilyRecord=>({...validateRecord({kind:'task',title:'Mochila',date:'2026-09-16',...patch}),id:'one',revision:1});
const feed=(events:string)=>`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}\r\nEND:VCALENDAR`;
describe('family records',()=>{
 it('rejects impossible dates and times',()=>{expect(()=>task({date:'2026-02-30'})).toThrow();expect(()=>task({time:'25:00'})).toThrow();});
 it('uses Madrid dates across midnight and DST',()=>{expect(dateKey(new Date('2026-09-16T22:30:00Z'))).toBe('2026-09-17');expect(addDays('2026-03-28',1)).toBe('2026-03-29');});
 it('weekdays exclude weekends',()=>{expect(occursOn(task({recurrence:'weekdays'}),'2026-09-19')).toBe(false);expect(occursOn(task({recurrence:'weekdays'}),'2026-09-21')).toBe(true);});
 it('reminds of birthdays ahead of the next year',()=>{expect(reminderCandidates([task({kind:'event',date:'2025-09-20',recurrence:'yearly',reminderDays:7})],'2026-09-16')).toHaveLength(1);});
 it('suppresses proposals, completed items, and completed daily occurrences',()=>{const daily=task({recurrence:'daily'});const completion={...task({status:'done',sourceKey:'completion:one:2026-09-16'}),id:'two'};expect(reminderCandidates([daily,completion,task({confirmed:false}),task({status:'done'})],'2026-09-16')).toHaveLength(0);expect(reminderCandidates([daily,completion],'2026-09-17')).toHaveLength(1);});
 it('keeps overdue unfinished one-off tasks',()=>{expect(reminderCandidates([task()],'2026-09-20')).toHaveLength(1);});
});
describe('Google calendar expansion',()=>{
 it('treats all-day end as exclusive',()=>{const events=expandGoogleCalendar(feed('BEGIN:VEVENT\r\nUID:holiday\r\nDTSTART;VALUE=DATE:20260916\r\nDTEND;VALUE=DATE:20260918\r\nSUMMARY:Vacaciones\r\nEND:VEVENT'),'2026-09-01','2026-09-30');expect(events[0].date).toBe('2026-09-16');expect(events[0].endDate).toBe('2026-09-17');});
 it('includes a Madrid event just after local midnight',()=>{const events=expandGoogleCalendar(feed('BEGIN:VEVENT\r\nUID:early\r\nDTSTART:20260915T223000Z\r\nDTEND:20260915T230000Z\r\nSUMMARY:Plan\r\nEND:VEVENT'),'2026-09-16','2026-09-16');expect(events).toHaveLength(1);expect(events[0].time).toBe('00:30');});
 it('expands recurring events and skips a cancelled exception',()=>{const events=expandGoogleCalendar(feed('BEGIN:VEVENT\r\nUID:weekly\r\nDTSTART:20260916T100000Z\r\nDTEND:20260916T110000Z\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nSUMMARY:Clase\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:weekly\r\nRECURRENCE-ID:20260923T100000Z\r\nDTSTART:20260923T100000Z\r\nDTEND:20260923T110000Z\r\nSTATUS:CANCELLED\r\nEND:VEVENT'),'2026-09-01','2026-09-30');expect(events.map(e=>e.date)).toEqual(['2026-09-16','2026-09-30']);});
});
