const CACHE='localwebai-shell-v3';
const SHELL=[
  './','./index.html','./styles.css','./js/app.js','./js/config.js','./js/storage.js','./js/readiness.js','./js/benchmark.js','./js/data.js','./workers/cpu.worker.js',
  './assets/favicon.svg','./assets/favicon-32x32.png','./assets/icon-192.png','./manifest.webmanifest',
  './data/data-manifest.json','./data/localwebai-complete.json','./data/project.json','./data/kernel-catalog.json','./data/kernel-catalog.csv','./data/benchmark-presets.json','./data/readiness-rubric.json','./data/reference-benchmarks.json','./data/compatibility.json','./data/hardware-profiles.json','./data/roadmap.json','./data/faq.json','./data/sources.json','./data/schemas/benchmark-result.schema.json','./data/schemas/kernel-catalog.schema.json'
];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url); if(url.origin!==location.origin) return;
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{
    if(event.request.method==='GET'&&response.ok){const copy=response.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));}
    return response;
  }).catch(()=>event.request.mode==='navigate'?caches.match('./index.html'):Response.error())));
});
