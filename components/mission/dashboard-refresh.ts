export const DASHBOARD_REFRESH='apalas:refresh';
let pending=false,lastRefresh=0;
export function chatIsPending(){return pending;}
export function refreshDashboard(){if(typeof window!=='undefined')window.dispatchEvent(new Event(DASHBOARD_REFRESH));}
export function changedChat(previous:{id:string;status:string}[],next:{id:string;status:string}[]){return next.some(m=>m.status!=='pending'&&previous.some(p=>p.id===m.id&&p.status==='pending'));}
export function updateChatProgress(previous:{id:string;status:string}[],next:{id:string;status:string}[]){pending=next.some(m=>m.status==='pending');if(changedChat(previous,next)||(pending&&Date.now()-lastRefresh>15000)){lastRefresh=Date.now();refreshDashboard();}}
