export type LocationAttention={ruleId:string;state:'arrived'|'nearby'|'unavailable'|'outside';observedAt:string;validUntil:string};
export type Person = 'Dani'|'Cris';
export type Place = {id:string;revision:number;name:string;latitude:number;longitude:number;radius:number;person:Person;timezone:string};
export type LocationLink = {id:string;revision:number;placeId:string;person:Person;target:{kind:'task'|'event';id:string;listId?:string};mode:'arrival'|'nearby';recurring:boolean;expires:string;enabled:boolean;confirmedAt?:string};
export function personForEmail(email:string):Person {if(['crislacorte@hotmail.com','lacorte.cristina@gmail.com'].includes(email))return 'Cris';if(['apavicio@gmail.com','dapamar90@gmail.com'].includes(email))return 'Dani';throw new Error('FORBIDDEN');}
export function validatePlace(raw:any):Omit<Place,'id'|'revision'> {
 if(typeof raw.name!=='string'||!raw.name.trim()||raw.name.length>100||!['Dani','Cris'].includes(raw.person))throw new Error('INVALID');
 for(const [key,min,max] of [['latitude',-90,90],['longitude',-180,180],['radius',50,3000]] as const)if(typeof raw[key]!=='number'||!Number.isFinite(raw[key])||raw[key]<min||raw[key]>max)throw new Error('INVALID');
 try{if(typeof raw.timezone!=='string')throw 0;new Intl.DateTimeFormat('en',{timeZone:raw.timezone});}catch{throw new Error('INVALID');}
 return {name:raw.name.trim(),latitude:raw.latitude,longitude:raw.longitude,radius:raw.radius,person:raw.person,timezone:raw.timezone};
}
export function validateLink(raw:any):Omit<LocationLink,'id'|'revision'|'confirmedAt'> {
 const t=raw.target;
 if(!t||!['task','event'].includes(t.kind)||typeof t.id!=='string'||!t.id||t.id.length>500||t.kind==='task'&&(typeof t.listId!=='string'||!t.listId||t.listId.length>300))throw new Error('INVALID');
 if(typeof raw.placeId!=='string'||raw.placeId.length>100||!['Dani','Cris'].includes(raw.person)||!['arrival','nearby'].includes(raw.mode)||typeof raw.recurring!=='boolean'||typeof raw.enabled!=='boolean')throw new Error('INVALID');
 if(typeof raw.expires!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(raw.expires)||!Number.isFinite(Date.parse(raw.expires))||new Date(raw.expires).toISOString().slice(0,10)!==raw.expires)throw new Error('INVALID');
 return {placeId:raw.placeId,person:raw.person,target:{kind:t.kind,id:t.id,...(t.kind==='task'?{listId:t.listId}:{})},mode:raw.mode,recurring:raw.recurring,expires:raw.expires,enabled:raw.enabled};
}
export function placeDate(timezone:string,instant=Date.now()){return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(instant);}
// Pure UI decisions: no location fix enters the browser. Cards describe consent and linkage.
export function locationCards(places:Place[],links:LocationLink[],records:{id:string;kind:string;title:string;status:string;googleTaskListId?:string}[],instant:number,attention:LocationAttention[]=[],now=instant){
 return links.flatMap(l=>{const p=places.find(p=>p.id===l.placeId);if(!p||l.expires<placeDate(p.timezone,instant))return [];const r=records.find(r=>r.id===l.target.id&&r.kind===l.target.kind&&(r.kind!=='task'||r.googleTaskListId===l.target.listId));return p&&r&&!['done','cancelled'].includes(r.status)?[{id:l.id,title:r.title,place:p.name,person:l.person,status:attentionLabel(l,attention,now)}]:[];});
}

function attentionLabel(link:LocationLink,attention:LocationAttention[],now:number){if(!link.enabled)return 'Aviso desactivado';const a=attention.find(a=>a.ruleId===link.id&&Date.parse(a.observedAt)<=now&&Date.parse(a.validUntil)>now);return a?{arrived:'Has llegado · pendiente',nearby:'Recado cercano · pendiente',outside:'Fuera del lugar',unavailable:'Ubicación no disponible'}[a.state]:'Ubicación reciente no disponible';}
