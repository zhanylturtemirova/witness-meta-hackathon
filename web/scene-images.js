import {projectInput} from './ai-client.js';
import {videoStale,sceneApprovalValid,filmLookValid} from './event-model.js';
import {mediaLoad,MEDIA_IMAGES} from './media-store.js';
import {apiAuthHeaders,ensureApiToken} from './api-auth.js';
export async function imageCapability(fetcher=globalThis.fetch){
 try{const response=await fetcher('/api/ai-status',{cache:'no-store',signal:AbortSignal.timeout(5000)});return response.ok&&(await response.json()).imageLiveAvailable===true;}catch{return false;}
}
// One shared style line for every scene prompt: palette, technique, recurring
// people with appearance and clothing, recurring places. Text prompts guide
// the look; only the image reference below carries actual pixels.
export function renderStyleText(styleSpec){
 if(!styleSpec||typeof styleSpec!=='object')return '';
 const people=(styleSpec.characters||[]).map(c=>`${c.label} (${c.appearance}; wearing ${c.clothing})`).join('; ');
 const places=(styleSpec.locations||[]).map(l=>`${l.label}: ${l.description}`).join('; ');
 return [`Palette: ${styleSpec.palette||'warm muted colours'}`,`Technique: ${styleSpec.technique||'painterly illustration'}`,people?`People: ${people}`:'',places?`Places: ${places}`:''].filter(Boolean).join('\n').slice(0,1000);
}
function blobToDataURL(blob){
 return blob.arrayBuffer().then(bytes=>{
  const view=new Uint8Array(bytes);let binary='';
  for(let i=0;i<view.length;i+=8192)binary+=String.fromCharCode(...view.subarray(i,i+8192));
  return `data:${blob.type||'image/png'};base64,${btoa(binary)}`;
 });
}
// Scenes after the first reuse the first scene's approved Meta illustration as
// a visual reference through the image-editing endpoint. Consistent-style
// mode never proceeds without it: a missing, unreadable, or unapproved
// reference blocks generation here, before any paid request. Uploads can
// never become references.
async function loadReference(project,index){
 if(index<1)return {referenceImage:null,referenceId:null};
 const first=project.video?.scenes[0]?.image;
 if(!first||first.kind!=='meta'||!first.id)throw Error('Create the scene 1 illustration with Meta and choose “Use this look for the film” first. Later scenes need that approved look as their reference.');
 if(!filmLookValid(project))throw Error('The scene 1 look changed or was never approved. Choose “Use this look for the film” on the current scene 1 illustration first.');
 try{
  const record=await mediaLoad(MEDIA_IMAGES,first.id);
  if(!record?.blob||record.blob.size>8000000)throw Error('unreadable');
  return {referenceImage:await blobToDataURL(record.blob),referenceId:first.id};
 }catch{throw Error('The approved scene 1 illustration could not be opened. Regenerate scene 1, approve its look again, then retry this scene.');}
}
export async function generateSceneImage(project,index,visualNote='',{fetcher=globalThis.fetch,signal}={}){
 if(videoStale(project)||!project.video?.scenes[index])throw Error('Review your event and create a current storyboard first.');
 if(!sceneApprovalValid(project,index))throw Error('Approve this scene excerpt before generating its image.');
 const ref=await loadReference(project,index);
 const input={...projectInput(project),event:project.event,options:project.video.options,scene:project.video.scenes[index],visualNote,styleText:renderStyleText(project.video.styleSpec)};
 if(ref.referenceImage)input.referenceImage=ref.referenceImage;
 let response;
 await ensureApiToken();
 try{response=await fetcher('/api/ai/image',{method:'POST',headers:{'Content-Type':'application/json',...apiAuthHeaders()},body:JSON.stringify(input),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(130000)]):AbortSignal.timeout(130000)});}
 catch(err){throw Error(err?.name==='TimeoutError'?'Image generation took too long. No automatic retry was made.':signal?.aborted?'Image request cancelled. Meta may still finish processing it.':'The image server could not be reached. Your existing scene is unchanged.');}
 let data;try{data=await response.json();}catch{throw Error('The image server returned an unreadable response.');}
 if(!response.ok)throw Error(data.error||'The image could not be generated.');
 if(data.provider!=='meta'||data.model!=='muse-image-1.0'||data.mimeType!=='image/png'||typeof data.image!=='string'||data.image.length>14000000||!data.image.startsWith('iVBORw0KGgo')||!/^[A-Za-z0-9+/]+={0,2}$/.test(data.image))throw Error('The image server did not return a supported Meta image.');
 const raw=atob(data.image),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
 return {blob:new Blob([bytes],{type:data.mimeType}),provider:data.provider,model:data.model,usedReference:data.usedReference===true,referenceId:ref.referenceId};
}
