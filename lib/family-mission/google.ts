import 'server-only';
import ICAL from 'ical.js';
import {validateGoogleCalendarFeed} from './feed';
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
    owner:'Familia',status:'open',category:/vacaciones?|libre\s+disposici[oó]n/i.test(item.summary||'')?'holiday':'family',notes:item.description||'',checklist:[],audience:'adults',slot:'dinner',recurrence:'none',source:'Google Calendar · losapalas@gmail.com',confirmed:true,reminderDays:1,readOnly:true,allDay});
  };
  if(!event.isRecurring()){add(event,event.startDate,event.endDate,'single');continue;}
  const iterator=event.iterator();let occurrence;let count=0;
  while((occurrence=iterator.next())&&count++<20000){if(occurrence.toJSDate()>end)break;const detail=event.getOccurrenceDetails(occurrence);add(detail.item,detail.startDate,detail.endDate,occurrence.toString());}
  if(count>=20000)throw new Error('Calendar recurrence limit reached');
 }
 return result.sort((a,b)=>(a.date+(a.time||'')).localeCompare(b.date+(b.time||'')));
}
type GoogleColor={background?:string;foreground?:string};
type GooglePalette={event?:Record<string,GoogleColor>};
type GoogleCalendarAppearance={backgroundColor?:string;foregroundColor?:string};
type GoogleEventLabel={id?:string;backgroundColor?:string};
const safeColor=(value:unknown)=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?value.toLowerCase():undefined;
const readableForeground=(background:string)=>{const [r,g,b]=[background.slice(1,3),background.slice(3,5),background.slice(5,7)].map(x=>parseInt(x,16));return (r*299+g*587+b*114)/1000>=150?'#1d1d1d':'#ffffff';};
export function expandGoogleApiEvents(items:any[],from:string,to:string,palette:GooglePalette={},calendar:GoogleCalendarAppearance={},labels:GoogleEventLabel[]=[]):FamilyRecord[]{
 const labelColors=new Map(labels.map(label=>[label.id,safeColor(label.backgroundColor)]));
 const defaultBackground=safeColor(calendar.backgroundColor);const defaultForeground=safeColor(calendar.foregroundColor);
 const result:FamilyRecord[]=[];
 for(const item of items){
  if(item?.status==='cancelled'||!item?.start||!item?.end)continue;
  const allDay=typeof item.start.date==='string';const a=allDay?null:new Date(item.start.dateTime);const b=allDay?null:new Date(item.end.dateTime);
  if(!allDay&&(!a||!b||!Number.isFinite(a.getTime())||!Number.isFinite(b.getTime())))continue;
  const date=allDay?item.start.date:dateKey(a!);const last=allDay?addDays(item.end.date,-1):dateKey(new Date(Math.max(a!.getTime(),b!.getTime()-1)));
  if(date>to||last<from)continue;
  const labelBackground=labelColors.get(item.eventLabelId);const legacy=palette.event?.[item.colorId];
  const color=labelBackground||safeColor(legacy?.background)||defaultBackground;
  const foreground=labelBackground?readableForeground(labelBackground):safeColor(legacy?.foreground)||defaultForeground||(color?readableForeground(color):undefined);
  result.push({id:`google:${item.id}:${item.originalStartTime?.dateTime||item.originalStartTime?.date||item.start.dateTime||item.start.date}`,revision:0,kind:'event',title:item.summary||'Sin título',date,endDate:last<date?date:last,
   time:allDay?'':new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit',hour12:false}).format(a!),
   owner:'Familia',status:'open',category:/vacaciones?|libre\s+disposici[oó]n/i.test(item.summary||'')?'holiday':'family',notes:item.description||'',checklist:[],audience:'adults',slot:'dinner',recurrence:'none',source:'Google Calendar · losapalas@gmail.com',confirmed:true,reminderDays:1,readOnly:true,color,foregroundColor:foreground,allDay});
 }
 return result.sort((a,b)=>(a.date+(a.time||'')).localeCompare(b.date+(b.time||'')));
}
export async function googleApiEvents(from:string,to:string){
 const clientId=process.env.GOOGLE_CALENDAR_CLIENT_ID||'',clientSecret=process.env.GOOGLE_CALENDAR_CLIENT_SECRET||'',refreshToken=process.env.GOOGLE_CALENDAR_REFRESH_TOKEN||'';
 if(!clientId||!clientSecret||!refreshToken)throw new Error('Google Calendar API credentials are incomplete');
 const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'}),cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!tokenResponse.ok)throw new Error('Google Calendar authorization failed');
 const token=await tokenResponse.json() as {access_token?:string};if(!token.access_token)throw new Error('Google Calendar authorization failed');
 const api=async(path:string)=>{const response=await fetch('https://www.googleapis.com/calendar/v3'+path,{headers:{Authorization:`Bearer ${token.access_token}`},cache:'no-store',signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('Google Calendar API unavailable');return response.json() as Promise<any>;};
 const calendarId=encodeURIComponent('losapalas@gmail.com');
 const [palette,calendarAppearance,calendarMetadata]=await Promise.all([api('/colors'),api('/users/me/calendarList/'+calendarId),api('/calendars/'+calendarId)]);
 const items:any[]=[];let pageToken='';
 do{const query=new URLSearchParams({singleEvents:'true',showDeleted:'false',orderBy:'startTime',maxResults:'2500',timeMin:addDays(from,-1)+'T00:00:00Z',timeMax:addDays(to,2)+'T00:00:00Z'});if(pageToken)query.set('pageToken',pageToken);
  const page=await api('/calendars/'+calendarId+'/events?'+query);items.push(...(Array.isArray(page.items)?page.items:[]));pageToken=typeof page.nextPageToken==='string'?page.nextPageToken:'';
 }while(pageToken);
 return expandGoogleApiEvents(items,from,to,palette,calendarAppearance,calendarMetadata?.labelProperties?.eventLabels||[]);
}
export async function googleEvents(from:string,to:string){
 const apiConfigured=!!(process.env.GOOGLE_CALENDAR_CLIENT_ID&&process.env.GOOGLE_CALENDAR_CLIENT_SECRET&&process.env.GOOGLE_CALENDAR_REFRESH_TOKEN);
 if(apiConfigured){try{return await googleApiEvents(from,to);}catch(error){if(!process.env.GOOGLE_CALENDAR_ICS_URL)throw error;}}
 const url=validateGoogleCalendarFeed(process.env.GOOGLE_CALENDAR_ICS_URL||'');
 const r=await fetch(url,{redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw new Error('Google Calendar unavailable');
 return expandGoogleCalendar(await r.text(),from,to);
}
