export const DASHBOARD_REFRESH='apalas:refresh';
let pending=false,lastRefresh=0;
export function chatIsPending(){return pending;}
export function refreshDashboard(){if(typeof window!=='undefined')window.dispatchEvent(new Event(DASHBOARD_REFRESH));}
export function changedChat(previous:{id:string;status:string}[],next:{id:string;status:string}[]){return next.some(m=>m.status!=='pending'&&previous.some(p=>p.id===m.id&&p.status==='pending'));}
export function updateChatProgress(previous:{id:string;status:string}[],next:{id:string;status:string}[]){pending=next.some(m=>m.status==='pending');if(changedChat(previous,next)||(pending&&Date.now()-lastRefresh>15000)){lastRefresh=Date.now();refreshDashboard();}}
// Hidden tabs keep firing timers; DashboardLive refreshes a tab as soon as it is visible again.
export function everyVisible(callback:()=>void,ms:number,visible=()=>document.visibilityState==='visible'){const id=setInterval(()=>{if(visible())callback();},ms);return()=>clearInterval(id);}
let lastReturn=-Infinity;
// A tab switch fires both focus and visibilitychange; reload the dashboard once.
export function refreshOnReturn(now=Date.now()){if(now-lastReturn<2000)return false;lastReturn=now;refreshDashboard();return true;}
