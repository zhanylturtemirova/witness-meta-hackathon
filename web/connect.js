import {MY_EVENTS,matchesFor,projectGlobe} from './connect-data.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let cleanup=()=>{};
export function unmountConnect(){cleanup();cleanup=()=>{};}
// Visible quote slots for the search-in-progress cycle: none without
// excerpts, one for a lone excerpt, otherwise two on desktop and one on
// mobile. Pure so the rule stays testable without a DOM.
export function slotsForQuotes(excerptCount, isMobile) {
  if (!Number.isInteger(excerptCount) || excerptCount < 1) return 0;
  if (excerptCount < 2) return 1;
  return isMobile ? 1 : 2;
}
// Short display quote for the letter cycle (~140 chars, ellipsis for the
// visual duplicate; the full story stays in the list below). Pure.
export function trimQuoteText(text, max = 140) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t || t.length <= max) return t;
  return t.slice(0, max).trimEnd() + '…';
}
// Displayed matches mapped to letter-cycle quotes. Only public excerpt
// fields are used; coordinates pass through untouched (never invented) so
// far-side gating keeps working; stories without excerpt text are skipped.
export function quotesFromStories(stories, max = 140) {
  if (!Array.isArray(stories)) return [];
  const out = [];
  for (const s of stories) {
    if (!s) continue;
    const text = trimQuoteText(s.excerpt || s.text || s.story, max);
    if (!text) continue;
    out.push({ text, name: s.name, title: s.title, city: s.city || s.place, lon: s.lon, lat: s.lat, id: s.id });
  }
  return out;
}
// Visibility gating for the search-in-progress cycle, pure so it stays
// testable without a DOM or WebGL: a quote may show when its story has
// no published coordinates (it cycles without a marker), when no
// projection is available yet (first paint, tests), or when its
// published location currently faces the camera. Coordinates are never
// invented or moved to satisfy this — an unfacing quote waits its turn.
export function quoteEligible(q, projectFn) {
  if (!q) return false;
  if (!Number.isFinite(q.lon) || !Number.isFinite(q.lat)) return true;
  if (typeof projectFn !== 'function') return true;
  return !!projectFn(q.lon, q.lat);
}
// Next eligible quote at or after fromIdx, wrapping once; -1 when none
// currently faces. Pure; the caller holds its card and retries later.
export function pickFacingQuote(list, projectFn, fromIdx) {
  if (!Array.isArray(list) || !list.length) return -1;
  const n = list.length;
  const at = Number.isInteger(fromIdx) ? ((fromIdx % n) + n) % n : 0;
  for (let k = 0; k < n; k++) {
    const idx = (at + k) % n;
    if (quoteEligible(list[idx], projectFn)) return idx;
  }
  return -1;
}
// Card trajectory for one quote cycle, from live globe geometry: start
// on the foreground at the visible limb, rest overlapping the sphere,
// end drifting gently outward. All points clamped so the
// card stays inside the stage; end may leave slightly as it dissolves.
// Pure so the geometry stays testable without a DOM.
export function quotePose({mobile, side = 1, v = 1, cx, cy, r, w, h, W, H}) {
  const clampX = (x) => Math.max(8, Math.min(Math.max(8, W - w - 8), x));
  const clampY = (y) => Math.max(8, Math.min(Math.max(8, H - h - 8), y));
  let sx, sy, rx, ry, ex, ey;
  if (mobile) {
    sx = clampX(cx + side * (r - w / 2 + 36) - w / 2);
    sy = clampY(cy - h / 2);
    rx = side < 0 ? clampX(8) : clampX(W - w - 8);
    ry = clampY(H - h - 8);
    ex = rx + side * 24;
    ey = ry + 18;
  } else {
    rx = clampX(cx + side * (r - w * .2) - w / 2);
    ry = clampY(cy + v * r * .35 - h / 2);
    sx = clampX(rx - side * 18);
    sy = clampY(ry - v * 8);
    ex = rx + side * 18;
    ey = ry + v * 10;
  }
  return {sx, sy, rx, ry, ex, ey, w, h};
}
export function connectMarkup(mode='fiction'){return `<section class="connect-heading"><div><p class="eyebrow">CONNECT</p><h1>Find a familiar experience.</h1><p>Choose an event. Read a related experience.</p></div><span class="connect-demo">${mode==='real'?'Real shared stories':'Fictional community preview'}</span></section><div id="connect-root"></div>`;}
export function mountConnect({selected,events=[],onSelect=()=>{},onStory=()=>{},onReview=()=>{},mode='fiction',real=null,onMode=()=>{},onRetry=()=>{},onDiscoverySearch=()=>{},onDiscoveryCancel=()=>{},onDiscoveryPreview=()=>{}}={}){
 unmountConnect();const root=document.querySelector('#connect-root');if(!root)return;
 const realMode=mode==='real',realState=real||{matches:[],loading:false,error:'',guidance:'',needsTopics:false,picked:[],topics:[],hasEvents:true};
 let examples=!realMode&&!events.length,eventList=realMode?events:(examples?MY_EVENTS:events);
 let current=eventList.find(e=>e.id===selected)||eventList[0]||null,matches=[],active=null,earth=null,frame=0,resize=null,intersection=null,viewAbort=null,dead=false,epoch=0,drag=null;
 function realAside(){
  const topics=(realState.topics||[]).map(t=>`<label class="check-row"><input type="checkbox" data-real-topic value="${esc(t.id)}" ${realState.picked.includes(t.id)?'checked':''}><span>${esc(t.label)}</span></label>`).join('');
  return `<div class="real-panel" aria-live="polite">${realState.needsTopics?`<fieldset><legend>What is this event about? (pick at least one)</legend>${topics}</fieldset>`:''}${realState.loading?'<p class="muted" role="status">Loading shared stories…</p>':''}${realState.error?`<div class="stale-banner" role="alert">${esc(realState.error)} <button class="text-button" data-real-retry>Try again</button></div>`:''}${!realState.loading&&!realState.error&&realState.guidance?`<p class="muted">${esc(realState.guidance)}</p>`:''}${discoveryPanel()}</div>`;
 }
 function discoveryPanel(){
  const d=realState.discovery;if(!d)return '';
  const f=d.filters||{},cities=realState.cities||[];
  const previewN=Number(realState.topicPreviewCount)||0;
  return `<div class="discovery-panel"><fieldset><legend>Filter shared stories (local — no AI call)</legend>`
  +`<label>From year (optional) <input data-discovery-filter="fromYear" value="${esc(f.fromYear)}" inputmode="numeric" maxlength="4" placeholder="e.g. 1990"></label>`
  +`<label>To year (optional) <input data-discovery-filter="toYear" value="${esc(f.toYear)}" inputmode="numeric" maxlength="4" placeholder="e.g. 2010"></label>`
  +`<label>City <select data-discovery-filter="city"><option value="">All cities</option>${cities.map(c=>`<option value="${esc(c.name)}" ${f.city===c.name?'selected':''}>${esc(c.label)}</option>`).join('')}</select></label>`
  +`<label class="check-row"><input type="checkbox" data-discovery-filter="includeUnknownDates" ${f.includeUnknownDates!==false?'checked':''}><span>Include unknown dates</span></label></fieldset>`
  +`<p class="muted">Local topic preview, on this device: ${previewN} ${previewN===1?'story shares':'stories share'} your topics${d.showingSemantic?' — the globe below shows the Muse ranking instead':' — shown on the globe until a semantic search completes'}.</p>`
  +`<label for="discovery-query">What experience are you looking for? (max 500 characters)</label>`
  +`<textarea id="discovery-query" data-discovery-query maxlength="500" rows="3">${esc(d.query||'')}</textarea>`
  +`<p class="muted">Search sends your search text plus public excerpts (up to 40) to Meta for ranking. Your interview answers never leave this device.</p>`
  +`<div class="event-actions"><button class="button primary" type="button" data-discovery-search ${d.loading?'disabled':''}>${d.loading?'Searching…':'Search with Muse'}</button>${d.loading?'<button class="button outline" data-discovery-cancel type="button">Cancel</button>':''}</div>`
  +(!d.loading&&d.previewOffered?'<div class="event-actions"><button class="text-button" type="button" data-discovery-preview>Preview the searching animation</button></div><p class="muted">Simulated preview · no model call · 12 seconds.</p>':'')
  +(d.loading?`<p class="muted" role="status">${d.simulated?'Simulated preview — cycling the bound excerpts for 12 seconds. No search was sent.':'Asking Muse to rank the matching public excerpts…'}</p>`:'')
  +(!d.loading&&d.error?`<div class="stale-banner" role="alert">${esc(d.error)}</div>`:'')
  +(!d.loading&&!d.error&&d.searched?`<p class="muted">Muse (${esc(d.model||'muse-spark-1.3')}) ranked ${d.resultCount} ${d.resultCount===1?'story':'stories'}. Same-occasion badges come only from matching occasion codes, never from this ranking.</p>`:'')
  +(!d.loading&&!d.error&&d.truncated&&d.truncationNote?`<p class="muted">${esc(d.truncationNote)}</p>`:'')
  +(!d.loading&&!d.error&&d.searched&&!d.showingSemantic?'<p class="muted">These results belong to an earlier event or filters — search again to rank for what is selected now.</p>':'')
  +`</div>`;
 }
 let reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,playing=false,elapsed=0,last=0,visible=true;
 const searchingActive=()=>realMode&&!!realState.discovery?.loading;
 // Letter-cycle source: while a real search runs, ONLY its bound public
 // candidates; otherwise the currently displayed validated matches, so
 // ordinary Connect still shows letters. No search is ever started here.
 let resultSourceMatches=null,resultSourceQuotes=[];
 function quoteSource(){
  if(searchingActive()){
   const s=realState.discovery;
   return Array.isArray(s?.searching)?s.searching:[];
  }
  if(matches!==resultSourceMatches){resultSourceMatches=matches;resultSourceQuotes=quotesFromStories(matches);}
  return resultSourceQuotes;
 }
 // Must match the mobile breakpoint in styles.css: the overlay shows one
 // quote slot at or below it, two above it.
 const isMobileView=()=>matchMedia('(max-width: 760px)').matches;
 // Search-in-progress visualisation: readable excerpts from the public
 // candidates bound to this search appear beside the turning globe, one
 // every few seconds, staggered like the workshop's phase-offset
 // travellers — but as calm horizontal text, never tilted 3D. Each
 // quote is ONE card on a single layer above the canvas: it starts at
 // the visible globe edge, travels outward into a readable rest, holds,
 // then drifts further out and dissolves. No layer switch, no duplicate
 // text. Geometry comes from the live projection each fire, so motion
 // tracks zoom and resize. A quote shows only while its story's
 // published location faces the camera (stories without coordinates
 // cycle without a marker); while it shows, its origin point glows on
 // Earth with a subtle tether to the card, and both fade with the
 // quote. Labelled as in-progress work, never as live agent
 // observations — the ranking request exposes no per-story progress.
 // Excerpts are decorative duplicates (aria-hidden); the status line
 // carries the announcement.
 function searchingOverlay(){
  const list=quoteSource();
  if(!list.length)return '';
  const resting=!searchingActive();
  const d=realState.discovery||{},total=resting?list.length:(Number(d.searchingTotal)||list.length);
  const slots=slotsForQuotes(list.length,isMobileView());
  const cards=[];
  for(let i=0;i<slots;i++){
   const s=list[i];
   const origin=s.city?`Shared from ${esc(s.city)} · `:'';
   const body=`<p>“${esc(s.text)}”</p><small>${origin}${esc(s.name)} · ${esc(s.title)}</small>`;
   // Slot 0 animates from mount; slot 1 joins 3s later (startQuotes) so
   // the two crossfade. Pre-join slots hide inline (JS reveals); calm
   // modes force every card visible statically.
   cards.push(`<div class="searching-excerpt excerpt-${i}" data-quote-slot="${i}"${i>0&&!reduced?' style="opacity:0"':''}>${body}</div>`);
  }
  const label=resting
   ?`From the related stories below — ${total} ${total===1?'excerpt':'excerpts'} cycling beside the turning globe. Fictional community preview; nothing is being read or ranked right now.`
   :d.simulated
   ?`Simulated preview — cycling ${total} bound ${total===1?'excerpt':'excerpts'}. Glowing points show candidate locations; nothing was ranked.`
   :`Search in progress — ranking ${total} shared ${total===1?'story':'stories'} by meaning. Excerpts and glowing points show search candidates; ranked connections appear only for validated matches.`;
  return `<div class="searching-excerpts" aria-hidden="true">${cards.join('')}</div>${resting?'':`<p class="searching-label" role="status">${label}</p>`}`;
 }
 // Quote cycling: each slot fires every 6s (slot 1 offset 3s), so one
 // quote is always readable. Desktop slots hold fixed sides (left/right
 // limbs); the lone mobile slot alternates sides per quote. Each fire
 // takes the next bound quote whose published location faces the camera
 // (unlocated quotes always qualify), re-measures the globe and its own
 // card, runs edge-start travel (1.6s) → hold → dissolve (1.5s outward
 // drift), and arms the quote's origin highlight. When nothing faces,
 // the slot holds its card and retries every second as the globe turns.
 // Slot 0 honours its painted text on the first fire when it still
 // faces; later slots take a fresh quote as they join.
 const QUOTE_CYCLE_MS=6000,QUOTE_STAGGER_MS=3000,QUOTE_DISSOLVE_MS=4600,QUOTE_RETRY_MS=1000;
 let quoteTimers=[];
 let quoteCycleOn=false,motionPaused=false;
 let mobSide=1;
 let slotQuote=[null,null],slotMarkO=[0,0],slotMarkT=[0,0],slotPose=[null,null],lastMarks='';
 function stopQuotes(){for(const t of quoteTimers){clearTimeout(t);clearInterval(t);}quoteTimers=[];quoteCycleOn=false;}
 function trackQuoteTimer(t){if(t&&typeof t.unref==='function')t.unref();quoteTimers.push(t);return t;}
 function quoteSlot(i){return root.querySelector(`[data-quote-slot="${i}"]`);}
 function setQuoteText(slot,q){if(!slot||!q)return;const p=slot.querySelector('p'),small=slot.querySelector('small');if(p)p.textContent=`“${q.text}”`;if(small)small.textContent=`${q.city?`Shared from ${q.city} · `:''}${q.name} · ${q.title}`;}
 function setQuotePose(slot,x,y,o,s,b,dur,instant){
  if(!slot)return;
  slot.style.transition=instant?'none':'';
  slot.style.transitionDuration=instant?'':dur;
  slot.style.left=x+'px';slot.style.top=y+'px';
  slot.style.opacity=o;slot.style.transform='scale('+s+')';slot.style.filter='';
 }
 function quoteGeom(i,side){
  const stage=root.querySelector('.globe-stage');
  const W=(stage&&stage.clientWidth)||600,H=(stage&&stage.clientHeight)||420;
  const proj=(earth&&earth.projection)?earth.projection():projectGlobe(W,H,1);
  const card=quoteSlot(i);
  const w=(card&&card.offsetWidth)||250,h=(card&&card.offsetHeight)||110;
  const mobile=isMobileView();
  return quotePose({mobile,side,v:i===0?-1:1,cx:proj.cx,cy:proj.cy,r:proj.r,w,h,W,H});
 }
 // Origin highlights, repainted on every globe render (rotation, drag,
 // zoom included): each visible quote's published coordinates glow with
 // a tether to its card. Opacity eases toward each slot's target, so
 // highlights fade in with emerging quotes and out with dissolving
 // ones; far-side points hide. Candidate locations only — never match
 // claims; ranked arcs come solely from validated results.
 function markQuotes(){
  const host=root.querySelector('#quote-marks');
  if(!host||!earth)return;
  let dots='',lines='';
  for(let i=0;i<slotQuote.length;i++){
   const q=slotQuote[i];
   if(!q||!Number.isFinite(q.lon)||!Number.isFinite(q.lat))continue;
   const o=slotMarkO[i]+(slotMarkT[i]-slotMarkO[i])*.18;
   slotMarkO[i]=Math.abs(slotMarkT[i]-o)<.02?slotMarkT[i]:o;
   if(slotMarkO[i]<.02)continue;
   const p=earth.project(q.lon,q.lat);
   if(!p)continue;
   const oo=slotMarkO[i].toFixed(2),pose=slotPose[i];
   dots+=`<span class="quote-mark" style="left:${(p.x-7).toFixed(1)}px;top:${(p.y-7).toFixed(1)}px;opacity:${oo}"></span>`;
   // Tether endpoint tracks the card's live layout box (CSS transitions
   // move left/top every frame), falling back to the rest pose when the
   // slot has no card yet — so the line follows the moving card.
   const card=quoteSlot(i);
   const box=card?{x:card.offsetLeft,y:card.offsetTop,w:card.offsetWidth,h:card.offsetHeight}:pose;
   if(box){
    const ex=Math.max(box.x,Math.min(box.x+box.w,p.x)).toFixed(1),ey=Math.max(box.y,Math.min(box.y+box.h,p.y)).toFixed(1);
    const la=(slotMarkO[i]*.5).toFixed(2),ca=(slotMarkO[i]*.85).toFixed(2);
    lines+=`<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${ex}" y2="${ey}" stroke="rgba(255,244,230,${la})" stroke-width="4"/>`;
    lines+=`<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${ex}" y2="${ey}" stroke="rgba(176,118,52,${ca})" stroke-width="1.5"/>`;
   }
  }
  const html=lines?`<svg class="quote-links" width="100%" height="100%">${lines}</svg>`:'';
  const next=html+dots;
  if(next!==lastMarks){host.innerHTML=next;lastMarks=next;}
 }
 function startQuotes(){
  stopQuotes();
  if(motionPaused)return;
  let list=quoteSource();
  if(!list.length){quoteCycleOn=false;return;}
  quoteCycleOn=true;
  const slots=slotsForQuotes(list.length,isMobileView());
  if(slots<1)return;
  slotQuote=list.slice(0,slots);
  slotMarkO=slotQuote.map(()=>1);slotMarkT=slotQuote.map(()=>1);
  slotPose=slotQuote.map((_,i)=>{const g=quoteGeom(i,isMobileView()?1:(i===0?-1:1));return {x:g.rx,y:g.ry,w:g.w,h:g.h};});
  if(reduced)return;
  const mountDoc=typeof document==='undefined'?null:document;
  let next=slots%list.length;
  const alive=()=>!dead&&quoteCycleOn&&(mountDoc===null||typeof document==='undefined'||document===mountDoc);
  const fire=(i,keep)=>{
   if(!alive()){stopQuotes();return;}
   // A finished search swaps bound candidates for validated displayed
   // results: drop stale candidate notes and restart from the new source.
   const fresh=quoteSource();
   if(fresh!==list){list=fresh;if(!list.length){stopQuotes();return;}next=0;slotQuote=[null,null];slotMarkO=[0,0];slotMarkT=[0,0];}
   const proj=earth?(lon,lat)=>earth.project(lon,lat):null;
   const blocked=new Set(slotQuote.filter((q,j)=>j!==i&&q&&slotMarkT[j]>0).map(q=>q.id));
   let idx=-1;
   if(keep){const cur=list.indexOf(slotQuote[i]);if(cur>=0&&!blocked.has(slotQuote[i]?.id)&&quoteEligible(slotQuote[i],proj))idx=cur;}
   if(idx<0)idx=pickFacingQuote(list.map(q=>blocked.has(q.id)?null:q),proj,next);
   if(idx<0){trackQuoteTimer(setTimeout(()=>fire(i,false),QUOTE_RETRY_MS));return;}
   const q=list[idx];
   if(slotQuote[i]!==q){next=idx+1;slotQuote[i]=q;slotMarkO[i]=0;}
   slotMarkT[i]=1;
   const side=isMobileView()?mobSide:(i===0?-1:1);
   if(isMobileView())mobSide*=-1;
   const slot=quoteSlot(i);
   setQuoteText(slot,q);
   const g=quoteGeom(i,side);
   slotPose[i]={x:g.rx,y:g.ry,w:g.w,h:g.h};
   setQuotePose(slot,g.sx,g.sy,0,.92,2,'',true);
   void (slot&&slot.offsetWidth);
   setQuotePose(slot,g.rx,g.ry,1,1,0,'1.6s',false);
   trackQuoteTimer(setTimeout(()=>{
    if(!alive()){stopQuotes();return;}
    slotMarkT[i]=0;
    setQuotePose(slot,g.ex,g.ey,0,1,2,'1.5s',false);
   },QUOTE_DISSOLVE_MS));
  };
  fire(0,true);
  if(slots>1)trackQuoteTimer(setTimeout(()=>{fire(1,false);trackQuoteTimer(setInterval(()=>fire(1,false),QUOTE_CYCLE_MS));},QUOTE_STAGGER_MS));
  trackQuoteTimer(setInterval(()=>fire(0,false),QUOTE_CYCLE_MS));
 }
 const duration=4200,abort=new AbortController();
 const hasLocation=e=>Number.isFinite(e?.lon)&&Number.isFinite(e?.lat);
 function markPins(pins){
  const host=root.querySelector('#globe-pins');if(!host)return;
  const priorFocus=host.contains(document.activeElement)?document.activeElement.dataset.mapStory:null;
  host.innerHTML=pins.map(s=>s.origin?`<span class="globe-pin origin-pin" style="left:${s.x}px;top:${s.y}px" title="Selected event: ${esc(current?.place||'')}"><span></span></span>`:`<button class="globe-pin ${active===s.id?'focused-pin':''}" style="left:${s.x}px;top:${s.y}px" data-map-story="${esc(s.id)}" aria-label="Read ${esc(s.name)}: ${esc(s.title)}"><span></span></button>`).join('');
  if(priorFocus)Array.from(host.querySelectorAll('button')).find(b=>b.dataset.mapStory===priorFocus)?.focus({preventScroll:true});
 }
 function progress(){return reduced?1:Math.min(1,elapsed/duration);}
 function draw(now){frame=0;if(dead||!earth||!visible)return;const cycling=quoteCycleOn&&!reduced;if(playing){if(last)elapsed+=Math.min(60,now-last);last=now;if(elapsed>=duration){playing=false;elapsed=duration;updateControls();}}if(cycling)earth.rotate(.00045,0);earth.render(progress());if(playing||cycling)frame=requestAnimationFrame(draw);}
 function schedule(){if(!frame&&!dead&&visible)frame=requestAnimationFrame(draw);}
 function updateControls(){const button=root.querySelector('[data-globe="pause"]');if(button)button.textContent=motionPaused?'Resume motion':quoteCycleOn&&!reduced?'Pause motion':playing?'Pause connections':elapsed>=duration?'Replay connections':'Resume connections';}
 function start(){elapsed=reduced?duration:0;last=0;playing=!reduced;updateControls();schedule();}
 function fallback(){const stage=root.querySelector('.globe-stage');if(!stage)return;stage.classList.add('earth-fallback');stage.querySelector('.earth-status').textContent='3D Earth is unavailable here. All related stories remain in the list below.';}
 function markup(){
  const kind=s=>s.matchType==='same_occasion'?'Same occasion':'Similar experience';
  return `<div class="connect-mode-switch" role="group" aria-label="Story source"><button data-connect-mode="real" aria-pressed="${realMode}">Real stories</button><button data-connect-mode="fiction" aria-pressed="${!realMode}">Fictional examples</button></div><div class="connect-explorer"><aside class="event-panel"><div class="event-panel-header"><span class="eyebrow">${examples?'EXAMPLE EVENTS':'YOUR EVENTS'}</span><span class="tag">${examples?'FICTIONAL':'PRIVATE'}</span></div>${!realMode&&events.length?`<div class="connect-source-switch"><button data-event-source="own" aria-pressed="${!examples}">Your events (${events.length})</button><button data-event-source="examples" aria-pressed="${examples}">Examples</button></div>`:realMode?'<p class="connect-event-help">Choose one of your confirmed events to look for related shared stories below. Selecting it is local; only an explicit search sends your search text to Meta.</p>':'<p class="connect-event-help">Your confirmed events will appear here. For now, explore these fictional examples.</p>'}<div class="event-timeline" role="group" aria-label="Choose an event">${eventList.map(e=>`<button class="life-event ${e.id===current?.id?'selected':''}" data-connect-event="${esc(e.id)}" aria-pressed="${e.id===current?.id}"><span class="event-copy"><small>${esc(e.year)} · ${esc(e.place)}</small><strong>${esc(e.title)}</strong><span>${esc(e.excerpt.slice(0,110))}${e.excerpt.length>110?'…':''}</span></span><span aria-hidden="true">↗</span></button>`).join('')}</div></aside><section class="globe-panel" aria-label="Earth and related experiences"><div class="globe-panel-top"><div><span class="tag">${realMode?'SHARED':examples?'EXAMPLE':'YOUR EVENT'}</span><h2>${esc(current?.title||'No events yet')}</h2></div><span class="connection-count">${matches.length}<span> related ${matches.length===1?'story':'stories'}</span></span></div><div class="globe-stage"><canvas id="connect-globe" tabindex="0" role="img" aria-label="Textured Earth. Connections start at ${esc(current?.place||'')}. Drag or use arrow keys to rotate. Related stories are also listed below."></canvas><div id="globe-pins"></div><div id="quote-marks" aria-hidden="true"></div><p class="earth-status" role="status">Loading Earth…</p>${searchingOverlay()}</div>${quoteSource().length?'':`<div class="earth-excerpts" aria-hidden="true">${matches.slice(0,2).map((s,i)=>`<div class="earth-excerpt excerpt-${i}"><p>“${esc(s.excerpt.slice(0,145))}”</p><small>${esc(s.name)} · ${esc(s.place)}</small></div>`).join('')}</div>`}<div class="globe-controls" role="group" aria-label="Earth controls"><button data-globe="left" aria-label="Rotate Earth left">←</button><button data-globe="right" aria-label="Rotate Earth right">→</button><button data-globe="out" aria-label="Zoom Earth out">−</button><button data-globe="in" aria-label="Zoom Earth in">+</button><button data-globe="reset">Reset</button><button data-globe="pause">Pause connections</button><button data-globe="motion" aria-pressed="${!reduced}">${reduced?'Enable motion':'Motion on'}</button></div><span class="globe-drag-hint">Drag to rotate · arrows connect experiences</span><div class="globe-panel-bottom"><span><i class="legend-you"></i> Selected event</span><span><i class="legend-other"></i> Related story</span><a href="./assets/earth/README.md" target="_blank" rel="noopener">Earth imagery: NASA</a></div>${!hasLocation(current)?'<p class="connect-location-note">This event has no recognised city yet. Review its location to place an origin on Earth; no location is guessed.</p>':''}</section><div class="real-side">${realMode?realAside():''}<p class="connect-event-help">Your event stays private. Selecting it compares it locally with the ${realMode?'shared stories below. Only an explicit search sends your search text to Meta for ranking.':'fictional stories shown here.'}</p>${current?.projectId?`<button class="text-button" data-review-event="${esc(current.projectId)}">Review this event →</button>`:''}</div></div><section class="connect-matches" aria-labelledby="matches-title"><div class="section-heading"><div><p class="eyebrow">RELATED EXPERIENCES</p><h2 id="matches-title">${matches.length?(realMode?'Shared stories to read':'Stories to read'):(realMode?'No matching shared stories':'No related stories in this preview')}</h2></div><span>${realMode?'Real shared copies':'Fictional profiles'}</span></div>${matches.length?`<div class="connection-cards">${matches.map(s=>`<article class="connection-card" data-connection-card="${esc(s.id)}"><div class="connection-person"><span class="connection-avatar" style="background:${s.color}">${esc(s.initials)}</span><div><strong>${esc(s.name)}</strong><small>${esc(s.place)} · ${esc(s.year)}</small></div><button class="connection-locate" data-locate="${esc(s.id)}" aria-label="Locate ${esc(s.name)} on Earth">◎</button></div><span class="tag">${kind(s)}</span><h3>${esc(s.title)}</h3><p>${esc(s.excerpt)}</p><details class="match-evidence"><summary>Why this relates</summary><p>${esc(s.reason)}</p><blockquote>${esc(s.evidence[0])}</blockquote><blockquote>${esc(s.evidence[1])}</blockquote></details><button class="text-button" data-read-story="${esc(s.id)}">Read story →</button></article>`).join('')}</div>`:`<p class="connect-empty">No matching shared experiences are available for this event yet. ${realMode?'You can choose another event or pick topics above.':'You can choose another event or explore the examples.'}</p>`}</section><p class="connect-footnote">${realMode?'Real shared copies appear under pen names. Your interview answers never leave this device; only an explicit search sends your search text plus public excerpts to Meta for ranking.':'Preview matching uses explicit example topics and evidence. Switch to Real stories above for shared copies and Muse-powered discovery.'}</p>`;
 }
 async function render(){
  // A superseded mount must never repaint: after onSelect remounts (event
  // or source switch), the old handler's trailing render() would overwrite
  // the fresh markup with its stale snapshot (e.g. a stuck 'Searching…').
  if(dead)return;
  const token=++epoch;viewAbort?.abort();viewAbort=new AbortController();resize?.disconnect();intersection?.disconnect();earth?.dispose();earth=null;if(frame)cancelAnimationFrame(frame);frame=0;
  stopQuotes();
  root.classList.toggle('calm-motion',reduced);
  matches=realMode?(realState.matches||[]):matchesFor(current);root.innerHTML=markup();const canvas=root.querySelector('canvas'),stage=root.querySelector('.globe-stage'),signal=viewAbort.signal;
  canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);},{signal});
  canvas.addEventListener('pointermove',e=>{if(!drag||!earth)return;earth.rotate(-(e.clientX-drag.x)*.006,(e.clientY-drag.y)*.006);drag={x:e.clientX,y:e.clientY};earth.render(progress());},{signal});
  const stop=()=>drag=null;canvas.addEventListener('pointerup',stop,{signal});canvas.addEventListener('pointercancel',stop,{signal});
  canvas.addEventListener('keydown',e=>{const values={ArrowLeft:[-.2,0],ArrowRight:[.2,0],ArrowUp:[0,.15],ArrowDown:[0,-.15]};if(values[e.key]){e.preventDefault();earth?.rotate(...values[e.key]);earth?.render(progress());}},{signal});
  startQuotes();
  try{
   const {createEarth}=await import('./earth.js');if(dead||token!==epoch)return;
   earth=createEarth(canvas,{onPins:(pins)=>{markPins(pins);markQuotes();},onError:fallback,onReady:()=>{if(dead||token!==epoch)return;stage.querySelector('.earth-status').textContent='';stage.classList.add('earth-ready');start();}});
   if(!earth){fallback();return;}
   earth.setEvents(hasLocation(current)?current:null,matches);
   resize=new ResizeObserver(()=>{earth?.resize(stage.clientWidth,stage.clientHeight);schedule();});resize.observe(stage);
   intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;last=0;if(!visible&&frame){cancelAnimationFrame(frame);frame=0;}else schedule();});intersection.observe(stage);
   start();
  }catch{fallback();}
 }
 root.addEventListener('click',e=>{
  const modeBtn=e.target.closest('[data-connect-mode]');if(modeBtn){onMode(modeBtn.dataset.connectMode);return;}
  const retry=e.target.closest('[data-real-retry]');if(retry){onRetry();return;}
  const dSearch=e.target.closest('[data-discovery-search]');if(dSearch){e.preventDefault();onDiscoverySearch();return;}
  const dCancel=e.target.closest('[data-discovery-cancel]');if(dCancel){e.preventDefault();onDiscoveryCancel();return;}
  const dPreview=e.target.closest('[data-discovery-preview]');if(dPreview){e.preventDefault();onDiscoveryPreview();return;}
  const source=e.target.closest('[data-event-source]');if(source){examples=source.dataset.eventSource==='examples';eventList=examples?MY_EVENTS:events;current=eventList[0];active=null;onSelect(current.id);render();return;}
  const event=e.target.closest('[data-connect-event]');if(event){current=eventList.find(x=>x.id===event.dataset.connectEvent);active=null;onSelect(current.id);render();return;}
  const review=e.target.closest('[data-review-event]');if(review){onReview(review.dataset.reviewEvent);return;}
  const control=e.target.closest('[data-globe]');if(control){const action=control.dataset.globe;if(action==='left')earth?.rotate(-.25,0);if(action==='right')earth?.rotate(.25,0);if(action==='in')earth?.zoom(.1);if(action==='out')earth?.zoom(-.1);if(action==='reset'){earth?.setEvents(hasLocation(current)?current:null,matches);start();}if(action==='pause'){motionPaused=!motionPaused;if(motionPaused){playing=false;stopQuotes();}else{startQuotes();playing=!reduced&&elapsed<duration;last=0;}updateControls();}if(action==='motion'){reduced=!reduced;control.setAttribute('aria-pressed',String(!reduced));control.textContent=reduced?'Enable motion':'Motion on';root.classList.toggle('calm-motion',reduced);if(reduced)stopQuotes();else startQuotes();start();}schedule();return;}
  const trigger=e.target.closest('[data-map-story],[data-read-story],[data-locate]');if(trigger){const id=trigger.dataset.mapStory||trigger.dataset.readStory||trigger.dataset.locate,s=matches.find(x=>x.id===id);if(!s)return;active=s.id;earth?.highlight(s.id);root.querySelectorAll('[data-connection-card]').forEach(card=>card.classList.toggle('highlighted',card.dataset.connectionCard===id));if(trigger.dataset.locate){earth?.locate(s);root.querySelector('.globe-panel').scrollIntoView({block:'center',behavior:reduced?'auto':'smooth'});}else onStory(s);}
 },{signal:abort.signal});
 document.addEventListener('visibilitychange',()=>{visible=!document.hidden;last=0;if(!visible&&frame){cancelAnimationFrame(frame);frame=0;}else schedule();},{signal:abort.signal});
 render();cleanup=()=>{dead=true;epoch++;abort.abort();viewAbort?.abort();resize?.disconnect();intersection?.disconnect();earth?.dispose();stopQuotes();if(frame)cancelAnimationFrame(frame);};
}
export function sharedStoryMarkup(s){return `<button class="modal-close" data-action="close" aria-label="Close story">×</button><p class="eyebrow">FICTIONAL STORY · ${esc(s.place)}</p><h2 id="modal-title">${esc(s.title)}</h2><p class="muted">${esc(s.name)} · ${esc(s.year)}</p>${s.story.split('\n\n').map(p=>`<p class="shared-story-paragraph">${esc(p)}</p>`).join('')}<div class="shared-story-reason"><span>${s.matchType==='same_occasion'?'SAME OCCASION':'SIMILAR EXPERIENCE'}</span><p>${esc(s.reason)}</p></div><p class="shared-story-note">Fictional profile. Messaging and real-user discovery are not connected.</p><button class="button outline" data-action="close">Back to Earth</button>`;}
