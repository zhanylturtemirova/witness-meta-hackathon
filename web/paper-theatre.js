// Paper theatre: free built-in 2D animated scenery, drawn in code by Muse Code.
// These sets are original flat shapes rendered on canvas. They are NOT
// Meta Muse Image illustrations and MUST NOT be labelled as generated images.
// No network, no secrets, no vendor calls. Pure helpers take scalars and
// return fresh objects; drawing takes any 2D-like context (real or fake).
export const PAPER_SETS=[
 {id:'concert',label:'Concert',hint:'stage, crowd and lights'},
 {id:'station',label:'Station',hint:'a train passing the platform'},
 {id:'workshop',label:'Workshop',hint:'tools and moving props'},
 {id:'hearth',label:'Warm room',hint:'a quiet lamplit room'},
];
const SET_IDS=PAPER_SETS.map(s=>s.id);
export function listPaperSets(){return PAPER_SETS.map(s=>({...s}));}
export function normalizePaperSet(id){return SET_IDS.includes(id)?id:'hearth';}
export function normalizeFilmMode(mode){return mode==='images'?'images':'paper';}
const STYLE_NOTES={
 'paper-theatre':'flat paper-cut shapes, layered card scenery',
 'ink':'simple ink lines, monochrome wash',
 'storybook':'soft storybook colour wash',
};
export function listStylePresets(){return Object.keys(STYLE_NOTES);}
// Suggest a set from the approved excerpt wording only. Keyword heuristic:
// the narrator always picks the final set per scene. No names, dates,
// places, or life events are invented here; only a set id is returned.
export function suggestPaperSet(excerpt=''){
 const text=String(excerpt||'').toLowerCase();
 if(/(song|sing|sang|sung|music|concert|stage|crowd|applaus|guitar|piano|choir|danc)/.test(text))return 'concert';
 if(/(train|station|platform|rail|journey|travel|voyage|\bbus\b|depart)/.test(text))return 'station';
 if(/(workshop|\btool(s)?\b|hammer|build|built|craft|repair|carv|forge|clay|\bsew\b|lathe)/.test(text))return 'workshop';
 return 'hearth';
}
export function resolveSceneSet(film,index,excerpt=''){
 const chosen=film&&Array.isArray(film.sceneSets)?film.sceneSets[index]:null;
 return normalizePaperSet(chosen||suggestPaperSet(excerpt));
}
const clampT=t=>(typeof t==='number'&&t>=0)?t:0;
// Deterministic animation state. Same (set,t) always yields equal state.
// Movers depend on t only, never on camera. Fresh object per call.
export function paperFrameState(setId='hearth',t=0){
 const set=normalizePaperSet(setId),time=clampT(t);
 if(set==='concert'){
  const crowd=Array.from({length:10},(_,i)=>({x:70+i*115,y:520+Math.round(14*Math.abs(Math.sin(time*3+i*0.9)))}));
  return {set,t:time,crowd,beams:[Math.sin(time*0.9)*0.55,Math.sin(time*0.9+Math.PI)*0.55],pulse:0.5+0.5*Math.sin(time*4)};
 }
 if(set==='station'){
  const cycle=12,p=(time%cycle)/cycle;
  return {set,t:time,trainX:Math.round(p*1800-520),smoke:[0,1,2,3].map(i=>({y:300-Math.round(((time*0.35+i*0.25)%1)*180),r:10+Math.round(((time*0.35+i*0.25)%1)*22)}))};
 }
 if(set==='workshop'){
  return {set,t:time,gearA:time*1.2,gearB:-time*1.6,hammer:Math.sin(time*2.2)*0.5,lamp:Math.sin(time*0.8)*0.12};
 }
 return {set,t:time,flames:[0,1,2].map(i=>46+Math.round(10*Math.sin(time*7+i*2.1)+6*Math.sin(time*13+i))) ,steam:[0,1,2].map(i=>((time*0.25+i/3)%1)),rock:Math.sin(time*1.1)*0.06};
}
function badge(ctx,W){
 ctx.fillStyle='rgba(0,0,0,.55)';ctx.fillRect(16,14,330,34);
 ctx.fillStyle='#fff8ea';ctx.fillText('A STYLISED ADAPTATION',28,37);
}
// Draw one full-frame paper-theatre background. Flat fills only so a fake
// context with save/restore/fillRect/beginPath/arc/fill/moveTo/lineTo/
// closePath/stroke/fillText can record it. Scenery fills the frame; text is
// never the main footage (optional small badge only).
export function drawPaperFrame(ctx,W=1280,H=720,setId='hearth',t=0,opts={}){
 const w=(typeof W==='number'&&W>0)?W:1280,h=(typeof H==='number'&&H>0)?H:720;
 const set=normalizePaperSet(setId),state=paperFrameState(set,t),caption=opts.caption!==false;
 ctx.save();
 if(set==='concert'){
  ctx.fillStyle='#1d1430';ctx.fillRect(0,0,w,h);
  ctx.fillStyle='#3a2563';ctx.fillRect(0,0,w,h*0.55);
  ctx.fillStyle='rgba(221,97,72,.35)';
  for(const a of state.beams){ctx.save();ctx.translate(w/2,40);ctx.rotate(a);ctx.fillRect(-60,0,120,h*0.7);ctx.restore();}
  ctx.fillStyle='#120c22';ctx.fillRect(0,h*0.62,w,h*0.38);
  ctx.fillStyle='#f4c95d';ctx.fillRect(w*0.1,h*0.34,w*0.8,14);
  ctx.fillStyle='#241a3f';ctx.fillRect(w*0.32,h*0.2,w*0.36,h*0.16);
  ctx.fillStyle='#f4c95d';ctx.fillRect(w*0.32,h*0.2,w*0.36,8);
  const tones=['#dd6148','#e8a2b0','#8fc1a9','#f4c95d','#7aa5d2'];
  state.crowd.forEach((c,i)=>{const cx=(c.x/w)*w;ctx.fillStyle=tones[i%tones.length];ctx.beginPath();ctx.arc(cx,c.y,34,0,Math.PI*2);ctx.fill();ctx.fillStyle='#241a3f';ctx.fillRect(cx-34,c.y+30,68,h-c.y);});
  ctx.fillStyle=`rgba(244,201,93,${0.35+0.4*state.pulse})`;ctx.beginPath();ctx.arc(w/2,h*0.28,26+10*state.pulse,0,Math.PI*2);ctx.fill();
 }else if(set==='station'){
  ctx.fillStyle='#2b3a4a';ctx.fillRect(0,0,w,h);
  ctx.fillStyle='#43586e';ctx.fillRect(0,0,w,h*0.5);
  ctx.fillStyle='#1e2a36';ctx.fillRect(0,h*0.42,w,h*0.12);
  for(let i=0;i<6;i++){ctx.fillStyle='#141d26';ctx.fillRect(i*(w/5)+20,h*0.2,40,h*0.22);}
  ctx.fillStyle='#5a7186';ctx.fillRect(0,h*0.54,w,10);
  ctx.fillStyle='#6e5c4a';ctx.fillRect(0,h*0.56,w,h*0.44);
  ctx.fillStyle='#8a7a5f';for(let i=0;i<16;i++)ctx.fillRect(i*(w/15),h*0.56+((i%2)*8),w/16-8,6);
  const ty=h*0.3;
  ctx.fillStyle='#31414f';state.smoke.forEach((s,i)=>{ctx.beginPath();ctx.arc(200+i*90+state.trainX*0.05,s.y,s.r,0,Math.PI*2);ctx.fill();});
  ctx.fillStyle='#a33327';ctx.fillRect(state.trainX,ty,480,110);
  ctx.fillStyle='#7c241c';ctx.fillRect(state.trainX,ty+90,480,20);
  ctx.fillStyle='#f4e3c2';for(let i=0;i<4;i++)ctx.fillRect(state.trainX+30+i*110,ty+20,80,50);
  ctx.fillStyle='#2b2b2b';ctx.beginPath();ctx.arc(state.trainX+90,ty+110,26,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(state.trainX+390,ty+110,26,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#f4c95d';ctx.fillRect(0,h*0.56-14,220,10);
 }else if(set==='workshop'){
  ctx.fillStyle='#4a3b2e';ctx.fillRect(0,0,w,h);
  ctx.fillStyle='#5d4c3a';ctx.fillRect(0,h*0.6,w,h*0.4);
  ctx.fillStyle='#382c22';ctx.fillRect(0,0,w,60);
  ctx.save();ctx.translate(w*0.5,60);ctx.rotate(state.lamp);ctx.fillStyle='#2b2118';ctx.fillRect(-4,0,8,70);ctx.fillStyle='#f4c95d';ctx.beginPath();ctx.arc(0,90,26,0,Math.PI*2);ctx.fill();ctx.restore();
  const gear=(cx,cy,r,ang,teeth)=>{ctx.save();ctx.translate(cx,cy);ctx.rotate(ang);ctx.fillStyle='#8a7a5f';for(let i=0;i<teeth;i++){ctx.rotate(Math.PI*2/teeth);ctx.fillRect(-8,-r-14,16,22);}ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fill();ctx.fillStyle='#4a3b2e';ctx.beginPath();ctx.arc(0,0,r*0.4,0,Math.PI*2);ctx.fill();ctx.restore();};
  gear(w*0.25,h*0.35,70,state.gearA,8);gear(w*0.42,h*0.42,48,state.gearB,6);
  ctx.fillStyle='#6e5c4a';ctx.fillRect(w*0.62,h*0.55,220,26);
  ctx.fillStyle='#382c22';ctx.fillRect(w*0.64,h*0.55,20,h*0.2);ctx.fillRect(w*0.76,h*0.55,20,h*0.2);
  ctx.save();ctx.translate(w*0.73,h*0.5);ctx.rotate(-0.5+state.hammer);ctx.fillStyle='#8a5a3b';ctx.fillRect(-8,-110,16,110);ctx.fillStyle='#5a5a5a';ctx.fillRect(-34,-134,68,28);ctx.restore();
  ctx.fillStyle='#a33327';ctx.beginPath();ctx.arc(w*0.13,h*0.68,30,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#31414f';ctx.fillRect(w*0.1,h*0.72,60,60);
 }else{
  ctx.fillStyle='#5a4632';ctx.fillRect(0,0,w,h);
  ctx.fillStyle='#6e5940';ctx.fillRect(0,0,w,h*0.62);
  ctx.fillStyle='#2e2620';ctx.fillRect(w*0.08,h*0.12,w*0.3,h*0.4);
  ctx.fillStyle='#1a2a3a';ctx.fillRect(w*0.08+14,h*0.12+14,w*0.3-28,h*0.4-28);
  ctx.fillStyle='#e8d9b0';ctx.beginPath();ctx.arc(w*0.23,h*0.3,30,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#7a4a3a';ctx.fillRect(w*0.55,h*0.35,w*0.34,h*0.4);
  ctx.fillStyle='#2b2b2b';ctx.fillRect(w*0.6,h*0.45,w*0.24,h*0.2);
  ctx.fillStyle='#a33327';
  state.flames.forEach((fh,i)=>{const fx=w*0.66+i*40;ctx.beginPath();ctx.moveTo(fx-16,h*0.62);ctx.lineTo(fx,h*0.62-fh);ctx.lineTo(fx+16,h*0.62);ctx.closePath();ctx.fill();});
  ctx.fillStyle='rgba(232,217,176,.5)';
  state.steam.forEach(s=>{ctx.beginPath();ctx.arc(w*0.85,h*0.5-s*h*0.3,10,0,Math.PI*2);ctx.fill();});
  ctx.save();ctx.translate(w*0.3,h*0.85);ctx.rotate(state.rock);ctx.fillStyle='#8a5a3b';ctx.fillRect(-90,-14,180,20);ctx.fillRect(-70,-90,16,80);ctx.fillRect(54,-90,16,80);ctx.restore();
  ctx.fillStyle='#f4c95d';ctx.beginPath();ctx.arc(w*0.85,h*0.2,24,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#3a2f24';ctx.fillRect(w*0.85-3,h*0.2+24,6,60);
 }
 ctx.restore();
 if(caption){ctx.save();ctx.font='15px sans-serif';badge(ctx,w);ctx.restore();}
 return state;
}
// Current film preferences stored on project.video.film and persisted with
// the existing onSave. Images, narration, approvals, and sources untouched.
export const NARRATION_MODES=['recordings','upload','silent'];
export function normalizeNarrationMode(mode){return NARRATION_MODES.includes(mode)?mode:'';}
export function filmSettings(project){
 const film=project&&project.video&&typeof project.video.film==='object'?project.video.film:{};
 const narration=film.narration&&typeof film.narration==='object'?film.narration:{};
 return {
  mode:normalizeFilmMode(film.mode),
  sceneSets:Array.isArray(film.sceneSets)?film.sceneSets.map(s=>normalizePaperSet(s||suggestPaperSet(''))):[],
  style:listStylePresets().includes(film.style)?film.style:'',
  subtitles:film.subtitles!==false,
  narration:{mode:normalizeNarrationMode(narration.mode),excluded:Array.isArray(narration.excluded)?narration.excluded.filter(id=>typeof id==='string'):[]},
 };
}
export function saveFilmSettings(project,patch={},onSave=()=>{}){
 if(!project||!project.video)throw Error('Review your event and create a current storyboard first.');
 if(!project.video.film||typeof project.video.film!=='object')project.video.film={};
 const film=project.video.film;
 if(patch.mode!==undefined)film.mode=normalizeFilmMode(patch.mode);
 if(patch.sceneSet!==undefined){
  const {index,value}=patch.sceneSet;
  if(!Number.isInteger(index)||index<0||!project.video.scenes[index])throw Error('Unknown scene.');
  if(!Array.isArray(film.sceneSets))film.sceneSets=[];
  film.sceneSets[index]=normalizePaperSet(value);
 }
 if(patch.sceneSets!==undefined&&Array.isArray(patch.sceneSets))film.sceneSets=patch.sceneSets.map(s=>normalizePaperSet(s));
 if(patch.style!==undefined)film.style=listStylePresets().includes(patch.style)?patch.style:'';
 if(patch.subtitles!==undefined)film.subtitles=patch.subtitles!==false;
 if(patch.narrationMode!==undefined){
  if(!NARRATION_MODES.includes(patch.narrationMode))throw Error('Choose a narration source: recordings, upload, or silent.');
  if(!film.narration||typeof film.narration!=='object')film.narration={};
  film.narration.mode=patch.narrationMode;
 }
 if(patch.narrationExcluded!==undefined){
  if(!Array.isArray(patch.narrationExcluded)||!patch.narrationExcluded.every(id=>typeof id==='string'))throw Error('Choose which recordings to exclude.');
  if(!film.narration||typeof film.narration!=='object')film.narration={};
  film.narration.excluded=[...new Set(patch.narrationExcluded)];
 }
 project.updatedAt=Date.now();onSave();return filmSettings(project);
}
// Gate a film render/export. Paper theatre needs no images; illustrated film
// needs a real image for every scene (missing/corrupt images block only image
// mode, never a black export). Both need a current storyboard, per-scene
// narrator approval, and final consent.
export function filmReadiness({stale=false,approvals=[],mode='paper',imagesReady=[],consent=false}={}){
 if(stale)return {ok:false,reason:'Review your event and create a current storyboard first.'};
 if(!Array.isArray(approvals)||!approvals.length||!approvals.some(Boolean)||!approvals.every(Boolean))return {ok:false,reason:'Approve each scene excerpt before creating the film.'};
 if(!consent)return {ok:false,reason:'Confirm you reviewed the script and have permission to use the media.'};
 if(normalizeFilmMode(mode)==='paper')return {ok:true};
 if(!Array.isArray(imagesReady)||!imagesReady.length||!imagesReady.every(Boolean))return {ok:false,reason:'Add an image for every scene first.'};
 return {ok:true};
}
// Join an original style preset with the narrator's own image directions.
// Generic descriptions only, never an artist imitation. 1000-char cap.
export function buildVisualNote(direction='',style=''){
 const preset=listStylePresets().includes(style)?STYLE_NOTES[style]:'';
 const parts=[preset,String(direction||'').trim()].filter(Boolean);
 return parts.join('; ').slice(0,1000);
}
// Reduced motion: movers freeze (t=0) while subtitle timing still advances.
export function shouldReduceMotion(env=globalThis){
 try{return env&&typeof env.matchMedia==='function'&&env.matchMedia('(prefers-reduced-motion: reduce)').matches===true;}catch{return false;}
}
export function motionTime(elapsed,reduced){return reduced?0:(typeof elapsed==='number'&&elapsed>=0?elapsed:0);}
