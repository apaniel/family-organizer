import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');

describe('Apalas PWA',()=>{
 it('publishes an installable Apalas manifest from the dashboard root',()=>{
  const manifest=JSON.parse(read('../../public/manifest.json'));
  expect(manifest).toMatchObject({
   name:'Apalas · En familia',
   short_name:'Apalas',
   start_url:'/',
   scope:'/',
   display:'standalone',
  });
  expect(manifest.icons).toEqual(expect.arrayContaining([
   expect.objectContaining({src:'/icon-192x192.png',sizes:'192x192'}),
   expect.objectContaining({src:'/icon-512x512.png',sizes:'512x512'}),
  ]));
 });

 it('registers a persistent service worker with a safe offline navigation fallback',()=>{
  const worker=read('../../public/sw.js');
  expect(worker).toContain("const CACHE_NAME='apalas-shell-v1'");
  expect(worker).toContain("event.request.mode!=='navigate'");
  expect(worker).toContain("caches.match('/offline.html')");
  expect(worker).not.toContain('registration.unregister()');
 });

 it('mounts an accessible install notification with the approved fuchsia glitter CTA',()=>{
  const layout=read('../../app/layout.tsx');
  const component=read('../../components/mission/InstallAppPrompt.tsx');
  const styles=read('../../components/mission/install-app-prompt.css');
  expect(layout).toContain('<InstallAppPrompt/>');
  expect(layout).toContain("manifest:'/manifest.json'");
  expect(component).toContain("window.addEventListener('beforeinstallprompt'");
  expect(component).toContain("navigator.serviceWorker.register('/sw.js')");
  expect(component).toContain('Instala Apalas');
  expect(component).toContain('aria-label="Cerrar aviso de instalación"');
  expect(component).toContain('prompt.prompt()');
  expect(styles).toContain('background:#ec168c');
  expect(styles).toContain('radial-gradient');
 });
});
