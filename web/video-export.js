import {imageCapability,generateSceneImage} from './scene-images.js';
import {videoStale} from './event-model.js';
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
  for(const text of splitVideoText(scene.narratorText))cards.push({label:'IN YOUR WORDS',text,role:'narrator',sourceRefs:scene.sourceRefs});
 }
 if(cards.length*seconds>180)throw Error('This script is too long for a three-minute clip. Choose a faster pace or a shorter storyboard.');
 return cards.map(c=>({...c,seconds}));
}
export function recordingType(isSupported){return ['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp8,opus','video/webm'].find(isSupported)||null;}
export function filmCards(project,seconds=5){
 videoCards(project,seconds); // Require current, narrator-approved sources.
 const cards=[{text:project.video.title,role:'title',scene:0,seconds:3}];
 project.video.scenes.forEach((scene,index)=>{for(const text of splitVideoText(scene.narratorText,150))cards.push({text,role:'narrator',scene:index,seconds,sourceRefs:scene.sourceRefs});});
 if(cards.reduce((n,c)=>n+c.seconds,0)>180)throw Error('This story is too long for a three-minute film. Choose a faster pace or a shorter script.');
 return cards;
}
export function filmFrame(cards,elapsed){
 let start=0;for(let i=0;i<cards.length;i++){if(elapsed<start+cards[i].seconds||i===cards.length-1)return {index:i,card:cards[i],local:Math.max(0,Math.min(cards[i].seconds,elapsed-start)),start};start+=cards[i].seconds;}
}
const escapeHTML=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function videoExportMarkup(project){return `<section class="clip-maker" aria-labelledby="clip-heading"><p class="eyebrow">YOUR MEMORY, IN PICTURES</p><h2 id="clip-heading">A little <em>film.</em></h2><p>Scenes from your memory, with gentle camera movement and your words as subtitles. Generate scene illustrations with Meta or add your own images.</p><canvas id="clip-canvas" width="1280" height="720" role="img" aria-label="Preview of your illustrated memory film"></canvas><button id="clip-preview" class="text-button" type="button">Preview motion ▷</button><p id="clip-image-note" class="muted">Images illustrate your story; they are not evidence of what happened.</p><p id="clip-meta-info" class="muted">Checking Meta image access…</p><form id="clip-form"><fieldset id="clip-controls"><div class="clip-scenes">${project.video.scenes.map((scene,i)=>`<div class="clip-scene"><img id="clip-thumb-${i}" alt="Scene ${i+1} illustration" hidden><label for="clip-image-${i}">Scene ${i+1} · ${escapeHTML(scene.title)}</label><input id="clip-image-${i}" data-scene-image="${i}" type="file" accept="image/jpeg,image/png,image/webp"><small>${escapeHTML(scene.narratorText.slice(0,110))}…</small><label for="clip-direction-${i}">Image directions · optional</label><textarea id="clip-direction-${i}" rows="2" maxlength="1000" placeholder="A detail or visual style to focus on"></textarea><button type="button" class="text-button" data-generate-scene="${i}" disabled>Generate scene ${i+1} with Meta</button><small id="clip-origin-${i}">No image yet</small><a id="clip-save-image-${i}" class="text-button" hidden download="witness-scene-${i+1}.png">Download image ↓</a></div>`).join('')}</div><div class="clip-inputs"><div><label for="clip-audio">Your narration · optional</label><input id="clip-audio" type="file" accept="audio/*"><small>Up to 3 minutes, 20 MB. Starts with the film; subtitles use the pace below. Without audio, the film is silent.</small></div><div><label for="clip-pace">Subtitle pace</label><select id="clip-pace"><option value="3">3 seconds · quick</option><option value="5" selected>5 seconds · steady</option><option value="8">8 seconds · unhurried</option></select></div></div><label class="checkbox-label clip-consent"><input id="clip-approved" type="checkbox" required> I reviewed the images and words, and have permission to use the media I add.</label><button id="clip-create" class="button primary" type="submit">Create film ↓</button></fieldset><button id="clip-cancel" class="text-button" type="button" hidden>Cancel film</button></form><button id="clip-image-cancel" class="text-button" type="button" hidden>Cancel image request</button><p id="clip-status" role="status" aria-live="polite">Preparing your scenes…</p><div id="clip-result" hidden><video id="clip-playback" controls playsinline preload="metadata" aria-label="Your exported memory film" webkit-playsinline></video><a id="clip-download" class="button outline">Download film ↓</a><p class="muted">Download before leaving this page. Scene images, audio, and video previews are not saved with the story.</p></div></section>`;}
let cleanup=null;
export function unmountVideoExport(){cleanup?.();cleanup=null;}
export function mountVideoExport(project){
 unmountVideoExport();const form=document.querySelector('#clip-form');if(!form)return;
 const canvas=document.querySelector('#clip-canvas'),ctx=canvas.getContext('2d');
 const status=document.querySelector('#clip-status'),controls=document.querySelector('#clip-controls'),cancel=document.querySelector('#clip-cancel');
 const imageInputs=[...document.querySelectorAll('[data-scene-image]')],previewButton=document.querySelector('#clip-preview'),audioInput=document.querySelector('#clip-audio'),pace=document.querySelector('#clip-pace');
 const playback=document.querySelector('#clip-playback'),result=document.querySelector('#clip-result');
 let imageLive=false,imageController=null;
 let images=Array(project.video.scenes.length).fill(null),imageUrls=[],imageSeq=Array(project.video.scenes.length).fill(0),loading=0,previewTicker=null,outputUrl=null,recorder=null,stream=null,audioContext=null,audioSource=null,ticker=null,active=false,exporting=false,disposed=false;
 const mime=typeof MediaRecorder!=='undefined'&&canvas.captureStream?recordingType(t=>MediaRecorder.isTypeSupported(t)):null;
 const stopResources=()=>{clearInterval(ticker);ticker=null;stream?.getTracks().forEach(t=>t.stop());stream=null;try{audioSource?.stop();}catch{}audioSource=null;audioContext?.close().catch(()=>{});audioContext=null;};
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
  ctx.fillStyle='#26362d';ctx.fillRect(0,0,1280,720);imageLayer(images[card.scene],position);
  // A soft dissolve bridges scenes; movement continues across subtitle changes.
  if(card.scene>0&&elapsed-sceneStart<.8)imageLayer(images[card.scene-1],1,1-(elapsed-sceneStart)/.8);
  const shade=ctx.createLinearGradient(0,300,0,720);shade.addColorStop(0,'rgba(0,0,0,0)');shade.addColorStop(1,'rgba(0,0,0,.88)');ctx.fillStyle=shade;ctx.fillRect(0,300,1280,420);
  ctx.fillStyle='#fff8ea';ctx.font='bold 25px sans-serif';ctx.shadowColor='rgba(0,0,0,.6)';ctx.shadowBlur=6;ctx.fillText('witness.',50,55);
  ctx.font='15px sans-serif';ctx.fillText('ILLUSTRATED MEMORY',1000,50);ctx.shadowBlur=0;
  ctx.font=(card.role==='title'?'43':'32')+'px Georgia, serif';
  const words=card.text.split(/\s+/).flatMap(word=>{const parts=[];let part='';for(const char of word){if(part&&ctx.measureText(part+char).width>1140){parts.push(part);part='';}part+=char;}if(part)parts.push(part);return parts;});
  const lines=[];let line='';for(const word of words){const candidate=line+(line?' ':'')+word;if(ctx.measureText(candidate).width>1140&&line){lines.push(line);line=word;}else line=candidate;}if(line)lines.push(line);
  let y=655-(lines.length-1)*43;ctx.fillStyle='#fffaf0';for(const line of lines){ctx.fillText(line,60,y);y+=43;}
  ctx.fillStyle='#dd6148';ctx.fillRect(0,716,1280*Math.min(1,elapsed/duration),4);
 }
 function stopPreview(){clearInterval(previewTicker);previewTicker=null;previewButton.textContent='Preview motion ▷';}
 function preview(){
  stopPreview();try{const cards=filmCards(project,Number(pace.value)),duration=cards.reduce((n,c)=>n+c.seconds,0);drawAt(cards,0,duration);
   const missing=images.filter(x=>!x).length;status.textContent=loading?'Opening scene images…':missing?`Add an image for each scene (${images.length-missing}/${images.length} ready).`:`${images.length} illustrated scenes · ${duration} seconds${audioInput.files?.length?' minimum':''}. ${audioInput.files?.length?'Your audio starts at the beginning.':'Silent unless you add narration.'} Export runs in real time.`;
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
  const url=URL.createObjectURL(file);imageUrls.push(url);try{await loadImage(index,url);document.querySelector('#clip-origin-'+index).textContent='Your uploaded image';document.querySelector('#clip-save-image-'+index).hidden=true;}catch(err){status.textContent=err.message;}
 };
 const generationButtons=[...document.querySelectorAll('[data-generate-scene]')],imageCancel=document.querySelector('#clip-image-cancel');
 imageCapability().then(available=>{if(disposed)return;imageLive=available;document.querySelector('#clip-meta-info').textContent=available?'Meta Muse Image · one image per click, using your Meta API credits. Only this scene excerpt and your directions are sent. Download generated images before leaving.':'Meta image generation needs the local server with a configured API key and live AI enabled. You can still add your own images.';generationButtons.forEach(b=>b.disabled=!available||exporting||!!imageController);});
 imageCancel.onclick=()=>imageController?.abort();
 for(const button of generationButtons)button.onclick=async()=>{
  if(!imageLive||imageController||exporting||loading)return;
  const index=Number(button.dataset.generateScene),controller=new AbortController();imageController=controller;stopPreview();playback.pause();result.hidden=true;controls.disabled=true;previewButton.disabled=true;imageCancel.hidden=false;
  document.querySelector('#clip-approved').checked=false;status.textContent=`Creating scene ${index+1} with Meta Muse Image… This can take up to two minutes.`;
  let message;
  try{
   const generated=await generateSceneImage(project,index,document.querySelector('#clip-direction-'+index).value,{signal:controller.signal});
   if(disposed||controller.signal.aborted)return;
   const url=URL.createObjectURL(generated.blob);imageUrls.push(url);await loadImage(index,url);if(disposed)return;
   document.querySelector('#clip-origin-'+index).textContent='Generated with Meta · '+generated.model;
   const download=document.querySelector('#clip-save-image-'+index);download.href=url;download.hidden=false;
   message=`Scene ${index+1} created with Meta Muse Image. Review the illustration before approving the film.`;
  }catch(err){message=err.message;}
  finally{imageController=null;if(!disposed){controls.disabled=false;imageCancel.hidden=true;preview();status.textContent=message||'Image request cancelled. Meta may still finish processing it.';}}
 };
 previewButton.onclick=()=>{if(previewTicker){stopPreview();return;}const cards=filmCards(project,Number(pace.value)),duration=cards.reduce((n,c)=>n+c.seconds,0),start=performance.now();previewButton.textContent='Pause preview';previewTicker=setInterval(()=>drawAt(cards,((performance.now()-start)/1000)%duration,duration),1000/24);};
 pace.onchange=preview;audioInput.onchange=preview;
 const cancelExport=()=>{if(!active)return;active=false;if(recorder?.state!=='inactive')recorder?.stop();stopResources();if(!disposed){cancel.hidden=true;status.textContent='Film cancelled. Your story and script are unchanged.';}};
 cancel.onclick=cancelExport;
 form.onsubmit=async event=>{
  event.preventDefault();if(exporting||imageController||!mime||loading)return;if(images.some(x=>!x)){status.textContent='Add an image for every scene first.';return;}stopPreview();
  if(!document.querySelector('#clip-approved').checked){status.textContent='Review and approve the images and script first.';return;}
  let cards;try{cards=filmCards(project,Number(pace.value));}catch(err){status.textContent=err.message;return;}
  playback.pause();previewButton.disabled=true;active=true;exporting=true;controls.disabled=true;cancel.hidden=false;result.hidden=true;let narration=null;
  try{
   const file=audioInput.files?.[0];if(file){if(file.size>20*1024*1024)throw Error('Choose an audio recording under 20 MB.');audioContext=new AudioContext();await audioContext.resume();narration=await audioContext.decodeAudioData(await file.arrayBuffer());if(!active||disposed)return;if(narration.duration>180)throw Error('Choose an audio recording up to three minutes long.');}
   const duration=Math.max(cards.reduce((n,c)=>n+c.seconds,0),narration?.duration||0);
   drawAt(cards,0,duration);stream=canvas.captureStream(24);
   if(narration){const destination=audioContext.createMediaStreamDestination();audioSource=audioContext.createBufferSource();audioSource.buffer=narration;audioSource.connect(destination);for(const track of destination.stream.getAudioTracks())stream.addTrack(track);}
   const chunks=[];recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:2000000});
   const recorded=new Promise((resolve,reject)=>{recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onstop=()=>resolve(new Blob(chunks,{type:recorder.mimeType}));recorder.onerror=()=>reject(Error('Your browser could not record the video. Please try again.'));});
   recorder.start(1000);audioSource?.start();const start=performance.now();
   ticker=setInterval(()=>{const elapsed=(performance.now()-start)/1000;drawAt(cards,elapsed,duration);status.textContent=`Creating film… ${Math.min(100,Math.floor(elapsed/duration*100))}% · ${Math.ceil(Math.max(0,duration-elapsed))}s remaining. Keep this tab open.`;if(elapsed>=duration&&recorder.state!=='inactive'){clearInterval(ticker);recorder.stop();}},1000/24);
   const blob=await recorded;if(!active||disposed)return;
   if(!blob.size)throw Error('The video is empty. Keep this tab visible and try again.');
   if(outputUrl)URL.revokeObjectURL(outputUrl);outputUrl=URL.createObjectURL(blob);playback.poster=canvas.toDataURL('image/jpeg',0.85);playback.src=outputUrl;playback.load();const link=document.querySelector('#clip-download');link.href=outputUrl;link.download=(project.video.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,60)||'witness-story')+(blob.type.includes('mp4')?'.mp4':'.webm');result.hidden=false;
   status.textContent=`Your ${blob.type.includes('mp4')?'MP4':'WebM'} film is ready · ${(blob.size/1024/1024).toFixed(1)} MB. Play it below or download a copy.${blob.type.includes('mp4')?'':' If playback is blank in this browser, open the downloaded file in a video player.'}`;
  }catch(err){if(!disposed&&active)status.textContent=err.message;}
  finally{stopResources();exporting=false;if(!disposed){active=false;controls.disabled=false;previewButton.disabled=false;cancel.hidden=true;}}
 };
 cleanup=()=>{disposed=true;imageController?.abort();imageSeq=imageSeq.map(n=>n+1);stopPreview();cancelExport();stopResources();imageUrls.forEach(url=>URL.revokeObjectURL(url));if(outputUrl)URL.revokeObjectURL(outputUrl);playback.pause();playback.removeAttribute('src');};
}
