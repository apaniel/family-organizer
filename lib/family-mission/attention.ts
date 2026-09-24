import {addDays,occursOn,isPastOpenOccurrence,type FamilyRecord} from './model';

export type AttentionReason='overdue'|'waiting'|'unconfirmed'|'unassigned'|'incomplete';
export const attentionLabels:Record<AttentionReason,string>={overdue:'Vencidas',waiting:'Esperando respuesta',unconfirmed:'Sin confirmar',unassigned:'Sin responsable',incomplete:'Tareas hechas con pasos pendientes'};
export const isActive=(r:FamilyRecord)=>r.status!=='done'&&r.status!=='cancelled';
const cancelledOccurrence=(r:FamilyRecord,records:FamilyRecord[],day:string)=>records.some(c=>c.sourceKey===`completion:${r.id}:${day}`&&c.status==='cancelled');
const isOccurrence=(r:FamilyRecord)=>r.sourceKey?.startsWith('completion:');
const activeOccurrence=(r:FamilyRecord,records:FamilyRecord[],day:string)=>records.find(c=>c.sourceKey===`completion:${r.id}:${day}`&&c.date===day&&isActive(c));
export function occurrenceRecord(r:FamilyRecord,records:FamilyRecord[],day:string){return records.find(c=>c.sourceKey===`completion:${r.id}:${day}`&&c.status==='done');}
export function isCompleted(r:FamilyRecord,records:FamilyRecord[],day:string){return r.status==='done'||!!occurrenceRecord(r,records,day);}
export const isOverdue=(r:FamilyRecord,today:string)=>r.kind==='task'&&isActive(r)&&r.recurrence==='none'&&r.date<today;
export const incompleteCompletion=(r:FamilyRecord)=>r.kind==='task'&&r.status==='done'&&r.completionDecision!=='partial'&&r.checklist.some(c=>!c.done);
const unassigned=(r:FamilyRecord)=>!r.owner.trim()||r.owner.trim().toLocaleLowerCase('es')==='sin asignar';
function activeOnwards(r:FamilyRecord,records:FamilyRecord[],today:string){
 return isActive(r)&&!cancelledOccurrence(r,records,today)&&(!isOccurrence(r)||r.date===today||isPastOpenOccurrence(r,today))&&!activeOccurrence(r,records,today)&&!occurrenceRecord(r,records,today)&&(r.kind==='task'||r.recurrence!=='none'||(r.endDate||r.date)>=today);
}
export function normalTasks(records:FamilyRecord[],day:string,today:string){
 return records.filter(r=>r.kind==='task'&&r.status!=='cancelled'&&!cancelledOccurrence(r,records,day)&&!activeOccurrence(r,records,day)&&(!isOccurrence(r)||(isActive(r)&&r.date===day)||(day===today&&isPastOpenOccurrence(r,today)))&&(occursOn(r,day)||(day===today&&isOverdue(r,today))));
}
export function activeWaiting(records:FamilyRecord[],today:string){return records.filter(r=>r.kind==='task'&&r.status==='waiting'&&activeOnwards(r,records,today));}
export function activeDecisions(records:FamilyRecord[],today:string){return records.filter(r=>!r.confirmed&&activeOnwards(r,records,today));}
export function attentionReport(records:FamilyRecord[],today:string){
 const counts:Record<AttentionReason,number>={overdue:0,waiting:0,unconfirmed:0,unassigned:0,incomplete:0};
 const items:{record:FamilyRecord;reasons:AttentionReason[]}[]=[];
 const health={incomplete:0,stale:0,unassigned:0,approaching:0};
 for(const r of records){
  if(r.status==='cancelled')continue;
  const reasons:AttentionReason[]=[];
  if(activeOnwards(r,records,today)){
   if(isOverdue(r,today)){reasons.push('overdue');if(r.date<=addDays(today,-7))health.stale++;}
   if(r.kind==='task'&&r.status==='waiting')reasons.push('waiting');
   if(!r.confirmed){
    reasons.push('unconfirmed');
    if(r.kind==='event'&&Array.from({length:8},(_,i)=>addDays(today,i)).some(d=>occursOn(r,d)))health.approaching++;
   }
   if(r.kind!=='meal'&&unassigned(r)){reasons.push('unassigned');health.unassigned++;}
  }
  if(incompleteCompletion(r)){reasons.push('incomplete');health.incomplete++;}
  if(reasons.length){items.push({record:r,reasons});for(const reason of reasons)counts[reason]++;}
 }
 const severity:AttentionReason[]=['incomplete','overdue','unconfirmed','waiting','unassigned'];
 const rank=(reasons:AttentionReason[])=>Math.min(...reasons.map(reason=>severity.indexOf(reason)));
 items.sort((a,b)=>rank(a.reasons)-rank(b.reasons)||a.record.date.localeCompare(b.record.date)||a.record.title.localeCompare(b.record.title,'es')||a.record.id.localeCompare(b.record.id));
 return {items,counts,health:{...health,overdue:counts.overdue,waiting:counts.waiting,unconfirmed:counts.unconfirmed}};
}

export type TriageAction={type:'reschedule';date:string}|{type:'wait'}|{type:'reactivate'}|{type:'cancel'};
export function triageTask(r:FamilyRecord,action:TriageAction):FamilyRecord{
 if(r.readOnly||r.kind!=='task'||r.recurrence!=='none')throw new Error('Esta acción requiere una tarea local sin repetición.');
 if(action.type==='reschedule'){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(action.date)||!Number.isFinite(Date.parse(action.date))||new Date(action.date+'T12:00:00Z').toISOString().slice(0,10)!==action.date)throw new Error('Indica una fecha válida.');
  return {...r,date:action.date,status:'open',completionDecision:undefined};
 }
 return {...r,status:action.type==='wait'?'waiting':action.type==='reactivate'?'open':'cancelled',completionDecision:undefined};
}
export const completionChoices=[
 {value:'all',label:'Completar toda la lista y cerrar'},
 {value:'partial',label:'Cerrar como parcialmente completada'},
 {value:'keep',label:'Mantener abierta'},
] as const;
export type CompletionChoice=typeof completionChoices[number]['value'];
type CompletionAction={type:'create-template';record:FamilyRecord}|{type:'choose'}|{type:'keep'}|{type:'save';record:FamilyRecord & {completeOn?:string;completeChoice?:CompletionChoice}};
export function completionAction(r:FamilyRecord,day:string,records:FamilyRecord[],choice?:CompletionChoice,snapshot?:FamilyRecord[]):CompletionAction{
 if(snapshot){
  if(r.recurrence!=='none'){
   const expected=snapshot.find(c=>c.id===r.id),current=records.find(c=>c.id===r.id);
   if(expected?.revision!==current?.revision||expected?.status!==current?.status||current?.status==='cancelled')
    throw new Error('Esta tarea ha cambiado. Actualiza la página y vuelve a abrir la decisión.');
  }
  const find=(list:FamilyRecord[])=>r.recurrence!=='none'
   ?list.find(c=>c.sourceKey===`completion:${r.id}:${day}`)
   :list.find(c=>r.id?c.id===r.id:!!r.sourceKey&&c.sourceKey===r.sourceKey);
  const expected=find(snapshot),current=find(records);
  if(expected?.id!==current?.id||expected?.revision!==current?.revision||expected?.status!==current?.status||current?.status==='cancelled')
   throw new Error('Esta tarea ha cambiado. Actualiza la página y vuelve a abrir la decisión.');
 }
 if(r.readOnly||r.kind!=='task'||r.status==='cancelled')throw new Error('Esta tarea no se puede completar.');
 let target=r;
 const legacyClosure=!!r.id&&!!r.revision&&incompleteCompletion(records.find(current=>current.id===r.id)||r);
 if(r.recurrence!=='none'&&!legacyClosure){
  if(!r.id||!r.revision)return {type:'create-template',record:{...r,status:'open',completionDecision:undefined}};
  if(!occursOn(r,day))throw new Error('La tarea no corresponde a este día.');
  const sourceKey=`completion:${r.id}:${day}`;
  target=(snapshot||records).find(c=>c.sourceKey===sourceKey)||{...r,id:'',revision:0,date:day,recurrence:'none',status:'open',sourceKey,completionParent:{id:r.id,revision:r.revision}};
  if(target.date!==day)throw new Error('Esta tarea ha cambiado. Actualiza la página y vuelve a abrir la decisión.');
 }
 if(target.status==='cancelled')throw new Error('Esta tarea ha cambiado. Actualiza la página y vuelve a abrir la decisión.');
 if(choice==='keep')return target.status==='done'?{type:'save',record:{...target,status:'open',completionDecision:undefined}}:{type:'keep'};
 if(!choice&&target.checklist.some(c=>!c.done)&&(target.status!=='done'||target.completionDecision!=='partial'))return {type:'choose'};
 return {type:'save',record:{...target,status:'done',completionDecision:choice==='partial'||(!choice&&target.status==='done'&&target.completionDecision==='partial')?'partial':'all',checklist:choice==='all'?target.checklist.map(c=>({...c,done:true})):target.checklist}};
}

export function recordSource(r:FamilyRecord):string{
 return r.readOnly&&/^Google Calendar/i.test(r.source)?'Google Calendar · solo lectura · editar allí':(!r.source||r.source==='Familia')?'Plan local':`Información importada · ${r.source}${r.readOnly?' · solo lectura':''}`;
}

export function attentionMetadata(r:FamilyRecord,day:string,records:FamilyRecord[]=[]):string{
 const effective=activeOccurrence(r,records,day)||occurrenceRecord(r,records,day)||r;
 const status=effective.status==='cancelled'?'Cancelada / archivada':effective.status==='done'?(effective.completionDecision==='partial'?'Completada parcialmente':'Completada'):effective.status==='waiting'?'Esperando respuesta':'Pendiente';
 return [effective.owner.trim()||'Sin asignar',status,recordSource(r)].join(' · ');
}

// Row date must travel with the editor, independently of the dashboard date.
export function taskEditorContext(record:FamilyRecord,day:string,records:FamilyRecord[]){
 const occurrence=record.kind==='task'&&record.recurrence!=='none'
  ?records.find(r=>r.sourceKey===`completion:${record.id}:${day}`):undefined;
 return {record:occurrence||record,day};
}

export function calendarLoadRanges(day:string,today:string,includeToday:boolean){
 const months=[day.slice(0,7),...(includeToday?[today.slice(0,7)]:[])];
 return Array.from(new Set(months)).map(month=>{
  const from=addDays(month+'-01',-7);
  return {from,to:addDays(from,70)};
 });
}

// Resolve template creation before presenting a completion decision.
export async function prepareCompletion(record:FamilyRecord,day:string,records:FamilyRecord[],saveTemplate:(record:FamilyRecord)=>Promise<FamilyRecord|false>,choice?:CompletionChoice,snapshot?:FamilyRecord[]){
 let action=completionAction(record,day,records,choice,snapshot);
 if(action.type==='create-template'){
  const template=await saveTemplate(action.record);
  if(!template)return null;
  record=template;
  records=[template,...records.filter(current=>current.id!==template.id)];
  action=completionAction(record,day,records,choice);
 }
 return {action,record,snapshot:structuredClone(records)};
}

// Plan editor writes without performing I/O or changing editor/record state.
export function editorSaveAction(r:FamilyRecord,editingDay:string,records:FamilyRecord[],choice?:CompletionChoice,snapshot?:FamilyRecord[]):CompletionAction{
 if(r.kind!=='task'||r.status!=='done')return {type:'save',record:r};
 const day=!r.id||r.date!==records.find(current=>current.id===r.id)?.date?r.date:editingDay;
 if(r.recurrence!=='none'&&(!r.id||(snapshot||records).find(current=>current.id===r.id)?.recurrence==='none')){
  if(r.id&&records.find(current=>current.id===r.id)?.revision!==r.revision)throw new Error('Esta tarea ha cambiado. Actualiza la página y vuelve a abrir la decisión.');
  if(choice==='keep')return {type:'keep'};
  if(!choice&&r.checklist.some(c=>!c.done)&&r.completionDecision!=='partial')return {type:'choose'};
  return {type:'save',record:{...r,status:'done',completeOn:day,completeChoice:choice,completionDecision:choice==='partial'||(!choice&&r.completionDecision==='partial')?'partial':undefined}};
 }
 return completionAction(r,day,records,choice,snapshot);
}

const attentionReasonOrder:AttentionReason[]=['incomplete','overdue','waiting','unconfirmed','unassigned'];
export function attentionReasonCopy(reasons:AttentionReason[]):string{
 const copy:Record<AttentionReason,string>={incomplete:'Marcada como hecha, pero todavía faltan pasos',overdue:'Pasó la fecha',waiting:'Falta una respuesta',unconfirmed:'Falta confirmar',unassigned:'Falta responsable'};
 return attentionReasonOrder.filter(reason=>reasons.includes(reason)).map((reason,index)=>index?copy[reason].toLocaleLowerCase('es'):copy[reason]).join(' · ');
}
export function attentionContext(r:FamilyRecord,today:string):string{
 const date=r.date===today?'Hoy':r.date===addDays(today,-1)?'Ayer':r.date===addDays(today,1)?'Mañana':new Intl.DateTimeFormat('es',{day:'numeric',month:'short',...(r.date.slice(0,4)!==today.slice(0,4)?{year:'numeric' as const}:{}),timeZone:'UTC'}).format(new Date(r.date+'T12:00:00Z'));
 return [r.owner.trim()||'Sin asignar',date,recordSource(r)].join(' · ');
}
export const attentionSummary=(count:number)=>count===0?'Todo al día':`${count} ${count===1?'asunto':'asuntos'} para revisar`;

const localOneOff=(r:FamilyRecord)=>!r.readOnly&&r.kind==='task'&&r.recurrence==='none';
export const canTriageOverdue=(r:FamilyRecord,reasons:AttentionReason[])=>localOneOff(r)&&reasons.includes('overdue');
export const attentionTomorrow=(today:string):TriageAction=>({type:'reschedule',date:addDays(today,1)});
type AttentionQuickAction={type:'complete'|'tomorrow'|'wait'|'reactivate'|'confirm'|'assign';label:string};
export function attentionQuickActions(r:FamilyRecord,reasons:AttentionReason[]):AttentionQuickAction[]{
 if(r.readOnly)return [];
 const actions:AttentionQuickAction[]=[];
 if(reasons.includes('incomplete'))actions.push({type:'complete',label:'Revisar pasos'});
 if(canTriageOverdue(r,reasons)){
  if(!reasons.includes('incomplete'))actions.push({type:'complete',label:'Hecha'});
  actions.push({type:'tomorrow',label:'Mañana'},r.status==='waiting'?{type:'reactivate',label:'Reactivar'}:{type:'wait',label:'Esperando'});
 }else if(localOneOff(r)&&reasons.includes('waiting'))actions.push({type:'reactivate',label:'Reactivar'});
 if(reasons.includes('unconfirmed'))actions.push({type:'confirm',label:'Confirmar'});
 if(reasons.includes('unassigned'))actions.push({type:'assign',label:'Asignar'});
 return actions.slice(0,3);
}
