import {describe,it,expect} from 'vitest';
import {validateRecord,type FamilyRecord} from '@/lib/family-mission/model';
import {attentionLabels,attentionReasonCopy,attentionContext,attentionSummary} from '@/lib/family-mission/attention';
const today='2026-09-24';
const record=(patch:Partial<FamilyRecord>={}):FamilyRecord=>({...validateRecord({kind:'task',title:'Mochila',date:today,owner:'Dani'}),id:'task',revision:4,...patch});

describe('phone attention copy',()=>{
 it('explains every reason in plain Spanish with stable priority and no repeated reasons',()=>{
  expect(attentionLabels.incomplete).toBe('Tareas hechas con pasos pendientes');
  expect(attentionReasonCopy(['incomplete'])).toBe('Marcada como hecha, pero todavía faltan pasos');
  expect(attentionReasonCopy(['unassigned','waiting','overdue','unconfirmed','overdue'])).toBe('Pasó la fecha · falta una respuesta · falta confirmar · falta responsable');
  expect(attentionReasonCopy(['waiting'])).toBe('Falta una respuesta');
  expect(attentionReasonCopy(['unconfirmed'])).toBe('Falta confirmar');
  expect(attentionReasonCopy(['unassigned'])).toBe('Falta responsable');
 });
 it('keeps owner, human date and source without duplicating status',()=>{
  expect(attentionContext(record({status:'waiting'}),today)).toBe('Dani · Hoy · Plan local');
  expect(attentionContext(record({date:'2026-09-23'}),today)).toBe('Dani · Ayer · Plan local');
  expect(attentionContext(record({date:'2026-09-25'}),today)).toBe('Dani · Mañana · Plan local');
  expect(attentionContext(record({date:'2025-09-01',source:'Correo del colegio'}),today)).toBe('Dani · 1 sept 2025 · Información importada · Correo del colegio');
  expect(attentionContext(record({owner:' ',readOnly:true,source:'Google Calendar · privado@example.com'}),today)).toBe('Sin asignar · Hoy · Google Calendar · solo lectura · editar allí');
  expect(attentionContext(record({readOnly:true,source:'Correo'}),today)).toContain('Información importada · Correo · solo lectura');
 });
 it('counts records in a short human line',()=>{
  expect(attentionSummary(0)).toBe('Todo al día');
  expect(attentionSummary(1)).toBe('1 asunto para revisar');
  expect(attentionSummary(4)).toBe('4 asuntos para revisar');
 });
});

import {attentionQuickActions,attentionTomorrow,triageTask,canTriageOverdue,type AttentionReason} from '@/lib/family-mission/attention';
describe('phone attention actions',()=>{
 it('prioritizes steps, then overdue resolution, then confirmation and assignment; caps at three',()=>{
  const overdue=record({date:'2026-09-20',confirmed:false,owner:''});
  const reasons:AttentionReason[]=['unassigned','unconfirmed','overdue'];
  expect(attentionQuickActions(overdue,reasons)).toEqual([{type:'complete',label:'Hecha'},{type:'tomorrow',label:'Mañana'},{type:'wait',label:'Esperando'}]);
  expect(attentionQuickActions(overdue,[...reasons].reverse())).toEqual(attentionQuickActions(overdue,reasons));
  expect(attentionQuickActions(record({status:'done'}),['incomplete'])).toEqual([{type:'complete',label:'Revisar pasos'}]);
  expect(attentionQuickActions(record({kind:'event',confirmed:false,owner:''}),['unassigned','unconfirmed'])).toEqual([{type:'confirm',label:'Confirmar'},{type:'assign',label:'Asignar'}]);
  expect(attentionQuickActions(overdue,['incomplete',...reasons]).map(a=>a.label)).toEqual(['Revisar pasos','Mañana','Esperando']);
 });
 it('reactivates waiting tasks, including overdue ones, and preserves recurring safeguards',()=>{
  expect(attentionQuickActions(record({status:'waiting'}),['waiting'])).toEqual([{type:'reactivate',label:'Reactivar'}]);
  expect(attentionQuickActions(record({status:'waiting',confirmed:false,owner:''}),['waiting','unconfirmed','unassigned']).map(a=>a.label)).toEqual(['Reactivar','Confirmar','Asignar']);
  expect(attentionQuickActions(record({status:'waiting',date:'2026-09-01'}),['overdue','waiting']).map(a=>a.label)).toEqual(['Hecha','Mañana','Reactivar']);
  expect(attentionQuickActions(record({status:'waiting',recurrence:'daily'}),['waiting'])).toEqual([]);
  expect(canTriageOverdue(record({recurrence:'daily'}),['overdue'])).toBe(false);
 });
 it('suppresses all writes and secondary controls for read-only records regardless of reasons',()=>{
  const reasons:AttentionReason[]=['incomplete','overdue','waiting','unconfirmed','unassigned'];
  expect(attentionQuickActions(record({readOnly:true}),reasons)).toEqual([]);
  expect(canTriageOverdue(record({readOnly:true}),reasons)).toBe(false);
  expect(canTriageOverdue(record(),['overdue'])).toBe(true);
  expect(canTriageOverdue(record(),['waiting'])).toBe(false);
 });
 it('uses the dashboard date for tomorrow across month, leap-day and year boundaries',()=>{
  expect(attentionTomorrow(today)).toEqual({type:'reschedule',date:'2026-09-25'});
  expect(attentionTomorrow('2026-12-31')).toEqual({type:'reschedule',date:'2027-01-01'});
  expect(attentionTomorrow('2028-02-28')).toEqual({type:'reschedule',date:'2028-02-29'});
  expect(attentionTomorrow('2026-09-30')).toEqual({type:'reschedule',date:'2026-10-01'});
 });
 it('reactivates in place without changing provenance, revision, date or checklist',()=>{
  const task=record({status:'waiting',source:'Correo',sourceKey:'mail:123',checklist:[{text:'Libro',done:false}]});
  expect(triageTask(task,{type:'reactivate'})).toEqual({...task,status:'open',completionDecision:undefined});
  expect(task.status).toBe('waiting');
  expect(()=>triageTask({...task,readOnly:true},{type:'reactivate'})).toThrow();
  expect(()=>triageTask({...task,recurrence:'daily'},{type:'reactivate'})).toThrow();
  expect(()=>triageTask({...task,kind:'event'},{type:'reactivate'})).toThrow();
 });
});

import {attentionReport} from '@/lib/family-mission/attention';
describe('attention preview ordering',()=>{
 it('uses highest severity, then ascending date and Spanish title, regardless of input order',()=>{
  const fixtures=[
   record({id:'unassigned',owner:'',confirmed:true}),
   record({id:'waiting',status:'waiting',confirmed:true}),
   record({id:'unconfirmed',confirmed:false,status:'waiting',owner:''}),
   record({id:'overdue-z',title:'Zapatos',date:'2026-09-22',confirmed:true}),
   record({id:'overdue-a',title:'Abrigo',date:'2026-09-22',confirmed:true}),
   record({id:'overdue-old',date:'2026-09-21',confirmed:false}),
   record({id:'incomplete',status:'done',checklist:[{text:'Paso',done:false}]}),
  ];
  const expected=['incomplete','overdue-old','overdue-a','overdue-z','unconfirmed','waiting','unassigned'];
  expect(attentionReport(fixtures,today).items.map(i=>i.record.id)).toEqual(expected);
  expect(attentionReport([...fixtures].reverse(),today).items.map(i=>i.record.id)).toEqual(expected);
  expect(fixtures[0].id).toBe('unassigned');
 });
});
