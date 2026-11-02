/* Build replaces this marker with a content-hashed static app shell. */
const BUILD = /* WITNESS_BUILD */ {version:'development',files:[]};
const PREFIX='witness-shell-',CACHE=PREFIX+BUILD.version;
const base=new URL('./',self.location.href);
const assetURLs=new Set(BUILD.files.map(file=>new URL(file,base).href));
const earthURLs=new Set(['assets/earth/earth-day.jpg','assets/earth/earth-night.jpg'].map(file=>new URL(file,base).href));
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll([...assetURLs])));
 // An update waits until the person chooses to reload; never interrupt a recording.
});
self.addEventListener('message',event=>{if(event.data?.type==='WITNESS_ACTIVATE')self.skipWaiting();});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith(PREFIX)&&key!==CACHE)await caches.delete(key);
  await self.clients.claim();
 })());
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 // Only exact public app files are eligible. No API, private media, arbitrary
 // uploads, signed URLs, query strings, external requests or POST responses.
 if(request.method!=='GET'||url.origin!==base.origin||url.search)return;
 if(request.mode==='navigate'){
  if(url.pathname!==base.pathname&&url.pathname!==new URL('index.html',base).pathname)return;
  event.respondWith((async()=>{
   const response=await (await caches.open(CACHE)).match(new URL('index.html',base).href);
   return response||fetch(request);
  })());return;
 }
 if(!assetURLs.has(url.href)&&!earthURLs.has(url.href))return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE),cached=await cache.match(request);
  if(cached)return cached;
  const response=await fetch(request);
  if(response.ok&&response.type==='basic')await cache.put(request,response.clone());
  return response;
 })());
});
