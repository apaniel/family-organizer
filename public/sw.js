const CACHE_NAME='apalas-shell-v1';
const OFFLINE_URL='/offline.html';

self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.add(OFFLINE_URL)));
 self.skipWaiting();
});

self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const names=await caches.keys();
  await Promise.all(names.filter(name=>name!==CACHE_NAME).map(name=>caches.delete(name)));
  await self.clients.claim();
 })());
});

self.addEventListener('fetch',event=>{
 if(event.request.mode!=='navigate')return;
 event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));
});
