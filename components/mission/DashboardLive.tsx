'use client';
import {useEffect,useRef} from 'react';
import {chatIsPending,refreshDashboard} from './dashboard-refresh';
export default function DashboardLive({editing}:{editing:boolean}){
 const editingRef=useRef(editing);editingRef.current=editing;
 useEffect(()=>{let active=true,version:string|undefined,checking=false;
 async function check(){if(checking||document.visibilityState!=='visible')return;checking=true;try{const r=await fetch('/api/health',{cache:'no-store'});if(!r.ok)return;const d=await r.json();if(!active||typeof d.version!=='string'||!d.version)return;if(!version){version=d.version;return;}if(version!==d.version&&!editingRef.current&&!chatIsPending()&&!(document.activeElement?.matches('input,textarea,[contenteditable="true"]')&&((document.activeElement as HTMLInputElement).value||document.activeElement.textContent||'').trim())){window.location.reload();}}catch{}finally{checking=false;}}
 const focus=()=>{if(document.visibilityState==='visible'){refreshDashboard();void check();}};
 void check();const timer=setInterval(()=>void check(),15000);document.addEventListener('visibilitychange',focus);window.addEventListener('focus',focus);
 return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',focus);window.removeEventListener('focus',focus);};},[]);
 return null;
}
