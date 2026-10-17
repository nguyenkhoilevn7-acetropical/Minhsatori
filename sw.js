// Retire legacy cached app shells. No cached files or invoice data are deleted.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 await self.clients.claim();
 await self.registration.unregister();
})()));
