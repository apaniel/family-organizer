import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {validateRecord,occursOn,reminderCandidates,addDays,dateKey,calendarEventStyle,calendarDayStyle,isCalendarDayBlock,calendarTimeLabel,taskAgeLabel,type FamilyRecord} from '@/lib/family-mission/model';
import {expandGoogleApiEvents,expandGoogleCalendar,googleEvents} from '@/lib/family-mission/google';
const task=(patch:any={}):FamilyRecord=>({...validateRecord({kind:'task',title:'Mochila',date:'2026-09-16',...patch}),id:'one',revision:1});
const feed=(events:string)=>`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}\r\nEND:VCALENDAR`;
describe('family records',()=>{
 it('rejects impossible dates and times',()=>{expect(()=>task({date:'2026-02-30'})).toThrow();expect(()=>task({time:'25:00'})).toThrow();});
 it('uses Madrid dates across midnight and DST',()=>{expect(dateKey(new Date('2026-09-16T22:30:00Z'))).toBe('2026-09-17');expect(addDays('2026-03-28',1)).toBe('2026-03-29');});
 it('weekdays exclude weekends',()=>{expect(occursOn(task({recurrence:'weekdays'}),'2026-09-19')).toBe(false);expect(occursOn(task({recurrence:'weekdays'}),'2026-09-21')).toBe(true);});
 it('reminds of birthdays ahead of the next year',()=>{expect(reminderCandidates([task({kind:'event',date:'2025-09-20',recurrence:'yearly',reminderDays:7})],'2026-09-16')).toHaveLength(1);});
 it('suppresses proposals, completed items, and completed daily occurrences',()=>{const daily=task({recurrence:'daily'});const completion={...task({status:'done',sourceKey:'completion:one:2026-09-16'}),id:'two'};expect(reminderCandidates([daily,completion,task({confirmed:false}),task({status:'done'})],'2026-09-16')).toHaveLength(0);expect(reminderCandidates([daily,completion],'2026-09-17')).toHaveLength(1);});
 it('keeps overdue unfinished one-off tasks',()=>{expect(reminderCandidates([task()],'2026-09-20')).toHaveLength(1);});
 it('shows how long an unfinished task has rolled over',()=>{expect(taskAgeLabel('2026-09-19','2026-09-19')).toBe('');expect(taskAgeLabel('2026-09-18','2026-09-19')).toBe('Desde ayer');expect(taskAgeLabel('2026-09-15','2026-09-19')).toBe('Desde hace 4 días');});
 it('only exposes safe Google colors as inline styles',()=>{expect(calendarEventStyle({...task(),color:'#D50000',foregroundColor:'#FFFFFF'})).toEqual({backgroundColor:'#d50000',borderColor:'#d50000',color:'#ffffff'});expect(calendarEventStyle({...task(),color:'url(javascript:bad)'})).toBeUndefined();});
 it('shades the whole day for all-day vacations using their event color',()=>{const vacation={...task(),kind:'event' as const,title:'Vacaciones de Navidad',category:'holiday',allDay:true,color:'#D50000'};expect(calendarDayStyle([vacation])).toEqual({backgroundColor:'rgba(213, 0, 0, 0.16)',boxShadow:'inset 0 4px 0 #d50000'});expect(calendarDayStyle([{...vacation,allDay:false}])).toBeUndefined();});
});
describe('school days off',()=>{
 it('shades libre disposición as a full day but does not shade a timed event',()=>{
  const day={...task(),kind:'event' as const,title:'🔴 Colegio · Libre disposición',category:'family',allDay:true,color:'#d50000'};
  expect(calendarDayStyle([day])?.backgroundColor).toBe('rgba(213, 0, 0, 0.16)');
  expect(calendarDayStyle([{...day,allDay:false}])).toBeUndefined();
 });
 it('includes every vacation day and excludes the exclusive Google end date',()=>{
  const events=expandGoogleApiEvents([{id:'break',summary:'Vacaciones de Navidad',start:{date:'2026-12-22'},end:{date:'2027-01-08'},colorId:'11'}],'2026-12-01','2027-01-31',{event:{'11':{background:'#d50000'}}});
  for(const day of ['2026-12-22','2026-12-31','2027-01-07'])expect(calendarDayStyle(events.filter(e=>occursOn(e,day)))).toBeDefined();
  expect(calendarDayStyle(events.filter(e=>occursOn(e,'2027-01-08')))).toBeUndefined();
 });
 it('categorizes Google libre disposición as a holiday without changing its all-day range',()=>{
  const [day]=expandGoogleApiEvents([{id:'free',summary:'Colegio · Libre disposición',start:{date:'2026-11-02'},end:{date:'2026-11-03'}}],'2026-11-01','2026-11-30');
  expect(day).toMatchObject({category:'holiday',allDay:true,date:'2026-11-02',endDate:'2026-11-02',time:''});
 });
});
describe('Google calendar expansion',()=>{
 it('treats all-day end as exclusive',()=>{const events=expandGoogleCalendar(feed('BEGIN:VEVENT\r\nUID:holiday\r\nDTSTART;VALUE=DATE:20260916\r\nDTEND;VALUE=DATE:20260918\r\nSUMMARY:Vacaciones\r\nEND:VEVENT'),'2026-09-01','2026-09-30');expect(events[0].date).toBe('2026-09-16');expect(events[0].endDate).toBe('2026-09-17');});
 it('includes a Madrid event just after local midnight',()=>{const events=expandGoogleCalendar(feed('BEGIN:VEVENT\r\nUID:early\r\nDTSTART:20260915T223000Z\r\nDTEND:20260915T230000Z\r\nSUMMARY:Plan\r\nEND:VEVENT'),'2026-09-16','2026-09-16');expect(events).toHaveLength(1);expect(events[0].time).toBe('00:30');});
 it('expands recurring events and skips a cancelled exception',()=>{const events=expandGoogleCalendar(feed('BEGIN:VEVENT\r\nUID:weekly\r\nDTSTART:20260916T100000Z\r\nDTEND:20260916T110000Z\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nSUMMARY:Clase\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:weekly\r\nRECURRENCE-ID:20260923T100000Z\r\nDTSTART:20260923T100000Z\r\nDTEND:20260923T110000Z\r\nSTATUS:CANCELLED\r\nEND:VEVENT'),'2026-09-01','2026-09-30');expect(events.map(e=>e.date)).toEqual(['2026-09-16','2026-09-30']);});
 it('keeps original Google event, label, and calendar colors',()=>{const events=expandGoogleApiEvents([
  {id:'legacy',summary:'Colegio',start:{date:'2026-09-16'},end:{date:'2026-09-17'},colorId:'5'},
  {id:'label',summary:'Cumple',start:{dateTime:'2026-09-16T18:30:00+02:00'},end:{dateTime:'2026-09-16T19:30:00+02:00'},eventLabelId:'birthday'},
  {id:'default',summary:'Familia',start:{date:'2026-09-17'},end:{date:'2026-09-18'}}
 ],'2026-09-01','2026-09-30',{event:{'5':{background:'#f6bf26',foreground:'#1d1d1d'}}},{backgroundColor:'#039be5',foregroundColor:'#ffffff'},[{id:'birthday',backgroundColor:'#d50000'}]);
 expect(events.map(e=>[e.title,e.color,e.foregroundColor])).toEqual([
  ['Colegio','#f6bf26','#1d1d1d'],['Cumple','#d50000','#ffffff'],['Familia','#039be5','#ffffff']
 ]);
 });
 it('uses the Calendar API when Cloudflare OAuth secrets are configured',async()=>{
  process.env.GOOGLE_CALENDAR_CLIENT_ID='client';process.env.GOOGLE_CALENDAR_CLIENT_SECRET='secret';process.env.GOOGLE_CALENDAR_REFRESH_TOKEN='refresh';
  const calls:string[]=[];vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const url=String(input);calls.push(url);
   if(url==='https://oauth2.googleapis.com/token')return new Response(JSON.stringify({access_token:'access'}),{status:200});
   expect(new Headers(init?.headers).get('authorization')).toBe('Bearer access');
   if(url.endsWith('/colors'))return new Response(JSON.stringify({event:{'5':{background:'#f6bf26',foreground:'#1d1d1d'}}}),{status:200});
   if(url.includes('/users/me/calendarList/'))return new Response(JSON.stringify({backgroundColor:'#039be5',foregroundColor:'#ffffff'}),{status:200});
   if(url.includes('/calendars/losapalas%40gmail.com/events'))return new Response(JSON.stringify({items:[{id:'one',summary:'Cumple',start:{date:'2026-09-16'},end:{date:'2026-09-17'},eventLabelId:'birthday'}]}),{status:200});
   if(url.endsWith('/calendars/losapalas%40gmail.com'))return new Response(JSON.stringify({labelProperties:{eventLabels:[{id:'birthday',backgroundColor:'#d50000'}]}}),{status:200});
   return new Response('',{status:404});
  }));
  try{const events=await googleEvents('2026-09-01','2026-09-30');expect(events[0].color).toBe('#d50000');expect(calls.some(url=>url.includes('eventLabelVersion'))).toBe(false);}
  finally{delete process.env.GOOGLE_CALENDAR_CLIENT_ID;delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;delete process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;vi.unstubAllGlobals();}
 });
});

describe('all-day calendar display',()=>{
 it('shades every JAF day blue without classifying it as a holiday',()=>{
  const events=expandGoogleApiEvents([{id:'jaf',summary:'JAF · Jornades',start:{date:'2026-09-28'},end:{date:'2026-10-03'},colorId:'9'}],'2026-09-01','2026-10-31',{event:{'9':{background:'#3f51b5'}}});
  expect(events[0]).toMatchObject({allDay:true,time:'',category:'family'});
  for(const day of ['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02'])expect(calendarDayStyle(events.filter(e=>occursOn(e,day)))?.backgroundColor).toBe('rgba(63, 81, 181, 0.16)');
  expect(calendarDayStyle(events.filter(e=>occursOn(e,'2026-10-03')))).toBeUndefined();
  expect(calendarDayStyle([{...events[0],allDay:false,time:'09:00'}])).toBeUndefined();
 });
});

describe('day status versus appointments',()=>{
 it('uses backgrounds only for day status, keeping date-only outings as events',()=>{
  const event={...task(),kind:'event' as const,allDay:true,color:'#3f51b5'};
  for(const title of ['JAF · Jornades','Vacaciones de Navidad','Colegio · Libre disposición','Festivo · La Mercè'])expect(isCalendarDayBlock({...event,title})).toBe(true);
  for(const title of ['Tibidabo con Laura y Chris','Paula: elección del nombre del ciclo y del grupo','¡Feliz cumpleaños!'])expect(calendarDayStyle([{...event,title}])).toBeUndefined();
  expect(calendarTimeLabel({...event,title:'Tibidabo'})).toBe('Horario por confirmar');
  expect(calendarTimeLabel({...event,title:'JAF'})).toBe('Todo el día');
  expect(calendarTimeLabel({...event,title:'¡Feliz cumpleaños!'})).toBe('Todo el día');
 });
 it('keeps both Google appointment times in Madrid',()=>{
  const [event]=expandGoogleApiEvents([{id:'appointment',summary:'Pediatra',start:{dateTime:'2026-09-22T18:45:00+02:00'},end:{dateTime:'2026-09-22T19:45:00+02:00'}}],'2026-09-01','2026-09-30');
  expect(event).toMatchObject({allDay:false,time:'18:45',endTime:'19:45'});
  expect(calendarTimeLabel(event)).toBe('18:45–19:45');
  expect(isCalendarDayBlock(event)).toBe(false);
 });
});

describe('shared account birthday',()=>{
 it('hides the account birthday but keeps real family birthdays',()=>{
  const date={start:{date:'2026-11-22'},end:{date:'2026-11-23'}};
  const events=expandGoogleApiEvents([
   {...date,id:'self',summary:'¡Feliz cumpleaños!',eventType:'birthday',birthdayProperties:{type:'self'}},
   {...date,id:'contact',summary:'Cumple de Emma',eventType:'birthday',birthdayProperties:{type:'contact'}},
   {...date,id:'regular',summary:'¡Feliz cumpleaños!'}
  ],'2026-11-01','2026-11-30');
  expect(events.map(e=>e.title)).toEqual(['Cumple de Emma','¡Feliz cumpleaños!']);
 });
 it('also hides the known account birthday in the ICS fallback',()=>{
  const events=expandGoogleCalendar(feed('BEGIN:VEVENT\r\nUID:f146nit8jcaohbdmns9fnad0v8@google.com\r\nDTSTART;VALUE=DATE:20261122\r\nDTEND;VALUE=DATE:20261123\r\nSUMMARY:¡Feliz cumpleaños!\r\nEND:VEVENT'),'2026-11-01','2026-11-30');
  expect(events).toHaveLength(0);
 });
});

describe('overlapping day blocks',()=>{
 it('shows a band for each day block, excluding outings and timed events',()=>{
  const jaf={...task(),kind:'event' as const,title:'JAF',allDay:true,color:'#3f51b5'};
  const holiday={...jaf,title:'Festivo',color:'#d50000'};
  const style=calendarDayStyle([jaf,holiday,{...jaf,title:'Tibidabo'},{...holiday,allDay:false,time:'10:00'}]);
  expect(style?.backgroundImage).toContain('rgba(63, 81, 181, 0.16) 0%');
  expect(style?.backgroundImage).toContain('rgba(213, 0, 0, 0.16) 50%');
  expect(style?.backgroundImage).toContain('#fff 50%');
  expect(style?.backgroundImage).toContain('#3f51b5 0%');
  expect(style?.backgroundImage).toContain('#d50000 50%');
  expect(style?.backgroundSize).toBe('100% 4px, 100% 100%');
  expect(style?.backgroundRepeat).toBe('no-repeat');
 });
 it('keeps identical-color overlaps separate and supports blocks without a color',()=>{
  const holiday={...task(),kind:'event' as const,title:'Festivo',allDay:true,color:'#d50000'};
  expect(calendarDayStyle([holiday,{...holiday,id:'two'}])?.backgroundImage).toContain('#fff 50%');
  expect(calendarDayStyle([{...holiday,color:undefined}])?.backgroundColor).toBe('rgba(89, 123, 220, 0.16)');
 });
});
