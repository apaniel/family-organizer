'use client';

import {useEffect,useState} from 'react';
import './install-app-prompt.css';

type InstallChoice={outcome:'accepted'|'dismissed';platform:string};
type BeforeInstallPromptEvent=Event&{
 prompt:()=>Promise<void>;
 userChoice:Promise<InstallChoice>;
};

const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone);
const isIos=()=>/iphone|ipad|ipod/i.test(navigator.userAgent);

export default function InstallAppPrompt(){
 const [prompt,setPrompt]=useState<BeforeInstallPromptEvent|null>(null);
 const [ios,setIos]=useState(false);
 const [showIosHelp,setShowIosHelp]=useState(false);
 const [dismissed,setDismissed]=useState(false);

 useEffect(()=>{
  if('serviceWorker' in navigator)void navigator.serviceWorker.register('/sw.js');
  if(isStandalone()||sessionStorage.getItem('apalas-install-dismissed')==='1')return;
  setIos(isIos());
  const beforeInstall=(event:Event)=>{
   event.preventDefault();
   setPrompt(event as BeforeInstallPromptEvent);
  };
  const installed=()=>{setPrompt(null);setIos(false);};
  window.addEventListener('beforeinstallprompt',beforeInstall);
  window.addEventListener('appinstalled',installed);
  return()=>{
   window.removeEventListener('beforeinstallprompt',beforeInstall);
   window.removeEventListener('appinstalled',installed);
  };
 },[]);

 async function install(){
  if(!prompt){setShowIosHelp(true);return;}
  await prompt.prompt();
  const choice=await prompt.userChoice;
  if(choice.outcome==='accepted')setPrompt(null);
 }
 function close(){
  sessionStorage.setItem('apalas-install-dismissed','1');
  setDismissed(true);
 }
 if(dismissed||(!prompt&&!ios))return null;

 return <aside className="pwa-install" aria-label="Instalar Apalas">
  <div className="pwa-install-icon" aria-hidden="true">A</div>
  <div className="pwa-install-copy">
   <strong>Instala Apalas</strong>
   <span>{showIosHelp?'Pulsa Compartir y después «Añadir a pantalla de inicio».':'Ábrelo como una app y ten el dashboard siempre a mano.'}</span>
  </div>
  <button className="pwa-install-cta" type="button" onClick={()=>void install()}><i aria-hidden="true">✦</i>{ios?'Ver cómo':'Instalar'}<i aria-hidden="true">✧</i></button>
  <button className="pwa-install-close" type="button" aria-label="Cerrar aviso de instalación" onClick={close}>×</button>
 </aside>;
}
