export type Kind = 'task' | 'event' | 'meal';
export type FamilyRecord = { id: string; kind: Kind; revision: number; title: string; date: string; endDate?: string;
 time?: string; endTime?: string; owner: string; status: 'open'|'done'|'waiting'; category: string; notes: string;
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
 const event=records.find(record=>isCalendarDayBlock(record)&&safeCalendarColor(record.color));const color=safeCalendarColor(event?.color);if(!color)return undefined;
 const [r,g,b]=[color.slice(1,3),color.slice(3,5),color.slice(5,7)].map(value=>parseInt(value,16));return {backgroundColor:`rgba(${r}, ${g}, ${b}, 0.16)`,boxShadow:`inset 0 4px 0 ${color}`};
}
export function addDays(day: string, count: number) { const d = new Date(day+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+count); return d.toISOString().slice(0,10); }
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
 return {kind:raw.kind,title:text(raw.title,200),date:raw.date,endDate:raw.endDate||'',time:raw.time||'',endTime:raw.endTime||'',
 owner:text(raw.owner,60)||'Sin asignar',status:['open','done','waiting'].includes(raw.status)?raw.status:'open',category:text(raw.category,40)||'family',notes:text(raw.notes,5000),
 checklist:Array.isArray(raw.checklist)?raw.checklist.slice(0,40).map((c:any)=>({text:text(c.text,250),done:c.done===true})).filter((c:any)=>c.text):[],
 audience:raw.audience==='kids'?'kids':'adults',slot:raw.slot==='lunch'?'lunch':'dinner',recurrence:['daily','weekdays','weekly','yearly'].includes(raw.recurrence)?raw.recurrence:'none',
 source:text(raw.source,500)||'Familia',sourceKey:text(raw.sourceKey,250)||undefined,confirmed:raw.confirmed!==false,reminderDays:Math.max(0,Math.min(180,Number(raw.reminderDays)||0))};
}
export function reminderCandidates(records:FamilyRecord[],today:string) {
 return records.filter(r=>r.confirmed && r.status!=='done' && r.kind!=='meal' && !r.sourceKey?.startsWith('completion:') && !records.some(c=>c.sourceKey===`completion:${r.id}:${today}` && c.status==='done')).filter(r=>{
  if(r.kind==='task'&&r.recurrence==='none'&&r.date<=today)return true;
  for(let i=0;i<=r.reminderDays;i++)if(occursOn(r,addDays(today,i)))return true;
  return false;
 });
}
