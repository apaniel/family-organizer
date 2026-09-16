import 'server-only';
import ICAL from 'ical.js';
import {validateGoogleCalendarFeed} from '@/lib/google-calendar/sync';
import {dateKey,addDays,type FamilyRecord} from './model';
export function expandGoogleCalendar(ics:string,from:string,to:string):FamilyRecord[]{
 const root=new ICAL.Component(ICAL.parse(ics));
 for(const zone of root.getAllSubcomponents('vtimezone')){const id=zone.getFirstPropertyValue('tzid');if(id)ICAL.TimezoneService.register(new ICAL.Timezone({component:zone,tzid:String(id)}));}
 const all=root.getAllSubcomponents('vevent').map(c=>new ICAL.Event(c));const result:FamilyRecord[]=[];
 const start=new Date(addDays(from,-1)+'T00:00:00Z');const end=new Date(addDays(to,2)+'T00:00:00Z');
 for(const event of all.filter(e=>!e.recurrenceId)){
  const overrides=all.filter(e=>e.uid===event.uid&&e.recurrenceId);for(const override of overrides)event.relateException(override);
  const add=(item:any,occStart:any,occEnd:any,key:string)=>{
   if(String(item.component.getFirstPropertyValue('status')).toUpperCase()==='CANCELLED')return;
   const a=occStart.toJSDate(),b=occEnd.toJSDate();if(b<start||a>=end)return;
   const allDay=occStart.isDate;const date=allDay?occStart.toString().slice(0,10):dateKey(a);
   const last=allDay?addDays(occEnd.toString().slice(0,10),-1):dateKey(new Date(Math.max(a.getTime(),b.getTime()-1)));
   if(date>to || last<from)return;
   result.push({id:'google:'+event.uid+':'+key,revision:0,kind:'event',title:item.summary||'Sin título',date,endDate:last<date?date:last,
    time:allDay?'':new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit',hour12:false}).format(a),
    owner:'Familia',status:'open',category:'family',notes:item.description||'',checklist:[],audience:'adults',slot:'dinner',recurrence:'none',source:'Google Calendar · losapalas@gmail.com',confirmed:true,reminderDays:1,readOnly:true});
  };
  if(!event.isRecurring()){add(event,event.startDate,event.endDate,'single');continue;}
  const iterator=event.iterator();let occurrence;let count=0;
  while((occurrence=iterator.next())&&count++<20000){if(occurrence.toJSDate()>end)break;const detail=event.getOccurrenceDetails(occurrence);add(detail.item,detail.startDate,detail.endDate,occurrence.toString());}
  if(count>=20000)throw new Error('Calendar recurrence limit reached');
 }
 return result.sort((a,b)=>(a.date+(a.time||'')).localeCompare(b.date+(b.time||'')));
}
export async function googleEvents(from:string,to:string){
 const url=validateGoogleCalendarFeed(process.env.GOOGLE_CALENDAR_ICS_URL||'');
 const r=await fetch(url,{redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw new Error('Google Calendar unavailable');
 return expandGoogleCalendar(await r.text(),from,to);
}
