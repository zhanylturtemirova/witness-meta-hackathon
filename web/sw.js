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
// Optional Web Push. The caching above is untouched: push events never read
// or write the offline shell, and notification URLs are validated against
// the same strict same-origin intent list as the app (see web/push.js,
// PUSH_URL_RE). Anything malformed is dropped, never shown.
const PUSH_SEEN_IDS=[];
function pushValidPayload(raw){
 if(!raw||typeof raw!=='object')return null;
 if(raw.kind!=='phrase'&&raw.kind!=='question')return null;
 if(typeof raw.id!=='string'||!/^\d{4}-\d{2}-\d{2}:(phrase|question)$/.test(raw.id))return null;
 if(typeof raw.title!=='string'||!raw.title.trim()||raw.title.length>120)return null;
 if(typeof raw.body!=='string'||!raw.body.trim()||raw.body.length>300)return null;
 if(typeof raw.url!=='string'||!/^(\.\/)?\?push=(saved|prompt)(&promptId=[A-Za-z0-9_-]{1,64})?$/.test(raw.url))return null;
 return {id:raw.id,kind:raw.kind,title:String(raw.title).slice(0,120),body:String(raw.body).slice(0,300),url:raw.url};
}
self.addEventListener('push',event=>{
 event.waitUntil((async()=>{
  let raw=null;
  try{raw=event.data?event.data.json():null;}catch{raw=null;}
  const payload=pushValidPayload(raw);
  if(!payload)return;
  if(PUSH_SEEN_IDS.includes(payload.id))return;
  PUSH_SEEN_IDS.push(payload.id);
  if(PUSH_SEEN_IDS.length>20)PUSH_SEEN_IDS.shift();
  const target=new URL(payload.url,base).href;
  await self.registration.showNotification(payload.title,{body:payload.body,tag:payload.id,data:{url:target},renotify:false});
 })());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  // The stored target is same-origin only (see the push handler above), but
  // it is re-validated here: only a recognised saved/prompt intent proceeds.
  // An open app window is NEVER navigated — navigating would discard an
  // in-progress recording or unsent text. It is focused and handed the
  // validated intent; the app decides, through the same parsed-safe intent
  // handler, whether to act now or to offer a pending action button the
  // person can choose after finishing the recording. A new window may open
  // the safe URL directly, since nothing can be discarded there.
  const rawUrl=event.notification?.data?.url;
  let intent=null,safe=null;
  try{
   const u=new URL(String(rawUrl||''),base);
   if(u.origin===base.origin&&(u.pathname===base.pathname||u.pathname===new URL('index.html',base).pathname)){
    const kind=u.searchParams.get('push');
    const promptId=u.searchParams.get('promptId');
    const keys=[...u.searchParams.keys()];
    if(kind==='saved'&&keys.every(k=>k==='push')){intent={kind:'saved'};safe=u.href;}
    else if(kind==='prompt'&&keys.every(k=>k==='push'||k==='promptId')){
     if(promptId&&/^[A-Za-z0-9_-]{1,64}$/.test(promptId)){intent={kind:'prompt',promptId};safe=`${u.origin}${u.pathname}?push=prompt&promptId=${promptId}`;}
     else{intent={kind:'prompt',promptId:null};safe=`${u.origin}${u.pathname}?push=prompt`;}
    }
   }
  }catch{intent=null;safe=null;}
  if(!intent||!safe)return;
  const message=intent.promptId
   ?{type:'WITNESS_PUSH',kind:intent.kind,promptId:intent.promptId}
   :{type:'WITNESS_PUSH',kind:intent.kind};
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of windows){
   try{
    const cu=new URL(client.url);
    if(cu.origin!==base.origin)continue;
    if('focus' in client)await client.focus();
    client.postMessage(message);
    return;
   }catch{/* try the next window */}
  }
  await self.clients.openWindow(safe);
 })());
});
