// NoPrecinho service worker: serves cached files first, refreshes them in the background.
const C="noprecinho-v1";
self.addEventListener("install",e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(["./"])).then(()=>self.skipWaiting()));});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(hit=>{
    const net=fetch(e.request).then(r=>{if(r&&r.ok){const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));}return r;}).catch(()=>hit||caches.match("./"));
    return hit||net;
  }));
});
