export type PreviewAnswer={text:string;script:string|null};

const previewBlock=/```apalas-preview-js\s*\n([\s\S]*?)```/g;

export function parsePreviewAnswer(answer:string):PreviewAnswer{
 let script:string|null=null;
 const text=answer.replace(previewBlock,(_block,code:string)=>{script=code.trim();return '';}).replace(/\n{3,}/g,'\n\n').trim();
 return {text,script};
}

function serializedStyles(){
 return Array.from(document.styleSheets).map(sheet=>{
  try{return Array.from(sheet.cssRules).map(rule=>rule.cssText).join('\n');}catch{return '';}
 }).filter(Boolean).join('\n');
}

export function buildPreviewDocument(script:string){
 const clone=document.documentElement.cloneNode(true) as HTMLElement;
 clone.querySelectorAll('script,iframe,object,embed,link[rel="stylesheet"],.fc-launch').forEach(node=>node.remove());
 clone.querySelectorAll('*').forEach(node=>{
  for(const attribute of Array.from(node.attributes))if(attribute.name.toLowerCase().startsWith('on'))node.removeAttribute(attribute.name);
 });
 const body=clone.querySelector('body');
 body?.removeAttribute('data-scroll-locked');
 if(body){body.style.removeProperty('overflow');body.style.removeProperty('pointer-events');}
 const head=clone.querySelector('head');
 head?.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').forEach(node=>node.remove());
 const meta=document.createElement('meta');
 meta.setAttribute('http-equiv','Content-Security-Policy');
 meta.setAttribute('content',"default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; script-src 'unsafe-inline'");
 const style=document.createElement('style');style.textContent=serializedStyles();
 head?.prepend(meta,style);
 const runner=document.createElement('script');
 runner.textContent=`(()=>{try{${script.replace(/<\/script/gi,'<\\/script')}}catch(error){document.body.insertAdjacentHTML('afterbegin','<div style="position:fixed;inset:16px 16px auto;z-index:2147483647;padding:12px 16px;border-radius:10px;background:#fff0f0;color:#8a1f1f;font:14px system-ui">No se pudo aplicar esta vista previa.</div>')}})();`;
 body?.append(runner);
 return '<!doctype html>'+clone.outerHTML;
}
