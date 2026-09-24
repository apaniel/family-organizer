import {describe,it,expect} from 'vitest';
import {validateRecord,reminderCandidates,type FamilyRecord} from '@/lib/family-mission/model';
const today='2026-09-24';
const record=(patch:Partial<FamilyRecord>={}):FamilyRecord=>({...validateRecord({kind:'task',title:'Mochila',date:today,owner:'Dani'}),id:'task',revision:4,...patch});
describe('completion and archive metadata',()=>{
 it('round-trips cancellation and explicit completion decisions through storage validation',()=>{
  expect(validateRecord(record({status:'cancelled'})).status).toBe('cancelled');
  expect(validateRecord(record({status:'done',completionDecision:'partial'})).completionDecision).toBe('partial');
  expect(validateRecord(record({status:'done',completionDecision:'all'})).completionDecision).toBe('all');
  expect(()=>validateRecord({...record(),completionDecision:'invented'})).toThrow('Decisión');
  expect(validateRecord(record({status:'open',completionDecision:'partial'})).completionDecision).toBeUndefined();
  for(const status of ['open','waiting','done'] as const)expect(validateRecord(record({status})).status).toBe(status);
 });
 it('excludes cancelled tasks and events from reminders without dropping records',()=>{
  const records=[record({status:'cancelled',date:'2026-09-01'}),record({id:'event',kind:'event',status:'cancelled'})];
  expect(reminderCandidates(records,today)).toEqual([]);
  expect(records).toHaveLength(2);
 });
});

import {attentionReport,normalTasks,activeDecisions} from '@/lib/family-mission/attention';
describe('canonical attention and daily health',()=>{
 it('groups exceptions per record, excludes cancelled and intentional partial completions',()=>{
  const records=[record({id:'late',date:'2026-09-01',owner:'Sin asignar',status:'waiting',confirmed:false}),
   record({id:'broken',status:'done',checklist:[{text:'Libro',done:false}]}),
   record({id:'partial',status:'done',completionDecision:'partial',checklist:[{text:'Libro',done:false}]}),
   record({id:'cancelled',status:'cancelled',owner:'Sin asignar',confirmed:false,date:'2026-09-01'}),
   record({id:'future',date:'2026-09-30',confirmed:false,kind:'event'}),
   record({id:'old-event',kind:'event',date:'2026-09-01',confirmed:false}),
   record({id:'day-off',kind:'event',allDay:true})];
  const report=attentionReport(records,today);
  expect(report.items.map(i=>[i.record.id,i.reasons])).toEqual([
   ['late',['overdue','waiting','unconfirmed','unassigned']],['broken',['incomplete']],['future',['unconfirmed']]
  ]);
  expect(report.counts).toEqual({overdue:1,waiting:1,unconfirmed:2,unassigned:1,incomplete:1});
  expect(report.health).toEqual({incomplete:1,stale:1,unassigned:1,approaching:1,overdue:1,waiting:1,unconfirmed:2})
  expect(Object.keys(report).sort()).toEqual(['counts','health','items']);;
  expect(normalTasks(records,today,today).map(r=>r.id)).toEqual(['late','broken','partial']);
  expect(activeDecisions(records,today).map(r=>r.id)).toEqual(['late','future']);
 });
 it('recomputes at rollover and suppresses completed recurring occurrences without losing inconsistencies',()=>{
  const daily=record({recurrence:'daily',date:'2026-09-01',owner:'Sin asignar',confirmed:false});
  const occurrence=record({id:'occurrence',status:'done',sourceKey:`completion:task:${today}`,checklist:[{text:'Libro',done:false}]});
  expect(attentionReport([daily,occurrence],today).items.map(i=>i.record.id)).toEqual(['occurrence']);
  expect(attentionReport([daily,occurrence],'2026-09-25').items.map(i=>i.record.id)).toEqual(['task','occurrence']);
  expect(attentionReport([record({date:today})],today).counts.overdue).toBe(0);
  expect(attentionReport([record({date:today})],'2026-09-25').counts.overdue).toBe(1);
 });

});

import {triageTask,completionAction,completionChoices} from '@/lib/family-mission/attention';
describe('revision-aware task actions',()=>{
 it('reschedules, waits and archives the same record without changing provenance or checklist',()=>{
  const task=record({date:'2026-09-01',source:'Importado del correo',sourceKey:'mail:123',checklist:[{text:'Libro',done:false}]});
  for(const [action,expected] of [[{type:'reschedule',date:'2026-09-28'},{date:'2026-09-28',status:'open'}],[{type:'wait'},{status:'waiting'}],[{type:'cancel'},{status:'cancelled'}]] as const){
   expect(triageTask(task,action)).toEqual({...task,...expected,completionDecision:undefined});
  }
  expect(()=>triageTask(task,{type:'reschedule',date:'2026-02-30'})).toThrow();
  expect(()=>triageTask({...task,readOnly:true},{type:'cancel'})).toThrow();
  expect(()=>triageTask({...task,recurrence:'daily'},{type:'reschedule',date:today})).toThrow();
 });
 it('requires exactly three choices and never silently closes an incomplete checklist',()=>{
  const task=record({checklist:[{text:'Libro',done:false}]});
  expect(completionChoices.map(c=>c.label)).toEqual(['Completar toda la lista y cerrar','Cerrar como parcialmente completada','Mantener abierta']);
  expect(completionAction(task,today,[])).toEqual({type:'choose'});
  expect(completionAction(task,today,[],'keep')).toEqual({type:'keep'});
  expect(completionAction(task,today,[],'all')).toEqual({type:'save',record:{...task,status:'done',completionDecision:'all',checklist:[{text:'Libro',done:true}]}});
  expect(completionAction(task,today,[],'partial')).toEqual({type:'save',record:{...task,status:'done',completionDecision:'partial'}});
  expect(completionAction(record(),today,[]).type).toBe('save');
  expect(()=>completionAction({...task,readOnly:true},today,[])).toThrow();
 });
 it('completes the requested recurring occurrence, reuses its revision and leaves the template untouched',()=>{
  const template=record({recurrence:'daily',date:'2026-09-01',checklist:[{text:'Libro',done:false}]});
  const before=structuredClone(template);
  const result=completionAction(template,'2026-09-25',[],'partial');
  expect(result).toEqual({type:'save',record:{...template,id:'',revision:0,date:'2026-09-25',recurrence:'none',status:'done',sourceKey:'completion:task:2026-09-25',completionDecision:'partial',completionParent:{id:template.id,revision:template.revision}}});
  const existing=record({id:'occurrence',revision:8,status:'done',date:'2026-09-25',sourceKey:'completion:task:2026-09-25',checklist:template.checklist});
  expect(completionAction(template,'2026-09-25',[existing],'all')).toMatchObject({type:'save',record:{id:'occurrence',revision:8,completionDecision:'all',checklist:[{text:'Libro',done:true}]}});
  expect(template).toEqual(before);
  expect(()=>completionAction(template,'2026-08-01',[],'all')).toThrow();
 });
 it('resolves a legacy done inconsistency in place, and keep-open reopens that occurrence only',()=>{
  const legacy=record({status:'done',sourceKey:'completion:template:2026-09-24',checklist:[{text:'Libro',done:false}]});
  expect(completionAction(legacy,today,[])).toEqual({type:'choose'});
  expect(completionAction(legacy,today,[],'partial')).toMatchObject({type:'save',record:{id:legacy.id,revision:4,completionDecision:'partial'}});
  expect(completionAction(legacy,today,[],'keep')).toMatchObject({type:'save',record:{id:legacy.id,status:'open',completionDecision:undefined}});
 });
});

import {attentionMetadata} from '@/lib/family-mission/attention';
describe('visible owner, status and provenance',()=>{
 it('labels local, imported and read-only Google rows with explicit statuses',()=>{
  expect(attentionMetadata(record({date:'2026-09-01',status:'waiting',confirmed:false}),today)).toEqual('Dani · Esperando respuesta · Plan local');
  expect(attentionMetadata(record({kind:'event',readOnly:true,source:'Google Calendar · losapalas@gmail.com'}),today)).toEqual('Dani · Pendiente · Google Calendar · solo lectura · editar allí');
  expect(attentionMetadata(record({source:'Correo del colegio',status:'done',completionDecision:'partial'}),today)).toEqual('Dani · Completada parcialmente · Información importada · Correo del colegio');
  expect(attentionMetadata(record({status:'cancelled',date:'2026-09-01',confirmed:false}),today)).toEqual('Dani · Cancelada / archivada · Plan local');
  expect(attentionMetadata(record({owner:'   ',source:'Correo',readOnly:true}),today)).toBe('Sin asignar · Pendiente · Información importada · Correo · solo lectura');
  const recurring=record({date:'2026-09-01',recurrence:'daily'});
  const occurrence=record({id:'occurrence',sourceKey:'completion:task:2026-09-24',status:'done',completionDecision:'partial'});
  expect(attentionMetadata(recurring,today,[occurrence])).toContain('Completada parcialmente');
 });
});

describe('daily reconciliation completeness',()=>{
 it('counts every integrity category from the same records and clears resolved issues',()=>{
  const task=record({date:'2026-09-23',status:'waiting',confirmed:false,owner:'Sin asignar'});
  const event=record({id:'event',kind:'event',owner:'Sin asignar'});
  const report=attentionReport([task,event],today);
  expect(report.health).toMatchObject({overdue:1,waiting:1,unconfirmed:1,unassigned:2});
  expect(report.items.find(i=>i.record.id==='event')?.reasons).toContain('unassigned');
  expect(attentionReport([{...task,status:'cancelled'},{...event,owner:'Dani'}],today).health).toMatchObject({overdue:0,waiting:0,unconfirmed:0,unassigned:0});
 });

});

describe('completion integrity at the model boundary',()=>{
 it('rejects a claimed full completion with unchecked items but retains legacy inconsistencies for review',()=>{
  const raw=record({status:'done',completionDecision:'all',checklist:[{text:'Libro',done:false}]});
  expect(()=>validateRecord(raw)).toThrow('lista');
  expect(validateRecord({...raw,completionDecision:undefined}).checklist[0].done).toBe(false);
  expect(validateRecord({...raw,completionDecision:'partial'}).completionDecision).toBe('partial');
 });
 it('requires a fresh choice after reopening a previously partial task',()=>{
  const task=record({status:'open',completionDecision:'partial',checklist:[{text:'Libro',done:false}]});
  expect(completionAction(task,today,[])).toEqual({type:'choose'});
 });
});

import {taskEditorContext} from '@/lib/family-mission/attention';
describe('editing recurring rows',()=>{
 it('uses the clicked row date and its stored occurrence checklist and revision',()=>{
  const template=record({recurrence:'daily',date:'2026-09-01',checklist:[{text:'Libro',done:false}]});
  const occurrence=record({id:'occurrence',revision:7,date:'2026-09-25',status:'done',completionDecision:'partial',sourceKey:'completion:task:2026-09-25',checklist:[{text:'Libro',done:true},{text:'Agua',done:false}]});
  expect(taskEditorContext(template,'2026-09-25',[occurrence])).toEqual({record:occurrence,day:'2026-09-25'});
  const context=taskEditorContext(template,'2026-09-26',[occurrence]);
  expect(completionAction(context.record,context.day,[occurrence],'all')).toMatchObject({type:'save',record:{date:'2026-09-26',sourceKey:'completion:task:2026-09-26'}});
  expect(taskEditorContext(template,'2026-09-25',[{...occurrence,status:'open'}]).record.id).toBe('occurrence');
 });
});

it('suppresses an archived recurring occurrence in lists, decisions, health and reminders only on its date',()=>{
 const template=record({recurrence:'daily',confirmed:false,owner:'Sin asignar'});
 const cancelled=record({id:'occurrence',status:'cancelled',sourceKey:'completion:task:2026-09-24'});
 const records=[template,cancelled];
 expect(normalTasks(records,today,today)).toEqual([]);
 expect(activeDecisions(records,today)).toEqual([]);
 expect(attentionReport(records,today).items).toEqual([]);
 expect(reminderCandidates([{...template,confirmed:true},cancelled],today)).toEqual([]);
 expect(normalTasks(records,'2026-09-25',today)).toEqual([template]);
 expect(reminderCandidates([{...template,confirmed:true},cancelled],'2026-09-25')).toHaveLength(1);
});

import {calendarLoadRanges} from '@/lib/family-mission/attention';
it('loads both the browsed calendar period and Today reconciliation without an unbounded API range',()=>{
 expect(calendarLoadRanges(today,today,true)).toEqual([{from:'2026-08-25',to:'2026-11-03'}]);
 expect(calendarLoadRanges('2025-01-15',today,true)).toEqual([
  {from:'2024-12-25',to:'2025-03-05'},{from:'2026-08-25',to:'2026-11-03'}
 ]);
 expect(calendarLoadRanges('2025-01-15',today,false)).toEqual([{from:'2024-12-25',to:'2025-03-05'}]);
});

import {activeWaiting} from '@/lib/family-mission/attention';
it('keeps recurring follow-up consistent with resolved and cancelled occurrences',()=>{
 const template=record({recurrence:'daily',status:'waiting'});
 for(const status of ['done','cancelled'] as const){
  const occurrence=record({id:'occurrence',sourceKey:'completion:task:2026-09-24',status});
  expect(activeWaiting([template,occurrence],today)).toEqual([]);
  expect(activeWaiting([template,occurrence],'2026-09-25')).toEqual([template]);
 }
});
it('lists yesterday reopened occurrence overdue independently of today without duplicate reminders or decisions',()=>{
 const yesterday='2026-09-23';
 const template=record({recurrence:'daily',date:'2026-09-01',confirmed:false});
 const legacy=record({id:'yesterday',date:yesterday,status:'done',confirmed:false,sourceKey:`completion:${template.id}:${yesterday}`,checklist:[{text:'Libro',done:false}]});
 const action=completionAction(legacy,yesterday,[template,legacy],'keep');
 if(action.type!=='save')throw new Error('Expected reopen');
 const reopened=action.record;
 const records=[template,reopened];
 expect(normalTasks(records,today,today).map(r=>r.id)).toEqual(['task','yesterday']);
 expect(attentionReport(records,today).items.find(i=>i.record.id==='yesterday')?.reasons).toEqual(['overdue','unconfirmed']);
 expect(activeDecisions(records,today).map(r=>r.id)).toEqual(['task','yesterday']);
 expect(reminderCandidates(records.map(r=>({...r,confirmed:true})),today).map(r=>r.id)).toEqual(['task','yesterday']);
 const current=completionAction(template,today,records,'all');
 if(current.type!=='save')throw new Error('Expected today occurrence');
 expect(current.record).toMatchObject({id:'',revision:0,date:today,sourceKey:`completion:${template.id}:${today}`});
 const completed={...current.record,id:'today',revision:1};
 expect(activeDecisions([...records,completed],today).map(r=>r.id)).toEqual(['yesterday']);
 expect(reminderCandidates([...records,completed].map(r=>({...r,confirmed:true})),today).map(r=>r.id)).toEqual(['yesterday']);
 expect(reopened.status).toBe('open');
 // On its own day, the stored occurrence supplies the effective state.
 expect(normalTasks(records,yesterday,yesterday).map(r=>r.id)).toEqual(['yesterday']);
 expect(activeDecisions(records,yesterday).map(r=>r.id)).toEqual(['yesterday']);
 expect(reminderCandidates(records.map(r=>({...r,confirmed:true})),yesterday).map(r=>r.id)).toEqual(['yesterday']);
});
describe('current-day occurrence is the effective record',()=>{
 it.each(['open','waiting'] as const)('uses %s occurrence state across rows, attention, health, decisions and metadata',(status)=>{
  const template=record({recurrence:'daily',owner:'Dani',confirmed:true});
  const occurrence=record({id:'occurrence',sourceKey:`completion:task:${today}`,status,owner:'Sin asignar',confirmed:false});
  const records=[template,occurrence];
  expect(normalTasks(records,today,today)).toEqual([occurrence]);
  const report=attentionReport(records,today);
  expect(report.items.map(i=>i.record)).toEqual([occurrence]);
  expect(report.counts).toMatchObject({waiting:status==='waiting'?1:0,unconfirmed:1,unassigned:1,overdue:0});
  expect(report.health).toMatchObject({waiting:status==='waiting'?1:0,unconfirmed:1,unassigned:1});
  expect(activeWaiting(records,today)).toEqual(status==='waiting'?[occurrence]:[]);
  expect(activeDecisions(records,today)).toEqual([occurrence]);
  expect(attentionMetadata(template,today,records)).toEqual(`Sin asignar · ${status==='waiting'?'Esperando respuesta':'Pendiente'} · Plan local`);
  expect(reminderCandidates(records,today)).toEqual([]);
  expect(reminderCandidates([template,{...occurrence,confirmed:true}],today).map(r=>r.id)).toEqual(['occurrence']);
  const noisyTemplate={...template,status:'waiting' as const,owner:'Sin asignar',confirmed:false};
  const cleanOccurrence={...occurrence,status:'open' as const,owner:'Cris',confirmed:true};
  expect(attentionReport([noisyTemplate,cleanOccurrence],today).items).toEqual([]);
  expect(activeDecisions([noisyTemplate,cleanOccurrence],today)).toEqual([]);
  expect(activeWaiting([noisyTemplate,cleanOccurrence],today)).toEqual([]);
  for(const status of ['done','cancelled'] as const){
   const resolved=[noisyTemplate,{...occurrence,status}];
   expect(attentionReport(resolved,today).items).toEqual([]);
   expect(reminderCandidates(resolved,today)).toEqual([]);
  }
 });
});

it('evaluates reminderDays for an occurrence moved from September 23 to September 25',()=>{
 const moved=record({id:'moved',date:'2026-09-25',sourceKey:'completion:series:2026-09-23',reminderDays:7});
 expect(reminderCandidates([moved],'2026-09-24')).toEqual([moved]);
 // Future reminders still respect the window, confirmation, status and record kind.
 for(const patch of [{reminderDays:0},{date:'2026-10-02'},{confirmed:false},{status:'done'},{status:'cancelled'},{kind:'meal'}] as const){
  expect(reminderCandidates([{...moved,...patch}],'2026-09-24')).toEqual([]);
 }
 for(const status of ['open','waiting'] as const){
  const active={...moved,status};
  expect(reminderCandidates([active],'2026-09-25')).toEqual([active]);
  expect(reminderCandidates([active],'2026-09-26')).toEqual([active]);
 }
});
