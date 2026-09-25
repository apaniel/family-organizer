export type Kind = 'task' | 'event' | 'meal';
export type FamilyRecord = { id: string; kind: Kind; revision: number; title: string; date: string; endDate?: string;
 time?: string; endTime?: string; owner: string; status: 'open'|'done'|'waiting'|'cancelled'; completionDecision?: 'all'|'partial'; completionParent?: {id:string;revision:number}; category: string; notes: string;
 checklist: {text:string;done:boolean}[]; audience: 'adults'|'kids'; slot:'lunch'|'dinner'; recurrence:'none'|'daily'|'weekdays'|'weekly'|'yearly';
 source: string; sourceKey?: string; confirmed: boolean; reminderDays: number; updatedAt?: string; readOnly?: boolean; color?: string; foregroundColor?: string; allDay?: boolean };
export function dateKey(date = new Date()) { return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid'}).format(date); }
const safeCalendarColor=(value:unknown)=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?value.toLowerCase():undefined;
export function calendarEventStyle(record:Pick<FamilyRecord,'color'|'foregroundColor'>) {
 const background=safeCalendarColor(record.color);if(!background)return undefined;
 const [r,g,b]=[background.slice(1,3),background.slice(3,5),background.slice(5,7)].map(x=>parseInt(x,16));const foreground=safeCalendarColor(record.foregroundColor)||((r*299+g*587+b*114)/1000>=150?'#1d1d1d':'#ffffff');
 return {backgroundColor:background,borderColor:background,color:foreground};
}
// A date-only entry is not necessarily a day-status block (for example an outing).
export function isCalendarDayBlock(record:FamilyRecord) {
 return record.allDay===true && (record.category==='holiday'||/\bJAF\b|jornades d.aprenentatge a fora|vacaciones?|vacances|festivo|festiu|libre\s+disposici[oó]n|lliure\s+disposici[oó]|sin\s+cole(?:gio)?|no\s+lectiv[oa]/i.test(record.title));
}
export function calendarTimeLabel(record:FamilyRecord) {
 if(isCalendarDayBlock(record))return 'Todo el día';
 if(record.time)return record.endTime?`${record.time}–${record.endTime}`:record.time;
 if(/cumplea[nñ]os|birthday|aniversari/i.test(record.title))return 'Todo el día';
 return 'Horario por confirmar';
}
export function calendarDayStyle(records:FamilyRecord[]) {
 const colors=records.filter(isCalendarDayBlock).map(record=>safeCalendarColor(record.color)||'#597bdc');
 if(!colors.length)return undefined;
 const tint=(color:string)=>{const [r,g,b]=[color.slice(1,3),color.slice(3,5),color.slice(5,7)].map(value=>parseInt(value,16));return `rgba(${r}, ${g}, ${b}, 0.16)`;};
 if(colors.length===1)return {backgroundColor:tint(colors[0]),boxShadow:`inset 0 4px 0 ${colors[0]}`};
 // Keep a band per event, including when two events share a color.
 const stops=colors.flatMap((color,i)=>{
  const start=i*100/colors.length,end=(i+1)*100/colors.length;
  return [`${tint(color)} ${start}%`,`${tint(color)} ${i===colors.length-1?`${end}%`:`calc(${end}% - 1px)`}`,...(i===colors.length-1?[]:[`#fff calc(${end}% - 1px)`,`#fff ${end}%`])];
 });
 const topStops=colors.flatMap((color,i)=>{const start=i*100/colors.length,end=(i+1)*100/colors.length;return [`${color} ${start}%`,`${color} ${i===colors.length-1?`${end}%`:`calc(${end}% - 1px)`}`,...(i===colors.length-1?[]:[`#fff calc(${end}% - 1px)`,`#fff ${end}%`])];});
 return {backgroundImage:`linear-gradient(to right, ${topStops.join(', ')}), linear-gradient(to right, ${stops.join(', ')})`,backgroundSize:'100% 4px, 100% 100%',backgroundPosition:'top left, top left',backgroundRepeat:'no-repeat'};
}
export function addDays(day: string, count: number) { const d = new Date(day+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+count); return d.toISOString().slice(0,10); }
export function taskAgeLabel(taskDate:string,today:string) {
 const days=Math.floor((Date.parse(today+'T00:00:00Z')-Date.parse(taskDate+'T00:00:00Z'))/86400000);
 if(days<=0)return '';
 return days===1?'Desde ayer':`Desde hace ${days} días`;
}
export function occursOn(r: FamilyRecord, day: string) {
 if (day < r.date) return false;
 if (r.recurrence === 'daily') return true;
 if (r.recurrence === 'weekdays') return ![0,6].includes(new Date(day+'T12:00:00Z').getUTCDay());
 if (r.recurrence === 'weekly') return new Date(day+'T12:00:00Z').getUTCDay() === new Date(r.date+'T12:00:00Z').getUTCDay();
 if (r.recurrence === 'yearly') return r.date.slice(5) === day.slice(5);
 return r.kind === 'event' && r.endDate ? day >= r.date && day <= r.endDate : r.date === day;
}
export function validateRecord(raw: any): Omit<FamilyRecord,'id'|'revision'> {
 const text=(x:unknown,max:number)=>typeof x==='string'?x.trim().slice(0,max):'';
 const validDate=(v:any)=>typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) && new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
 if (!['task','event','meal'].includes(raw.kind)) throw new Error('Tipo no válido.');
 if (!text(raw.title,200)) throw new Error('Añade un título.');
 if (!validDate(raw.date)) throw new Error('Indica una fecha válida.');
 if(raw.endDate && (!validDate(raw.endDate)||raw.endDate<raw.date)) throw new Error('Revisa la fecha final.');
 if(raw.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time)) throw new Error('Revisa la hora.');
 if(raw.endTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.endTime)) throw new Error('Revisa la hora final.');
 if(raw.kind==='meal' && raw.status==='done') throw new Error('Los menús no tienen estado completado.');
 if(raw.completionDecision!==undefined && !['all','partial'].includes(raw.completionDecision))throw new Error('Decisión de finalización no válida.');
 // Optional for historical records; new occurrence inserts require this in the store.
 let completionParent:FamilyRecord['completionParent'];
 if(raw.completionParent!==undefined){
  const parent=raw.completionParent;
  const key=typeof raw.sourceKey==='string'?/^completion:(.+):(\d{4}-\d{2}-\d{2})$/.exec(raw.sourceKey):null;
  if(!parent||typeof parent.id!=='string'||!parent.id||!Number.isSafeInteger(parent.revision)||parent.revision<1||raw.kind!=='task'||raw.recurrence!=='none'||!key||key[1]!==parent.id||!validDate(key[2]))
   throw new Error('Referencia de tarea recurrente no válida.');
  completionParent={id:parent.id,revision:parent.revision};
 }
 const checklist=Array.isArray(raw.checklist)?raw.checklist.slice(0,40).map((c:any)=>({text:text(c.text,250),done:c.done===true})).filter((c:any)=>c.text):[];
 if(raw.kind==='task'&&raw.status==='done'&&raw.completionDecision==='all'&&checklist.some((c:{done:boolean})=>!c.done))throw new Error('Completa toda la lista o elige un cierre parcial.');
 return {completionParent,completionDecision:raw.kind==='task'&&raw.status==='done'?raw.completionDecision:undefined,kind:raw.kind,title:text(raw.title,200),date:raw.date,endDate:raw.endDate||'',time:raw.time||'',endTime:raw.endTime||'',
 owner:text(raw.owner,60)||'Sin asignar',status:['open','done','waiting','cancelled'].includes(raw.status)?raw.status:'open',category:text(raw.category,40)||'family',notes:text(raw.notes,5000),
 checklist,
 audience:raw.audience==='kids'?'kids':'adults',slot:raw.slot==='lunch'?'lunch':'dinner',recurrence:['daily','weekdays','weekly','yearly'].includes(raw.recurrence)?raw.recurrence:'none',
 source:text(raw.source,500)||'Familia',sourceKey:text(raw.sourceKey,250)||undefined,confirmed:raw.confirmed!==false,reminderDays:Math.max(0,Math.min(180,Number(raw.reminderDays)||0))};
}
// Past open occurrences carry unfinished work separately from today's series row.
export const isPastOpenOccurrence=(r:FamilyRecord,today:string)=>!!r.sourceKey?.startsWith('completion:')&&r.kind==='task'&&r.recurrence==='none'&&(r.status==='open'||r.status==='waiting')&&r.date<today;
export function reminderCandidates(records:FamilyRecord[],today:string) {
 return records.filter(r=>r.confirmed && r.status!=='cancelled' && r.status!=='done' && r.kind!=='meal' && !records.some(c=>c.sourceKey===`completion:${r.id}:${today}` && (c.date===today||c.status==='done'||c.status==='cancelled'))).filter(r=>{
  if(r.kind==='task'&&r.recurrence==='none'&&r.date<=today)return true;
  for(let i=0;i<=r.reminderDays;i++)if(occursOn(r,addDays(today,i)))return true;
  return false;
 });
}
