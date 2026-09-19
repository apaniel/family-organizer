export type PreviewAnswer={text:string;script:string|null};
type LivePreview={id:string;script:string;cleanup:()=>void;minimized:boolean};
declare global{interface Window{__APALAS_LIVE_PREVIEW__?:LivePreview}}

const previewBlock=/```apalas-preview-js\s*\n([\s\S]*?)```/g;
const forbidden=/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB|cookie|location|history|navigator|Worker|SharedWorker|eval|Function|import|setTimeout|setInterval|requestAnimationFrame)\b|<\/?(?:script|iframe|object|embed|form)\b/i;

export function parsePreviewAnswer(answer:string):PreviewAnswer{
 let script:string|null=null;
 const text=answer.replace(previewBlock,(_block,code:string)=>{script=code.trim();return '';}).replace(/\n{3,}/g,'\n\n').trim();
 return {text,script};
}

function validate(script:string){if(!script.trim()||script.length>20000||forbidden.test(script))throw new Error('Vista previa no segura');}

function execute(script:string){
 validate(script);
 const mutations:MutationRecord[]=[];
 const observer=new MutationObserver(records=>mutations.push(...records));
 observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeOldValue:true,characterData:true,characterDataOldValue:true});
 try{new Function('document','window','"use strict";\n'+script)(document,window);mutations.push(...observer.takeRecords());observer.disconnect();}catch(error){observer.disconnect();throw error;}
 return ()=>{
  for(const mutation of mutations.reverse()){
   if(mutation.type==='attributes'&&mutation.target instanceof Element&&mutation.attributeName){if(mutation.oldValue===null)mutation.target.removeAttribute(mutation.attributeName);else mutation.target.setAttribute(mutation.attributeName,mutation.oldValue);}
   else if(mutation.type==='characterData')mutation.target.nodeValue=mutation.oldValue;
   else if(mutation.type==='childList'){
    Array.from(mutation.addedNodes).reverse().forEach(node=>{if(node.parentNode)node.parentNode.removeChild(node);});
    Array.from(mutation.removedNodes).forEach(node=>{const target=mutation.target;if(mutation.nextSibling&&mutation.nextSibling.parentNode===target)target.insertBefore(node,mutation.nextSibling);else target.appendChild(node);});
   }
  }
 };
}

export function startDashboardPreview(id:string,script:string){
 if(typeof window==='undefined')return;
 window.__APALAS_LIVE_PREVIEW__?.cleanup();
 window.__APALAS_LIVE_PREVIEW__={id,script,cleanup:execute(script),minimized:false};
}

export function reapplyDashboardPreview(){
 if(typeof window==='undefined'||!window.__APALAS_LIVE_PREVIEW__)return null;
 const {id,script,cleanup,minimized}=window.__APALAS_LIVE_PREVIEW__;cleanup();
 window.__APALAS_LIVE_PREVIEW__={id,script,cleanup:execute(script),minimized};
 return {id,script,minimized};
}

export function activeDashboardPreview(){if(typeof window==='undefined')return null;const value=window.__APALAS_LIVE_PREVIEW__;return value?{id:value.id,script:value.script,minimized:value.minimized}:null;}

export function setDashboardPreviewMinimized(minimized:boolean){if(typeof window==='undefined'||!window.__APALAS_LIVE_PREVIEW__)return;window.__APALAS_LIVE_PREVIEW__.minimized=minimized;}

export function discardDashboardPreview(){if(typeof window==='undefined')return;window.__APALAS_LIVE_PREVIEW__?.cleanup();delete window.__APALAS_LIVE_PREVIEW__;}
