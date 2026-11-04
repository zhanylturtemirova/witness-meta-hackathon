import {imageCapability,generateSceneImage} from './scene-images.js';
import {listPaperSets,resolveSceneSet,suggestPaperSet,drawPaperFrame,buildVisualNote,filmReadiness,filmSettings,saveFilmSettings,motionTime,shouldReduceMotion} from './paper-theatre.js';
import {videoStale,approveSceneIllustration,sceneApprovalValid,sceneCaption,approveFilmLook,filmLookValid,sceneImageNeedsReview,acceptDependentImage,styleSignature,recordFilmExport,filmExportStale} from './event-model.js';
import {getRecordingMeta,recordingAnswer} from './domain.js';
import {mediaSave,mediaLoad,mediaDelete,MEDIA_IMAGES,MEDIA_RECORDINGS,MEDIA_FILMS} from './media-store.js';
import {createTelephoneChain} from './telephone.js';
const fmtDur=s=>typeof s!=='number'||!(s>=0)?'–':`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const newMediaId=()=>crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random().toString(36).slice(2);
export function splitVideoText(text,maxChars=190){
 const words=String(text||'').trim().split(/\s+/).filter(Boolean),pages=[];let page='';
 for(const word of words){for(let offset=0;offset<word.length;offset+=maxChars){const part=word.slice(offset,offset+maxChars);if(page&&page.length+part.length+1>maxChars){pages.push(page);page='';}page+=(page?' ':'')+part;}}
 if(page)pages.push(page);return pages;
}
export function videoCards(project,seconds=5){
 if(!project.video||videoStale(project))throw Error('Review your event and create a current storyboard first.');
 if(![3,5,8].includes(seconds))throw Error('Choose a reading pace.');
 const cards=[{label:'A WITNESS STORY',text:project.video.title,role:'title'}];
 for(const scene of project.video.scenes){
  for(const text of splitVideoText(scene.hostQuestion))cards.push({label:'THE QUESTION',text,role:'host',sourceRefs:scene.sourceRefs});
  for(const text of splitVideoText(sceneCaption(scene)))cards.push({label:'IN YOUR WORDS',text,role:'narrator',sourceRefs:scene.sourceRefs});
 }
 if(cards.length*seconds>180)throw Error('This script is too long for a three-minute clip. Choose a faster pace or a shorter storyboard.');
 return cards.map(c=>({...c,seconds}));
}
export function recordingType(isSupported){return ['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp8,opus','video/webm'].find(isSupported)||null;}
export function filmCards(project,seconds=5){
 videoCards(project,seconds); // Require current, narrator-approved sources.
 const cards=[{text:project.video.title,role:'title',scene:0,seconds:3}];
 project.video.scenes.forEach((scene,index)=>{for(const text of splitVideoText(sceneCaption(scene),150))cards.push({text,role:'narrator',scene:index,seconds,sourceRefs:scene.sourceRefs});});
 if(cards.reduce((n,c)=>n+c.seconds,0)>180)throw Error('This story is too long for a three-minute film. Choose a faster pace or a shorter script.');
 return cards;
}
export function filmFrame(cards,elapsed){
 let start=0;for(let i=0;i<cards.length;i++){if(elapsed<start+cards[i].seconds||i===cards.length-1)return {index:i,card:cards[i],local:Math.max(0,Math.min(cards[i].seconds,elapsed-start)),start};start+=cards[i].seconds;}
}
// Narration candidates: the story's own recordings whose answers appear in
// the approved storyboard, in scene order, each recording at most once.
// Recordings for other answers — or with no answer link — are never used.
export function filmNarrationCandidates(project){
 const scenes=project?.video?.scenes;
 if(!Array.isArray(scenes)||!scenes.length)return [];
 const answers=project.answers||[],recordings=project.recordings||[];
 const seen=new Set(),out=[];
 for(const scene of scenes){
  for(const ref of scene?.sourceRefs||[]){
   const answer=answers.find(a=>a.id===ref?.answerId);
   if(!answer)continue;
   for(const rec of recordings){
    if(!rec||seen.has(rec.id))continue;
    const linked=recordingAnswer(project,rec);
    if(linked&&linked.id===answer.id){seen.add(rec.id);out.push({id:rec.id,question:rec.question,durationSec:rec.durationSec,answerIndex:answers.indexOf(answer)});}
   }
  }
 }
 return out;
}
// Resolve the effective narration: the narrator's saved choice, or story
// recordings by default when any match the storyboard, else a silent film.
export function resolveFilmNarration(project){
 const candidates=filmNarrationCandidates(project);
 const prefs=filmSettings(project).narration;
 const mode=candidates.length?(prefs.mode||'recordings'):'silent';
 const excluded=new Set(prefs.excluded);
 return {mode,candidates,included:mode==='recordings'?candidates.map(c=>c.id).filter(id=>!excluded.has(id)):[]};
}
export const MAX_NARRATION_SECONDS=180;
// Schedule each included recording once, back to back from the start, at
// natural speed. Never loops, stretches, or invents speech.
export function planNarration(durations){
 if(!Array.isArray(durations))throw Error('Narration needs a list of recording lengths.');
 const offsets=[];let ms=0;
 for(const d of durations){
  if(typeof d!=='number'||!(d>=0))throw Error('A recording duration could not be read.');
  offsets.push(ms/1000);ms+=Math.round(d*1000);
 }
 const total=ms/1000;
 if(total>MAX_NARRATION_SECONDS)throw Error('Narration runs longer than three minutes. Exclude some recordings or choose a shorter upload.');
 return {offsets,total};
}
const escapeHTML=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function videoExportMarkup(project){const prior=filmSettings(project),narr=resolveFilmNarration(project);return `<section class="clip-maker" aria-labelledby="clip-heading"><p class="eyebrow">YOUR MEMORY, IN PICTURES</p><h2 id="clip-heading">A little <em>film.</em></h2><p>Scenes from your memory, with gentle programmed camera movement over illustrations and your words as subtitles. Illustrated characters do not move or speak; paper theatre moves programmed scenery instead. Paper theatre is free built-in scenery drawn in code; illustrated film uses your images. Generate scene illustrations with Meta or add your own images.</p><canvas id="clip-canvas" width="1280" height="720" role="img" aria-label="Preview of your memory film"></canvas><fieldset class="clip-modes"><legend>Film format</legend><label><input type="radio" name="clip-mode" value="paper"${prior.mode==='paper'?' checked':''}> Paper theatre · free</label><label><input type="radio" name="clip-mode" value="images"${prior.mode==='images'?' checked':''}> Illustrated film</label><p id="clip-mode-note" class="muted">${prior.mode==='paper'?'Paper theatre · free built-in scenery drawn in code. No uploads or image generation needed. A stylised adaptation.':'Illustrated film · needs a real image for every scene. Missing images block export, never a black screen.'}</p></fieldset><button id="clip-preview" class="text-button" type="button">Preview camera movement ▷</button><p id="clip-image-note" class="muted">Images illustrate your story; they are not evidence of what happened.</p><p id="clip-meta-info" class="muted">Checking Meta image access…</p><form id="clip-form"><fieldset id="clip-controls"><div class="clip-scenes">${project.video.scenes.map((scene,i)=>`<div class="clip-scene"><img id="clip-thumb-${i}" alt="Scene ${i+1} illustration" hidden><label for="clip-image-${i}">Scene ${i+1} · ${escapeHTML(scene.title)}</label><input id="clip-image-${i}" data-scene-image="${i}" type="file" accept="image/jpeg,image/png,image/webp"><small>${escapeHTML(scene.narratorText.slice(0,110))}…</small><label for="clip-caption-${i}">Caption · shown on screen</label><textarea id="clip-caption-${i}" data-scene-caption="${i}" rows="2" maxlength="500">${escapeHTML(sceneCaption(scene))}</textarea><p class="clip-approval" id="clip-approval-${i}" role="status"></p><button type="button" class="text-button" data-approve-scene="${i}">Approve this scene for illustration</button>${i===0?'<button type="button" class="text-button" data-approve-look>Use this look for the film</button>':`<button type="button" class="text-button" data-accept-image="${i}" hidden>Keep this image</button>`}<p class="clip-look" id="clip-look-${i}" role="status"></p><label for="clip-set-${i}">Animated set · paper theatre</label><select id="clip-set-${i}" data-paper-set="${i}">${listPaperSets().map(s=>`<option value="${s.id}"${resolveSceneSet(prior,i,scene.narratorText)===s.id?' selected':''}>${s.label} · ${s.hint}</option>`).join('')}</select><small>Suggested: ${suggestPaperSet(scene.narratorText)} · you choose</small><label for="clip-direction-${i}">Image directions · optional</label><textarea id="clip-direction-${i}" rows="2" maxlength="1000" placeholder="A detail or visual style to focus on"></textarea><button type="button" class="text-button" data-generate-scene="${i}" disabled>Generate scene ${i+1} with Meta</button><small id="clip-origin-${i}">No image yet</small><a id="clip-save-image-${i}" class="text-button" hidden download="witness-scene-${i+1}.png">Download image ↓</a></div>`).join('')}</div><div class="clip-inputs"><div><fieldset class="clip-narration"><legend>Narration · your original recordings</legend><label><input type="radio" name="clip-narr" value="recordings"${narr.mode==='recordings'?' checked':''}${narr.candidates.length?'':' disabled'}> Story recordings · <span id="clip-narr-count">${narr.included.length} of ${narr.candidates.length} included</span></label><div id="clip-narr-list">${narr.candidates.map(c=>{const n=(project.recordings||[]).findIndex(r=>r.id===c.id)+1;return `<div class="clip-narr-row"><label><input type="checkbox" data-narr-include="${c.id}"${narr.included.includes(c.id)?' checked':''}> Recording ${n} · ${fmtDur(c.durationSec)} · Answer ${c.answerIndex+1} · ${escapeHTML(String(c.question||'').slice(0,60))}</label><audio controls preload="none" data-narr-listen="${c.id}" aria-label="Listen to recording ${n}"></audio><small data-narr-note="${c.id}" hidden></small></div>`;}).join('')||'<p class="muted">No saved recordings match this storyboard. Record answers in the interview, or upload audio below.</p>'}</div><label><input type="radio" name="clip-narr" value="upload"${narr.mode==='upload'?' checked':''}> Uploaded audio instead</label><input id="clip-audio" type="file" accept="audio/*"><label><input type="radio" name="clip-narr" value="silent"${narr.mode==='silent'?' checked':''}> Silent film</label><p class="muted">Recordings play once each, in scene order, from the start. Scenes past the end of the audio stay silent with subtitles. Originals are never changed. Uploads: up to 3 minutes, 20 MB.</p></fieldset><label class="checkbox-label"><input id="clip-telephone" type="checkbox"> Telephone voice for narration · this export only</label><small>Baked into this film only. Your recording stays original.</small></div><div><label for="clip-pace">Subtitle pace</label><select id="clip-pace"><option value="3">3 seconds · quick</option><option value="5" selected>5 seconds · steady</option><option value="8">8 seconds · unhurried</option></select><small>Subtitle timing is approximate — titles are shown per scene, not synced to speech.</small><div><label for="clip-style">Image style preset · optional, original descriptions only</label><select id="clip-style"><option value="">No style preset</option><option value="paper-theatre"${prior.style==='paper-theatre'?' selected':''}>Paper theatre shapes</option><option value="ink"${prior.style==='ink'?' selected':''}>Ink lines</option><option value="storybook"${prior.style==='storybook'?' selected':''}>Storybook wash</option></select><small>Added to your per-scene directions when generating with Meta. Meta Muse Image returns an illustration only, never motion.</small></div><div><label class="checkbox-label"><input id="clip-subtitles" type="checkbox"${prior.subtitles!==false?' checked':''}> Show subtitles</label></div></div></div><label class="checkbox-label clip-consent"><input id="clip-approved" type="checkbox" required> I reviewed the script, and have permission to use the media I add.</label><button id="clip-create" class="button primary" type="submit">Create film ↓</button></fieldset><button id="clip-cancel" class="text-button" type="button" hidden>Cancel film</button></form><button id="clip-image-cancel" class="text-button" type="button" hidden>Cancel image request</button><p id="clip-status" role="status" aria-live="polite">Preparing your scenes…</p><div id="clip-result" hidden><video id="clip-playback" controls playsinline preload="metadata" aria-label="Your exported memory film" webkit-playsinline></video><a id="clip-download" class="button outline">Download film ↓</a><p id="clip-saved-note" class="muted" hidden></p><p class="muted">Scene images and this film stay saved with the story. Download the film to keep a copy outside this browser.</p></div></section>`;}
let cleanup=null;
export function unmountVideoExport(){cleanup?.();cleanup=null;}
// Record an illustration on its scene, keeping the reference link (if any)
// to the approved first-scene image it was guided by, plus the style
// signature it was guided under. Regenerating a scene replaces its own
// image and its guidance record; other scenes keep theirs.
export function recordSceneImage(project,index,{id,kind,provider,model,refFrom=null}={}){
 const scene=project?.video?.scenes[index];if(!scene||!id)throw Error('Unknown scene.');
 scene.image={id,kind,provider,model,createdAt:Date.now(),refFrom:refFrom||null};
 if(refFrom)scene.image.styleSig=styleSignature(project.video.styleSpec);
 return scene.image;
}
export function mountVideoExport(project,opts={}){
 unmountVideoExport();const form=document.querySelector('#clip-form');if(!form)return;
 const onSave=opts.onSave||(()=>{});
 const canvas=document.querySelector('#clip-canvas'),ctx=canvas.getContext('2d');
 const status=document.querySelector('#clip-status'),controls=document.querySelector('#clip-controls'),cancel=document.querySelector('#clip-cancel');
 const imageInputs=[...document.querySelectorAll('[data-scene-image]')],previewButton=document.querySelector('#clip-preview'),audioInput=document.querySelector('#clip-audio'),pace=document.querySelector('#clip-pace');
 const playback=document.querySelector('#clip-playback'),result=document.querySelector('#clip-result');
 let imageLive=false,imageController=null;
 let images=Array(project.video.scenes.length).fill(null),imageUrls=[],imageSeq=Array(project.video.scenes.length).fill(0),loading=0,previewTicker=null,outputUrl=null,recorder=null,stream=null,audioContext=null,audioSources=[],ticker=null,active=false,exporting=false,disposed=false;
  let film=filmSettings(project);const reducedMotion=shouldReduceMotion();
  const sceneExcerpt=i=>project.video.scenes[i]?.narratorText||'';
 const mime=typeof MediaRecorder!=='undefined'&&canvas.captureStream?recordingType(t=>MediaRecorder.isTypeSupported(t)):null;
 const stopResources=()=>{clearInterval(ticker);ticker=null;stream?.getTracks().forEach(t=>t.stop());stream=null;for(const s of audioSources){try{s.stop();}catch{}}audioSources=[];audioContext?.close().catch(()=>{});audioContext=null;};
 function imageLayer(image,position,alpha=1){
  if(!image)return;ctx.save();ctx.globalAlpha=alpha;
  const scale=Math.max(1280/image.naturalWidth,720/image.naturalHeight)*(1+0.09*position);
  const w=image.naturalWidth*scale,h=image.naturalHeight*scale;
  ctx.drawImage(image,(1280-w)/2+(position-.5)*18,(720-h)/2,w,h);ctx.restore();
 }
 function drawAt(cards,elapsed,duration){
  const frame=filmFrame(cards,elapsed),card=frame.card;
  let sceneStart=0,sceneDuration=0;
  for(let i=0;i<cards.length;i++){if(cards[i].scene<card.scene)sceneStart+=cards[i].seconds;if(cards[i].scene===card.scene)sceneDuration+=cards[i].seconds;}
  const position=Math.min(1,Math.max(0,(elapsed-sceneStart)/sceneDuration));
  if(film.mode==='paper')drawPaperFrame(ctx,1280,720,resolveSceneSet(film,card.scene,sceneExcerpt(card.scene)),motionTime(elapsed,reducedMotion),{caption:false});
   else{ctx.fillStyle='#26362d';ctx.fillRect(0,0,1280,720);imageLayer(images[card.scene],reducedMotion?0.5:position);}
  // A soft dissolve bridges scenes; movement continues across subtitle changes.
  if(film.mode!=='paper'&&card.scene>0&&elapsed-sceneStart<.8)imageLayer(images[card.scene-1],1,1-(elapsed-sceneStart)/.8);
  const shade=ctx.createLinearGradient(0,300,0,720);shade.addColorStop(0,'rgba(0,0,0,0)');shade.addColorStop(1,'rgba(0,0,0,.88)');ctx.fillStyle=shade;ctx.fillRect(0,300,1280,420);
  ctx.fillStyle='#fff8ea';ctx.font='bold 25px sans-serif';ctx.shadowColor='rgba(0,0,0,.6)';ctx.shadowBlur=6;ctx.fillText('witness.',50,55);
  ctx.font='15px sans-serif';const modeLabel=film.mode==='paper'?'PAPER THEATRE · A STYLISED ADAPTATION':'ILLUSTRATED MEMORY';ctx.fillText(modeLabel,film.mode==='paper'?872:1000,50);ctx.shadowBlur=0;
  if(film.subtitles!==false){ctx.font=(card.role==='title'?'43':'32')+'px Georgia, serif';
  const words=card.text.split(/\s+/).flatMap(word=>{const parts=[];let part='';for(const char of word){if(part&&ctx.measureText(part+char).width>1140){parts.push(part);part='';}part+=char;}if(part)parts.push(part);return parts;});
  const lines=[];let line='';for(const word of words){const candidate=line+(line?' ':'')+word;if(ctx.measureText(candidate).width>1140&&line){lines.push(line);line=word;}else line=candidate;}if(line)lines.push(line);
  let y=655-(lines.length-1)*43;ctx.fillStyle='#fffaf0';for(const line of lines){ctx.fillText(line,60,y);y+=43;}}
  ctx.fillStyle='#dd6148';ctx.fillRect(0,716,1280*Math.min(1,elapsed/duration),4);
 }
 function narrDom(){
  const resolved=resolveFilmNarration(project);
  const mode=document.querySelector('[name="clip-narr"]:checked')?.value||'silent';
  const checked=new Set([...document.querySelectorAll('[data-narr-include]:checked')].map(el=>el.dataset.narrInclude));
  const included=mode==='recordings'?resolved.candidates.map(c=>c.id).filter(id=>checked.has(id)):[];
  return {mode,candidates:resolved.candidates,included};
 }
 function syncNarrUI(){
  const {mode,candidates,included}=narrDom();
  const count=document.querySelector('#clip-narr-count');if(count)count.textContent=`${included.length} of ${candidates.length} included`;
  for(const box of document.querySelectorAll('[data-narr-include]'))box.disabled=mode!=='recordings'||exporting;
  audioInput.disabled=mode!=='upload'||exporting;
 }
 function narrSummary(){
  const {mode,included,candidates}=narrDom();
  if(mode==='recordings'){
   if(!included.length)return 'No recordings included — the film will be silent.';
   const total=included.reduce((n,id)=>n+(candidates.find(c=>c.id===id)?.durationSec||0),0);
   return `${included.length} ${included.length===1?'recording':'recordings'} · ${fmtDur(total)} of narration from the start.`;
  }
  if(mode==='upload')return audioInput.files?.length?'Your uploaded audio starts at the beginning.':'Choose an upload, or the film will be silent.';
  return 'Silent film.';
 }
 function hasNarrationInput(){const {mode,included}=narrDom();return mode==='recordings'&&included.length>0||mode==='upload'&&!!audioInput.files?.length;}
 function approvalText(i){
  if(videoStale(project))return 'Sources changed — review your event, then approve again.';
  if(sceneApprovalValid(project,i))return 'Scene and caption approved for illustration.';
  return 'Approve the scene above before generating.';
 }
 function refreshApprovals(){
  project.video.scenes.forEach((scene,i)=>{
   const label=document.querySelector('#clip-approval-'+i),approve=document.querySelector(`[data-approve-scene="${i}"]`),gen=document.querySelector(`[data-generate-scene="${i}"]`);
   if(label)label.textContent=approvalText(i);
   const valid=sceneApprovalValid(project,i);
   if(approve)approve.hidden=valid||videoStale(project);
   if(gen)gen.disabled=!imageLive||!valid||exporting||!!imageController||!!loading;
  });
  const look=document.querySelector('[data-approve-look]');
  if(look)look.hidden=filmLookValid(project)||videoStale(project)||project.video.scenes[0]?.image?.kind!=='meta';
  project.video.scenes.forEach((scene,i)=>{
   const line=document.querySelector('#clip-look-'+i);if(!line)return;
   if(i===0)line.textContent=!scene.image?'':scene.image.kind!=='meta'?'Uploads cannot guide later scenes — generate scene 1 with Meta for one shared look.':filmLookValid(project)?'This look guides later scenes.':'Approve this look to guide later scenes.';
   else{const flag=sceneImageNeedsReview(project,i);line.textContent=!flag.review?'':flag.reason==='style-changed'?'The shared style changed since this image was guided — review this image, it was kept as is.':flag.reason==='look-unapproved'?'Scene 1 changed — approve its look, then review this image.':'The approved look changed since this image was guided — review this image, it was kept as is.';const keep=document.querySelector(`[data-accept-image="${i}"]`);if(keep)keep.hidden=!flag.review||!filmLookValid(project);}
  });
 }
 function syncFilmControls(){
  const note=document.querySelector('#clip-mode-note');
  if(note)note.textContent=film.mode==='paper'?'Paper theatre · free built-in scenery drawn in code. No uploads or image generation needed. A stylised adaptation.':'Illustrated film · needs a real image for every scene. Missing images block export, never a black screen.';
 }
 async function persistSceneImage(index,blob,kind,provider,model,refFrom=null){
  const id=newMediaId();
  const saved=await mediaSave(MEDIA_IMAGES,{id,projectId:project.id,blob});
  recordSceneImage(project,index,{id,kind,provider,model,refFrom});
  onSave();return saved;
 }
 function stopPreview(){clearInterval(previewTicker);previewTicker=null;previewButton.textContent='Preview camera movement ▷';}
 function preview(){
  stopPreview();try{const cards=filmCards(project,Number(pace.value)),duration=cards.reduce((n,c)=>n+c.seconds,0);drawAt(cards,0,duration);
   const missing=film.mode==='paper'?0:images.filter(x=>!x).length,heard=hasNarrationInput();status.textContent=loading?'Opening scene images…':missing?`Add an image for each scene (${images.length-missing}/${images.length} ready).`:`${film.mode==='paper'?project.video.scenes.length+' paper-theatre scenes · built-in scenery, no uploads needed':images.length+' illustrated scenes'} · ${duration} seconds${heard?' minimum':''}. ${narrSummary()}${reducedMotion?' Motion reduced: still scenery, words still advance.':''} Export runs in real time.`;
   document.querySelector('#clip-create').disabled=!!missing||!!loading||!!imageController;previewButton.disabled=!!missing||!!loading||!!imageController;
  }catch(err){status.textContent=err.message;document.querySelector('#clip-create').disabled=true;previewButton.disabled=true;}
 }
 async function loadImage(index,url){
  const seq=++imageSeq[index];loading++;preview();const image=new Image();image.src=url;
  try{await image.decode();if(disposed||seq!==imageSeq[index])return;images[index]=image;const thumb=document.querySelector('#clip-thumb-'+index);thumb.src=url;thumb.hidden=false;document.querySelector('#clip-approved').checked=false;}
  catch{if(!disposed&&seq===imageSeq[index]){images[index]=null;document.querySelector('#clip-thumb-'+index).hidden=true;throw Error('This scene image could not be opened. Choose another JPEG, PNG, or WebP.');}}
  finally{loading--;if(!disposed)preview();}
 }
 if(!mime){controls.disabled=true;previewButton.disabled=true;status.textContent='Film export is not available in this browser. Try a recent Chrome, Edge, or Safari.';}
 else preview();
 for(const input of imageInputs)input.onchange=async()=>{
  const index=Number(input.dataset.sceneImage),file=input.files?.[0];if(!file)return;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024){input.value='';status.textContent='Choose a JPEG, PNG, or WebP image under 10 MB.';return;}
  const url=URL.createObjectURL(file);imageUrls.push(url);try{await loadImage(index,url);document.querySelector('#clip-origin-'+index).textContent='Your uploaded image';document.querySelector('#clip-save-image-'+index).hidden=true;const saved=await persistSceneImage(index,file,'upload','upload','');if(!saved.persistent)status.textContent=saved.error;refreshApprovals();}catch(err){status.textContent=err.message;}
 };
 const generationButtons=[...document.querySelectorAll('[data-generate-scene]')],imageCancel=document.querySelector('#clip-image-cancel');
 imageCapability().then(available=>{if(disposed)return;imageLive=available;document.querySelector('#clip-meta-info').textContent=available?'Meta Muse Image · one image per click, using your Meta API credits. Only the scene caption, your directions, the shared film style, and (for later scenes) the first illustration as reference are sent. Generated images are saved with this story.':'Meta image generation needs the local server with a configured API key and live AI enabled. You can still add your own images.';refreshApprovals();});
 for(const button of [...document.querySelectorAll('[data-approve-scene]')])button.onclick=()=>{try{approveSceneIllustration(project,Number(button.dataset.approveScene));onSave();refreshApprovals();status.textContent='Scene approved. You can generate its illustration.';}catch(err){status.textContent=err.message;}};
 for(const button of [...document.querySelectorAll('[data-approve-look]')])button.onclick=()=>{try{approveFilmLook(project);onSave();refreshApprovals();status.textContent='Look approved. Later scenes will reference this illustration.';}catch(err){status.textContent=err.message;}};
 for(const button of [...document.querySelectorAll('[data-accept-image]')])button.onclick=()=>{try{acceptDependentImage(project,Number(button.dataset.acceptImage));onSave();refreshApprovals();status.textContent='Image kept under the current look.';}catch(err){status.textContent=err.message;}};
 for(const area of [...document.querySelectorAll('[data-scene-caption]')])area.onchange=()=>{
  const index=Number(area.dataset.sceneCaption),scene=project.video.scenes[index],value=area.value.trim();
  const cited=(scene?.sourceRefs||[]).map(r=>project.answers.find(a=>a.id===r.answerId)?.text||'');
  if(!value||value.length>500||!cited.some(t=>t.includes(value))){area.value=sceneCaption(scene);status.textContent='Keep the caption to words from the approved source answer.';return;}
  scene.caption=value;onSave();refreshApprovals();document.querySelector('#clip-approved').checked=false;status.textContent='Caption saved. Approve the scene again to illustrate it.';
 };
 imageCancel.onclick=()=>imageController?.abort();
 for(const button of generationButtons)button.onclick=async()=>{
  if(!imageLive||imageController||exporting||loading)return;
  const index=Number(button.dataset.generateScene),controller=new AbortController();imageController=controller;stopPreview();playback.pause();result.hidden=true;controls.disabled=true;previewButton.disabled=true;imageCancel.hidden=false;
  document.querySelector('#clip-approved').checked=false;status.textContent=`Creating scene ${index+1} with Meta Muse Image… This can take up to two minutes.`;
  let message;
  try{
   const generated=await generateSceneImage(project,index,buildVisualNote(document.querySelector('#clip-direction-'+index).value,film.style),{signal:controller.signal});
   if(disposed||controller.signal.aborted)return;
   const url=URL.createObjectURL(generated.blob);imageUrls.push(url);await loadImage(index,url);if(disposed)return;
   document.querySelector('#clip-origin-'+index).textContent='Generated with Meta · '+generated.model+(generated.referenceId?' · references scene 1':'');
   const download=document.querySelector('#clip-save-image-'+index);download.href=url;download.hidden=false;
   const saved=await persistSceneImage(index,generated.blob,'meta',generated.provider,generated.model,generated.referenceId||null);
   message=saved.persistent?`Scene ${index+1} created with Meta Muse Image and saved with this story. Review the illustration before approving the film.`:`Scene ${index+1} created. ${saved.error||'Media storage is unavailable.'} Download a copy below.`;
  }catch(err){message=err.message;}
  finally{imageController=null;if(!disposed){controls.disabled=false;imageCancel.hidden=true;refreshApprovals();preview();status.textContent=message||'Image request cancelled. Meta may still finish processing it.';}}
 };
 previewButton.onclick=()=>{if(previewTicker){stopPreview();return;}const cards=filmCards(project,Number(pace.value)),duration=cards.reduce((n,c)=>n+c.seconds,0),start=performance.now();previewButton.textContent='Pause preview';previewTicker=setInterval(()=>drawAt(cards,((performance.now()-start)/1000)%duration,duration),1000/24);};
 pace.onchange=preview;
 audioInput.onchange=()=>{if(audioInput.files?.length){const radio=document.querySelector('[name="clip-narr"][value="upload"]');if(radio)radio.checked=true;film=saveFilmSettings(project,{narrationMode:'upload'},onSave);}syncNarrUI();preview();};
 for(const radio of document.querySelectorAll('[name="clip-narr"]'))radio.onchange=()=>{if(radio.checked){film=saveFilmSettings(project,{narrationMode:radio.value},onSave);syncNarrUI();preview();}};
 for(const box of document.querySelectorAll('[data-narr-include]'))box.onchange=()=>{const {candidates}=narrDom();const checked=new Set([...document.querySelectorAll('[data-narr-include]:checked')].map(el=>el.dataset.narrInclude));film=saveFilmSettings(project,{narrationExcluded:candidates.map(c=>c.id).filter(id=>!checked.has(id))},onSave);syncNarrUI();preview();};
 for(const radio of document.querySelectorAll('[name="clip-mode"]'))radio.onchange=()=>{if(radio.checked){film=saveFilmSettings(project,{mode:radio.value},onSave);syncFilmControls();preview();}};
 for(const sel of document.querySelectorAll('[data-paper-set]'))sel.onchange=()=>{film=saveFilmSettings(project,{sceneSet:{index:Number(sel.dataset.paperSet),value:sel.value}},onSave);preview();};
 document.querySelector('#clip-style').onchange=e=>{film=saveFilmSettings(project,{style:e.target.value},onSave);};
 document.querySelector('#clip-subtitles').onchange=e=>{film=saveFilmSettings(project,{subtitles:e.target.checked},onSave);preview();};
 const cancelExport=()=>{if(!active)return;active=false;if(recorder?.state!=='inactive')recorder?.stop();stopResources();if(!disposed){cancel.hidden=true;status.textContent='Film cancelled. Your story and script are unchanged.';}};
 cancel.onclick=cancelExport;
 form.onsubmit=async event=>{
  event.preventDefault();if(exporting||imageController||!mime||loading)return;
  const gate=filmReadiness({stale:videoStale(project),approvals:project.video.scenes.map((_,i)=>sceneApprovalValid(project,i)),mode:film.mode,imagesReady:images.map(x=>!!x),consent:!!document.querySelector('#clip-approved').checked});
  if(!gate.ok){status.textContent=gate.reason;return;}stopPreview();
  let cards;try{cards=filmCards(project,Number(pace.value));}catch(err){status.textContent=err.message;return;}
  playback.pause();previewButton.disabled=true;active=true;exporting=true;controls.disabled=true;cancel.hidden=false;result.hidden=true;syncNarrUI();let narrationBuffers=[],narrationOffsets=[],narrationTotal=0,telephoneApplied=false,telephoneFailed=false;
  try{
   const {mode:narrMode,included:narrIncluded}=narrDom(),buffers=[];
   const ensureContext=async()=>{if(!audioContext){audioContext=new AudioContext();await audioContext.resume();}};
   if(narrMode==='recordings'&&narrIncluded.length){
    for(const id of narrIncluded){
     const meta=getRecordingMeta(project,id),n=(project.recordings||[]).findIndex(r=>r.id===id)+1;
     if(!meta)throw Error(`Recording ${n} is no longer saved. Exclude it or choose a silent film.`);
     const record=await mediaLoad(MEDIA_RECORDINGS,id);
     if(!active||disposed)return;
     if(!record?.blob)throw Error(`Recording ${n} could not be opened in this browser. Exclude it or choose a silent film.`);
     await ensureContext();buffers.push(await audioContext.decodeAudioData(await record.blob.arrayBuffer()));
     if(!active||disposed)return;
    }
   }else if(narrMode==='upload'){
    const file=audioInput.files?.[0];
    if(file){if(file.size>20*1024*1024)throw Error('Choose an audio recording under 20 MB.');await ensureContext();buffers.push(await audioContext.decodeAudioData(await file.arrayBuffer()));if(!active||disposed)return;}
   }
   if(buffers.length){const plan=planNarration(buffers.map(b=>b.duration));narrationBuffers=buffers;narrationOffsets=plan.offsets;narrationTotal=plan.total;}
   const duration=Math.max(cards.reduce((n,c)=>n+c.seconds,0),narrationTotal);
   drawAt(cards,0,duration);stream=canvas.captureStream(24);
   if(narrationBuffers.length){const destination=audioContext.createMediaStreamDestination();const wantTelephone=!!document.querySelector('#clip-telephone')?.checked;let chain=null;if(wantTelephone){try{chain=createTelephoneChain(audioContext);chain.output.connect(destination);telephoneApplied=true;}catch{chain=null;telephoneFailed=true;}}for(const buffer of narrationBuffers){const source=audioContext.createBufferSource();source.buffer=buffer;if(chain)source.connect(chain.input);else source.connect(destination);audioSources.push(source);}for(const track of destination.stream.getAudioTracks())stream.addTrack(track);}
   const chunks=[];recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:2000000});
   const recorded=new Promise((resolve,reject)=>{recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onstop=()=>resolve(new Blob(chunks,{type:recorder.mimeType}));recorder.onerror=()=>reject(Error('Your browser could not record the video. Please try again.'));});
   recorder.start(1000);if(audioContext&&audioSources.length){const t0=audioContext.currentTime+0.05;audioSources.forEach((s,i)=>s.start(t0+(narrationOffsets[i]||0)));}const start=performance.now();
   ticker=setInterval(()=>{const elapsed=(performance.now()-start)/1000;drawAt(cards,elapsed,duration);status.textContent=`Creating film… ${Math.min(100,Math.floor(elapsed/duration*100))}% · ${Math.ceil(Math.max(0,duration-elapsed))}s remaining. Keep this tab open.`;if(elapsed>=duration&&recorder.state!=='inactive'){clearInterval(ticker);recorder.stop();}},1000/24);
   const blob=await recorded;if(!active||disposed)return;
   if(!blob.size)throw Error('The video is empty. Keep this tab visible and try again.');
   const previousFilm=project.video.filmExport?.id||null;
   if(previousFilm){try{await mediaDelete(MEDIA_FILMS,previousFilm);}catch{}}
   if(!active||disposed)return;
   const filmId=newMediaId();
   const filmSaved=await mediaSave(MEDIA_FILMS,{id:filmId,projectId:project.id,blob,mimeType:blob.type});
   recordFilmExport(project,{id:filmId,mimeType:blob.type,size:blob.size,durationSec:duration});
   onSave();
   if(outputUrl)URL.revokeObjectURL(outputUrl);outputUrl=URL.createObjectURL(blob);playback.poster=canvas.toDataURL('image/jpeg',0.85);playback.src=outputUrl;playback.load();playback.hidden=false;const link=document.querySelector('#clip-download');link.href=outputUrl;link.hidden=false;link.download=(project.video.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,60)||'witness-story')+(blob.type.includes('mp4')?'.mp4':'.webm');result.hidden=false;
   const savedNote=document.querySelector('#clip-saved-note');if(savedNote){savedNote.textContent=savedNoteText();savedNote.hidden=false;}
   status.textContent=`Your ${blob.type.includes('mp4')?'MP4':'WebM'} film is ready · ${(blob.size/1024/1024).toFixed(1)} MB. Play it below or download a copy.${filmSaved.persistent?' Saved with this story.':' Media storage is unavailable, so this film plays for this session only — download a copy.'}${telephoneApplied?' Narration uses the telephone voice.':telephoneFailed?' The telephone effect was unavailable, so narration stayed natural.':''}${blob.type.includes('mp4')?'':' If playback is blank in this browser, open the downloaded file in a video player.'}`;
  }catch(err){if(!disposed&&active)status.textContent=err.message;}
  finally{stopResources();exporting=false;if(!disposed){active=false;controls.disabled=false;previewButton.disabled=false;cancel.hidden=true;syncNarrUI();}}
 };
 function savedNoteText(){
  const f=project.video.filmExport;if(!f)return '';
  const when=f.createdAt?new Date(f.createdAt).toLocaleString('en',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
  const size=typeof f.size==='number'?` · ${(f.size/1024/1024).toFixed(1)} MB`:'';
  return `Saved film${when?` · exported ${when}`:''}${size}.${filmExportStale(project)?' The story changed since this export — create a new film to include the latest version.':''}`;
 }
 refreshApprovals();syncFilmControls();syncNarrUI();
 (async()=>{
  const {candidates}=narrDom();
  for(const c of candidates){
   if(disposed)return;
   const player=document.querySelector(`[data-narr-listen="${c.id}"]`);
   if(!player)continue;
   let record=null;try{record=await mediaLoad(MEDIA_RECORDINGS,c.id);}catch{}
   if(disposed)return;
   if(record?.blob){const url=URL.createObjectURL(record.blob);imageUrls.push(url);player.src=url;}
   else{
    const note=document.querySelector(`[data-narr-note="${c.id}"]`);
    if(note){note.textContent='Unavailable in this browser.';note.hidden=false;}
    const box=document.querySelector(`[data-narr-include="${c.id}"]`);if(box)box.checked=false;
    const checked=new Set([...document.querySelectorAll('[data-narr-include]:checked')].map(el=>el.dataset.narrInclude));
    film=saveFilmSettings(project,{narrationExcluded:candidates.map(x=>x.id).filter(id=>!checked.has(id))},onSave);
    if(!disposed){syncNarrUI();preview();}
   }
  }
 })();
 (async()=>{
  const saved=project.video.filmExport;
  if(!saved?.id)return;
  const record=await mediaLoad(MEDIA_FILMS,saved.id);
  if(disposed)return;
  const link=document.querySelector('#clip-download'),note=document.querySelector('#clip-saved-note');
  if(record?.blob){
   outputUrl=URL.createObjectURL(record.blob);playback.src=outputUrl;playback.load();playback.hidden=false;
   link.href=outputUrl;link.hidden=false;link.download=(project.video.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,60)||'witness-story')+(String(saved.mimeType||'').includes('mp4')?'.mp4':'.webm');
   result.hidden=false;if(note){note.textContent=savedNoteText();note.hidden=false;}
  }else{
   playback.hidden=true;link.hidden=true;result.hidden=false;
   if(note){note.textContent='The saved film is no longer available in this browser. Export again to save a new copy.';note.hidden=false;}
  }
 })();
 (async()=>{
  const pending=project.video.scenes.map((scene,i)=>scene.image?.id?{scene,i}:null).filter(Boolean);
  if(!pending.length)return;
  loading+=pending.length;preview();
  try{
   for(const {scene,i} of pending){
    if(disposed)return;
    const record=await mediaLoad(MEDIA_IMAGES,scene.image.id);
    if(disposed)return;
    if(record?.blob){
     const url=URL.createObjectURL(record.blob);imageUrls.push(url);
     try{await loadImage(i,url);document.querySelector('#clip-origin-'+i).textContent=scene.image.kind==='meta'?`Generated with Meta · ${scene.image.model}${scene.image.refFrom?' · uses a reference illustration':''}`:'Your uploaded image';if(scene.image.kind==='meta'){const download=document.querySelector('#clip-save-image-'+i);download.href=url;download.hidden=false;}}catch{}
    }else document.querySelector('#clip-origin-'+i).textContent='A saved image is unavailable in this browser.';
   }
  }finally{loading-=pending.length;if(!disposed){refreshApprovals();preview();}}
 })();
 cleanup=()=>{disposed=true;imageController?.abort();imageSeq=imageSeq.map(n=>n+1);stopPreview();cancelExport();stopResources();imageUrls.forEach(url=>URL.revokeObjectURL(url));if(outputUrl)URL.revokeObjectURL(outputUrl);playback.pause();playback.removeAttribute('src');};
}
