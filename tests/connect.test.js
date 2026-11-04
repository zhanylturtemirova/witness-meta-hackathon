import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {MY_EVENTS,SHARED_STORIES,matchesFor,projectPoint,greatCircle,projectGlobe} from '../web/connect-data.js';
import {slotsForQuotes,quotePose,quoteEligible,pickFacingQuote,trimQuoteText,quotesFromStories} from '../web/connect.js';
test('matching changes with the selected event and excludes unshared stories',()=>{
 const moving=matchesFor(MY_EVENTS.find(e=>e.id==='moving'));assert.equal(moving.length,4);assert.ok(moving.every(s=>s.category==='moving-abroad'));assert.ok(!moving.some(s=>s.id==='private-example'));
 const concert=matchesFor(MY_EVENTS.find(e=>e.id==='concert'));assert.equal(concert.length,3);assert.ok(concert.every(s=>s.category==='first-concert'));assert.ok(!concert.some(s=>moving.some(x=>x.id===s.id)));
 assert.equal(matchesFor(MY_EVENTS.find(e=>e.id==='pottery')).length,0);
});
test('globe projection hides the opposite side and places a focused point at the centre',()=>{
 const front=projectPoint(16,48,16,48,200);assert.ok(Math.abs(front.x)<1e-10);assert.ok(Math.abs(front.y)<1e-10);assert.ok(front.z>.999);
 assert.ok(projectPoint(196,-48,16,48).z<0);
});
test('connection arcs follow the sphere with correct end points, including an antipodal pair',()=>{
 const from={lon:16.37,lat:48.21},to={lon:-79.38,lat:43.65};for(const [t,p]of[[0,from],[1,to]]){const result=greatCircle(from,to,t);assert.ok(Math.abs(result.lon-p.lon)<1e-8);assert.ok(Math.abs(result.lat-p.lat)<1e-8);}
 for(const t of[0,.25,.5,.75,1]){const point=greatCircle({lon:0,lat:0},{lon:180,lat:0},t);assert.ok(Number.isFinite(point.lon)&&Number.isFinite(point.lat));}
});
test('every displayed shared story has valid coordinates and a readable fictional story',()=>{
 const ids=new Set();for(const s of SHARED_STORIES){assert.ok(!ids.has(s.id));ids.add(s.id);assert.ok(s.lon>=-180&&s.lon<=180&&s.lat>=-90&&s.lat<=90);if(s.shared){assert.ok(s.story.length>50);assert.ok(s.reason);}}
});

test('quote slots stay bounded: none empty, one lone, two desktop, one mobile',()=>{
 assert.equal(slotsForQuotes(0,false),0);assert.equal(slotsForQuotes(0,true),0);
 assert.equal(slotsForQuotes(1,false),1);assert.equal(slotsForQuotes(1,true),1);
 assert.equal(slotsForQuotes(2,false),2);assert.equal(slotsForQuotes(2,true),1);
 assert.equal(slotsForQuotes(40,false),2);assert.equal(slotsForQuotes(40,true),1);
 assert.equal(slotsForQuotes(-1,false),0);assert.equal(slotsForQuotes(NaN,false),0);
});
test('projectGlobe centres the silhouette and scales the radius with zoom',()=>{
 const g=projectGlobe(600,420,1);
 assert.deepEqual({cx:g.cx,cy:g.cy},{cx:300,cy:210});
 assert.ok(Math.abs(g.r-160.6)<0.6,'radius matches the fov-42° frustum at distance 3.55');
 assert.ok(g.r<210,'silhouette fits the stage height');
 assert.ok(projectGlobe(600,420,1.5).r>g.r,'zooming in grows the silhouette');
 assert.ok(projectGlobe(600,420,.7).r<g.r,'zooming out shrinks the silhouette');
 assert.deepEqual(projectGlobe(600,420,99),projectGlobe(600,420,1.5),'zoom clamps like earth.js');
 assert.deepEqual(projectGlobe(600,420,0),projectGlobe(600,420,.7),'zoom clamps like earth.js');
});
test('quotePose keeps desktop letters over the visible limb with gentle drift',()=>{
 const left=quotePose({mobile:false,side:-1,v:-1,cx:300,cy:210,r:161,w:250,h:110,W:600,H:420});
 assert.ok(left.sx<300-161&&left.sx+250>300-161,'start straddles the left limb');
 assert.ok(left.rx+250>300-161,'rest stays anchored at the limb, mostly outside');
 const travel=Math.hypot(left.rx-left.sx,left.ry-left.sy);
 assert.ok(travel>8&&travel<40,'letter has a gentle visible drift');
 assert.ok(left.ex<left.rx,'dissolve drifts further outward');
 const right=quotePose({mobile:false,side:1,v:1,cx:300,cy:210,r:161,w:250,h:110,W:600,H:420});
 assert.ok(right.sx<300+161&&right.sx+250>300+161,'start straddles the right limb');
 assert.ok(right.rx<461&&right.rx+250>461,'rest overlaps the visible right limb');
 assert.ok(right.rx>=8&&right.rx+250<=592,'right letter stays inside the stage');
 assert.ok(Math.hypot(right.rx-right.sx,right.ry-right.sy)>8&&Math.hypot(right.rx-right.sx,right.ry-right.sy)<40,'right gentle drift mirrors left');
});
test('quotePose keeps mobile cards inside the stage with visible travel',()=>{
 const base={mobile:true,cx:175,cy:165,r:126,w:230,h:110,W:350,H:330};
 for(const side of[1,-1]){
  const g=quotePose({...base,side});
  assert.ok(g.rx>=8&&g.rx+230<=350-8+1e-9&&g.ry>=8&&g.ry+110<=330-8+1e-9,'rest sits fully inside the stage');
  assert.ok(Math.hypot(g.rx-g.sx,g.ry-g.sy)>60,'mobile travel stays visible');
 }
 const tiny=quotePose({mobile:false,side:-1,v:-1,cx:100,cy:100,r:60,w:250,h:110,W:200,H:200});
 assert.ok(Number.isFinite(tiny.sx+tiny.sy+tiny.rx+tiny.ry),'degenerate stages clamp without NaN');
});
test('quoteEligible gates on the visible hemisphere without inventing coordinates',()=>{
 const facing=(lon)=>lon>0?{x:1,y:1}:null;
 assert.equal(quoteEligible(null,facing),false,'no quote never shows');
 assert.equal(quoteEligible({lon:null,lat:null},facing),true,'unlocated quotes cycle without a marker');
 assert.equal(quoteEligible({lon:-9.14,lat:38.72},null),true,'no projection yet means eligible (first paint)');
 assert.equal(quoteEligible({lon:18.65,lat:54.35},facing),true,'facing locations show');
 assert.equal(quoteEligible({lon:-9.14,lat:38.72},facing),false,'far-side locations wait');
});
test('pickFacingQuote skips far-side quotes, wraps, and reports none facing',()=>{
 const list=[{lon:-9.14,lat:38.72},{lon:18.65,lat:54.35},{lon:74.57,lat:42.87}];
 const facing=(lon)=>lon>10?{x:1,y:1}:null;
 assert.equal(pickFacingQuote(list,facing,0),1,'skips the far-side opener');
 assert.equal(pickFacingQuote(list,facing,2),2,'takes a facing quote at the cursor');
 assert.equal(pickFacingQuote(list,facing,3),1,'wraps past the end');
 assert.equal(pickFacingQuote(list,()=>null,0),-1,'nothing facing means hold and retry');
 assert.equal(pickFacingQuote([],facing,0),-1,'empty list means no quote');
 assert.equal(pickFacingQuote(list,null,2),2,'without a projection every quote is eligible');
});
test('quote overlay uses one tray above the canvas, calm rules, and mobile order',()=>{
 const css=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','web','styles.css'),'utf8');
 assert.ok(/\.searching-excerpt\{[^}]*transition:left 1s/.test(css),'quote motion runs on transitions');
 assert.ok(css.includes('.searching-excerpts{position:absolute;inset:0;pointer-events:none;z-index:3}'),'single quote tray paints above the canvas');
 assert.ok(css.includes('searching-excerpts-behind')===false,'no behind-globe layer remains');
 assert.ok(css.includes('#connect-globe{position:absolute;inset:0;width:100%;height:100%;display:block;z-index:1}'),'canvas z-index unchanged below the tray');
 assert.ok(css.includes('#globe-pins{position:absolute;inset:0;pointer-events:none;z-index:2}'),'pins stay above the globe');
 assert.ok(css.includes('.calm-motion .searching-excerpt{transition:none;opacity:1!important'),'manual motion toggle freezes quotes visibly');
 assert.ok(css.includes('#quote-marks{position:absolute;inset:0;pointer-events:none;z-index:2;overflow:hidden}'),'marks layer sits above the globe');
 assert.ok(css.includes('.quote-mark{position:absolute;width:14px;height:14px;'),'origin glow style exists');
 assert.ok(/\.quote-mark\{[^}]*#fff[^}]*box-shadow:0 0 0 1\.5px rgba\(25,20,15/.test(css),'origin mark has a white core with a dark ring for day and night textures');
 assert.ok(css.includes('@media(prefers-reduced-motion:reduce){.searching-excerpt{transition:none;opacity:1!important'),'reduced motion freezes quotes visibly');
 assert.ok(css.includes('.searching-excerpt.excerpt-1{display:none}'),'mobile backstop hides the second card');
 assert.ok(css.includes('.connect-explorer>.globe-panel{grid-column:2;grid-row:1/span 2;min-width:0}'),'desktop keeps the globe beside the sidebar column');
 assert.ok(css.includes('@media(max-width:900px){.connect-explorer>.event-panel,.connect-explorer>.globe-panel,.connect-explorer>.real-side{grid-column:1;grid-row:auto}'),'narrow screens stack events, globe, then filters in DOM order');
});
test('construction matches need shared work evidence; time and place alone do not imply the same occasion',()=>{
 const event=MY_EVENTS.find(e=>e.id==='house-building'),matches=matchesFor(event);
 assert.equal(matches.length,3);assert.ok(matches.some(s=>s.place==='Gdańsk, Poland'));
 assert.equal(matches.find(s=>s.id==='tom-site').matchType,'same_occasion');
 assert.equal(matches.find(s=>s.id==='jonas').matchType,'similar_experience');
 assert.ok(!matches.some(s=>s.id==='bakery-example'));
 assert.equal(matchesFor({...event,occasion:null}).find(s=>s.id==='tom-site').matchType,'similar_experience');
 assert.equal(matchesFor({...event,evidenceKeys:['site-work']}).length,0);
 assert.equal(matchesFor(event,[{...matches[0],shared:false}]).length,0);
});
test('letter quotes are short visual duplicates with ellipsis, never empty',()=>{
 assert.equal(trimQuoteText('  hello   world  '),'hello world');
 assert.equal(trimQuoteText('x'.repeat(140)),'x'.repeat(140));
 const long=trimQuoteText('y'.repeat(200));
 assert.ok(long.length<=141&&long.endsWith('…'),'long quotes cap near 140 chars with ellipsis');
 assert.equal(trimQuoteText(''),'', 'empty stays empty');
 assert.equal(trimQuoteText(null),'','missing stays missing');
});
test('quote source uses only public excerpts, keeps coordinates, skips textless stories',()=>{
 const stories=[
  {id:'a',name:'Ann',title:'T',place:'Berlin, Germany',lon:13.4,lat:52.5,excerpt:'Short public excerpt.'},
  {id:'b',name:'Bo',title:'U',place:'Nowhere',lon:null,lat:null,excerpt:'Unlocated story still cycles, without a marker.'},
  {id:'c',name:'Cy',title:'V',lon:1,lat:2},
 ];
 const quotes=quotesFromStories(stories);
 assert.equal(quotes.length,2,'textless stories never become letters');
 assert.equal(quotes[0].city,'Berlin, Germany');
 assert.equal(quotes[0].lon,13.4,'coordinates pass through, never invented');
 assert.equal(quotes[1].lon,null,'unlocated quotes keep null coordinates');
 assert.ok(quotes.every(q=>q.text.length<=141),'visual duplicates stay short');
 assert.deepEqual(quotesFromStories([]),[],'no matches means no letters');
 assert.deepEqual(quotesFromStories(null),[],'missing list means no letters');
});
test('Connect correction CSS: real paper, compact heading, tall stage, paper letters',()=>{
 const css=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','web','pencil-theme.css'),'utf8');
 assert.ok(css.includes('warm-paper.png'),'real paper texture is used');
 assert.ok(css.includes('650px'),'paper tiles at about 650px');
 assert.ok(/\.connect-heading h1\{font-size:24px/.test(css),'Connect heading is compact, not a giant hero');
 assert.ok(css.includes('.connect-explorer{grid-template-columns:340px minmax(0,1fr)'),'event panel fits its contents beside a flexible globe');
 assert.ok(css.includes('.connect-explorer fieldset{min-width:0;max-width:100%'),'panel fieldsets fit the column');
 assert.ok(!/\.connect-explorer\{[^}]*overflow\s*:\s*hidden/.test(css),'overflow is never hidden to conceal panel contents');
 assert.ok(css.includes('height:clamp(520px,68vh,800px)'),'stage is tall on desktop');
 assert.ok(css.includes('.searching-excerpt::before'),'letter silhouette lives on a background-only layer');
 assert.ok(css.includes('font-style:italic'),'letter quotes are editorial italic');
 assert.ok(css.includes('#ffe3a3'),'quote dots glow honey amber');
});
