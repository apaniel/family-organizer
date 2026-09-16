// Retire the old organizer's offline cache and worker.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 await Promise.all((await caches.keys()).map(key=>caches.delete(key)));
 await self.clients.claim();
 await self.registration.unregister();
})()));
