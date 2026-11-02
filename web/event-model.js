import {answerRefs,sourcesChanged,validateAIResult,validateEventShape,validateRefs} from './ai-contracts.js';
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
export function saveVideo(p,result,options){if(!p.event?.confirmed||eventStale(p))throw Error('Review and confirm your event first.');validateAIResult('video',result,p.answers);p.video={...result,options,eventRevision:p.event.revision,sourceRefs:answerRefs(p.answers),sourceAnswers:p.answers.map(({id,revision,question,text})=>({id,revision,question,text}))};p.updatedAt=Date.now();}
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
 scene.illustrationApproval={excerpt:scene.narratorText,at:Date.now()};
 p.updatedAt=Date.now();return scene.illustrationApproval;
}
export function sceneApprovalValid(p,index){
 const scene=p.video?.scenes[index];
 return !!scene?.illustrationApproval&&!videoStale(p)&&scene.narratorText===scene.illustrationApproval.excerpt;
}
