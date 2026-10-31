import {projectInput} from './ai-client.js';
import {videoStale} from './event-model.js';
export async function imageCapability(fetcher=globalThis.fetch){
 try{const response=await fetcher('/api/ai-status',{cache:'no-store',signal:AbortSignal.timeout(5000)});return response.ok&&(await response.json()).imageLiveAvailable===true;}catch{return false;}
}
export async function generateSceneImage(project,index,visualNote='',{fetcher=globalThis.fetch,signal}={}){
 if(videoStale(project)||!project.video?.scenes[index])throw Error('Review your event and create a current storyboard first.');
 let response;
 try{response=await fetcher('/api/ai/image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...projectInput(project),event:project.event,options:project.video.options,scene:project.video.scenes[index],visualNote}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(130000)]):AbortSignal.timeout(130000)});}
 catch(err){throw Error(err?.name==='TimeoutError'?'Image generation took too long. No automatic retry was made.':signal?.aborted?'Image request cancelled. Meta may still finish processing it.':'The image server could not be reached. Your existing scene is unchanged.');}
 let data;try{data=await response.json();}catch{throw Error('The image server returned an unreadable response.');}
 if(!response.ok)throw Error(data.error||'The image could not be generated.');
 if(data.provider!=='meta'||data.model!=='muse-image-1.0'||data.mimeType!=='image/png'||typeof data.image!=='string'||data.image.length>14000000||!data.image.startsWith('iVBORw0KGgo')||!/^[A-Za-z0-9+/]+={0,2}$/.test(data.image))throw Error('The image server did not return a supported Meta image.');
 const raw=atob(data.image),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
 return {blob:new Blob([bytes],{type:data.mimeType}),provider:data.provider,model:data.model};
}
