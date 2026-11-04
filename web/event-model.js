import {answerRefs,sourcesChanged,validateAIResult,validateEventShape,validateRefs,validateStoryboard} from './ai-contracts.js';
export function eventStale(p){return !p.event||p.event.sourceRefs.length!==p.answers.length||sourcesChanged(p.event.sourceRefs,p.answers);}
export function eventStatus(p){if(!p.event)return null;if(!p.event.confirmed)return 'Draft';return eventStale(p)?'Needs review':'Confirmed';}
export function eventContentSignature(e){return JSON.stringify([e.title,e.summary,e.dateText,e.location,e.people,e.themes,e.detailsToConfirm,e.sourceRefs]);}
export function saveEvent(p,result,meta={}){
 validateAIResult('event',result,p.answers);
 const v=meta.verification;
 const verification=v&&v.status==='verified'?{status:'verified',attempts:v.attempts||1,verifier:v.verifier||'mock',content:eventContentSignature(result),answers:answerSignature(p.answers)}:null;
 p.event={...result,id:p.event?.id||findEntryByAnswers(p,result.sourceRefs.map(r=>r.answerId))?.id||crypto.randomUUID(),provider:meta.provider||'mock',model:meta.model||null,revision:(p.event?.revision||0)+1,confirmed:false,...(verification?{verification}:{})};
 p.updatedAt=Date.now();upsertCollectionEvent(p,p.event);return p.event;
}
export function upsertCollectionEvent(p,entry){
 if(!entry||typeof entry!=='object'||typeof entry.id!=='string'||!entry.id)throw Error('The collection entry is incomplete.');
 p.events=p.events||[];
 const stored={...entry};
 const i=p.events.findIndex(e=>e.id===stored.id);
 if(i>=0)p.events[i]=stored;else p.events.push(stored);
 p.updatedAt=Date.now();return stored;
}
export function findEntryByAnswers(p,answerIds){
 const want=[...answerIds].sort().join(',');
 return (p.events||[]).find(e=>(e.sourceRefs||[]).map(r=>r.answerId).sort().join(',')===want)||null;
}
export function acceptCollectionEvent(p,draft,meta={}){
 validateEventShape(draft);validateRefs(draft.sourceRefs,p.answers);
 const existing=findEntryByAnswers(p,draft.sourceRefs.map(r=>r.answerId));
 const entry={...draft,id:existing?.id||crypto.randomUUID(),provider:meta.provider||'mock',model:meta.model||null,revision:1,confirmed:false,verification:meta.verification||null};
 return upsertCollectionEvent(p,entry);
}
export function removeCollectionEvent(p,entryId){
 const i=(p.events||[]).findIndex(e=>e.id===entryId);
 if(i<0)return false;
 p.events.splice(i,1);p.updatedAt=Date.now();return true;
}
export function collectionEntryStale(entry,answers){return sourcesChanged(entry.sourceRefs||[],answers);}
export function entryStatus(entry,answers){if(!entry)return null;if(!entry.confirmed)return 'Draft';return collectionEntryStale(entry,answers)?'Needs review':'Confirmed';}
export function confirmCollectionEvent(p,id,fields,capture){
 const entry=(p.events||[]).find(e=>e.id===id);
 if(!entry)throw Error('This event is no longer in your collection.');
 if(capture!==eventContentSignature(entry))throw Error('This event changed. Reopen it before confirming.');
 if(collectionEntryStale(entry,p.answers))throw Error('Source answers changed. Find the events again before confirming this draft.');
 const next={...entry,title:String(fields.title||'').trim(),summary:String(fields.summary||'').trim(),dateText:String(fields.dateText||'').trim()||null,location:String(fields.location||'').trim()||null};
 validateEventShape(next);validateRefs(next.sourceRefs,p.answers);
 next.confirmed=true;next.revision=(entry.revision||0)+1;
 next.confirmedSources=next.sourceRefs.map(r=>({...r}));
 upsertCollectionEvent(p,next);
 // A single event covering the entire conversation can also drive its film.
 // A subset must not quietly replace another current event.
 if(p.event?.id===id||(!p.event&&next.sourceRefs.length===p.answers.length))p.event={...next};
 return next;
}
export function eventVerification(p){
 const v=p.event?.verification;
 if(!v||v.status!=='verified')return null;
 if(eventContentSignature(p.event)!==v.content)return null;
 if(answerSignature(p.answers)!==v.answers)return null;
 return v;
}
export function saveVerifiedEvent(p,capture,envelope){
 if(!envelope||envelope.verification?.status!=='verified'||!envelope.result)return false;
 if(eventGenerationStale(capture,p))return false;
 const v=envelope.verification;
 saveEvent(p,envelope.result,{provider:envelope.provider,model:envelope.model,verification:{status:'verified',attempts:v.attempts,verifier:v.verifier}});
 return true;
}
export function confirmEvent(p,fields){
 if(eventStale(p))throw Error('Your answers changed. Rebuild the event before confirming it.');
 const title=fields.title.trim(),summary=fields.summary.trim();if(!title||!summary)throw Error('Give your event a title and a summary.');
 validateAIResult('event',{...p.event,...fields,title,summary},p.answers);
 p.event={...p.event,...fields,title,summary,revision:p.event.revision+1,confirmed:true,confirmedSources:answerRefs(p.answers)};p.updatedAt=Date.now();upsertCollectionEvent(p,p.event);
}
export function saveVideo(p,result,options){if(!p.event?.confirmed||eventStale(p))throw Error('Review and confirm your event first.');validateStoryboard(result,p.answers);p.video={...result,options,eventRevision:p.event.revision,sourceRefs:answerRefs(p.answers),sourceAnswers:p.answers.map(({id,revision,question,text})=>({id,revision,question,text}))};p.updatedAt=Date.now();}
export function answerSignature(answers){return answers.map(a=>a.id+':'+a.revision).join(',');}
export function captureEventGeneration(p){return {signature:answerSignature(p.answers),eventRevision:p.event?.revision||0};}
export function eventGenerationStale(capture,p){
 if(!capture||typeof capture.signature!=='string')return true;
 if(answerSignature(p.answers)!==capture.signature)return true;
 if((p.event?.revision||0)!==(capture.eventRevision||0))return true;
 return false;
}
export function videoStale(p){return !p.video||eventStale(p)||!p.event.confirmed||p.video.eventRevision!==p.event.revision||sourcesChanged(p.video.sourceRefs,p.answers);}
export function approveSceneIllustration(p,index){
 if(videoStale(p)||!p.video?.scenes[index])throw Error('Review your event and create a current storyboard first.');
 const scene=p.video.scenes[index];
 scene.illustrationApproval={excerpt:scene.narratorText,caption:sceneCaption(scene),at:Date.now()};
 p.updatedAt=Date.now();return scene.illustrationApproval;
}
// The on-screen caption: the approved caption when the storyboard has one,
// otherwise the legacy narrator text.
export function sceneCaption(scene){return typeof scene?.caption==='string'&&scene.caption.trim()?scene.caption:scene?.narratorText||'';}
export function sceneApprovalValid(p,index){
 const scene=p.video?.scenes[index],approval=scene?.illustrationApproval;
 return !!approval&&!videoStale(p)&&scene.narratorText===approval.excerpt&&sceneCaption(scene)===(approval.caption??approval.excerpt);
}
// Explicit visual approval of the scene 1 illustration ("Use this look for
// the film"), separate from text-excerpt approval. Bound to the exact image
// version and the shared style it was approved under.
export function styleSignature(styleSpec){return JSON.stringify(styleSpec||null);}
export function approveFilmLook(p){
 const image=p.video?.scenes[0]?.image;
 if(videoStale(p)||!image||image.kind!=='meta'||!image.id)throw Error('Create the scene 1 illustration with Meta first.');
 p.video.scenes[0].visualApproval={imageId:image.id,styleSig:styleSignature(p.video.styleSpec),at:Date.now()};
 p.updatedAt=Date.now();return p.video.scenes[0].visualApproval;
}
export function filmLookValid(p){
 const scene=p.video?.scenes[0],approval=scene?.visualApproval;
 return !!approval&&!videoStale(p)&&scene.image?.kind==='meta'&&scene.image.id===approval.imageId&&approval.styleSig===styleSignature(p.video.styleSpec);
}
// Later Meta illustrations guided by the scene 1 look need a human review
// when they no longer match the currently approved look. Each dependent is
// compared by its own reference id and generation-time style signature, so
// approving a new reference never silently clears older images. Flags only;
// images are never deleted. A dependent stays flagged until the narrator
// explicitly keeps it under the current look or regenerates it.
export function sceneImageNeedsReview(p,index){
 const scene=p.video?.scenes[index];
 if(index<1||!scene?.image||scene.image.kind!=='meta'||!scene.image.refFrom)return {review:false,reason:null};
 const approval=p.video.scenes[0]?.visualApproval;
 if(!approval)return {review:true,reason:'no-approved-look'};
 const accepted=scene.image.lookAccepted;
 if(accepted&&accepted.imageId===approval.imageId&&accepted.styleSig===approval.styleSig&&filmLookValid(p))return {review:false,reason:null};
 if(scene.image.refFrom!==approval.imageId)return {review:true,reason:'reference-replaced'};
 if(scene.image.styleSig!==undefined&&scene.image.styleSig!==approval.styleSig)return {review:true,reason:'style-changed'};
 if(!filmLookValid(p))return {review:true,reason:'look-unapproved'};
 return {review:false,reason:null};
}
// The narrator reviewed a flagged dependent and keeps it as is under the
// current approved look. Look-bound: a later look change flags it again.
export function acceptDependentImage(p,index){
 const scene=p.video?.scenes[index];
 if(videoStale(p)||index<1||!scene?.image||scene.image.kind!=='meta'||!scene.image.refFrom)throw Error('Only a reference-guided illustration can be kept.');
 if(!filmLookValid(p))throw Error('Approve the current scene 1 look first.');
 const approval=p.video.scenes[0].visualApproval;
 scene.image.lookAccepted={imageId:approval.imageId,styleSig:approval.styleSig,at:Date.now()};
 p.updatedAt=Date.now();return scene.image.lookAccepted;
}
// Record an exported film on its storyboard so the player can be restored
// after navigation or reopening. Bytes live in the films media store; only
// small metadata and the source snapshot stay on the project.
export function recordFilmExport(p,{id,mimeType,size,durationSec}={}){
 if(!p?.video||!Array.isArray(p.video.scenes)||!p.video.scenes.length)throw Error('Review your event and create a current storyboard first.');
 if(typeof id!=='string'||!id||typeof mimeType!=='string'||!mimeType.startsWith('video/'))throw Error('The exported film could not be saved.');
 p.video.filmExport={id,mimeType,size:Number.isFinite(size)?size:null,durationSec:typeof durationSec==='number'&&durationSec>0?Math.round(durationSec*10)/10:null,createdAt:Date.now(),eventRevision:p.event?.revision||0,sourceSignature:answerSignature(p.answers||[]),images:p.video.scenes.map(s=>s.image?.id||null)};
 p.updatedAt=Date.now();return p.video.filmExport;
}
// A saved film is stale when its storyboard sources or scene images changed
// since export. Missing exports are not stale: there is nothing to restore.
export function filmExportStale(p){
 const f=p?.video?.filmExport;
 if(!f||!p?.video||!Array.isArray(p.video.scenes))return false;
 if((p.event?.revision||0)!==(f.eventRevision||0))return true;
 if(answerSignature(p.answers||[])!==f.sourceSignature)return true;
 const images=p.video.scenes.map(s=>s.image?.id||null);
 return images.length!==(f.images||[]).length||images.some((id,i)=>id!==f.images[i]);
}
