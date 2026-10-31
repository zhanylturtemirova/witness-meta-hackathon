import {answerRefs,sourcesChanged,validateAIResult} from './ai-contracts.js';
export function eventStale(p){return !p.event||p.event.sourceRefs.length!==p.answers.length||sourcesChanged(p.event.sourceRefs,p.answers);}
export function eventContentSignature(e){return JSON.stringify([e.title,e.summary,e.dateText,e.location,e.people,e.themes,e.detailsToConfirm,e.sourceRefs]);}
export function saveEvent(p,result,meta={}){
 validateAIResult('event',result,p.answers);
 const v=meta.verification;
 const verification=v&&v.status==='verified'?{status:'verified',attempts:v.attempts||1,verifier:v.verifier||'mock',content:eventContentSignature(result),answers:answerSignature(p.answers)}:null;
 p.event={...result,provider:meta.provider||'mock',model:meta.model||null,revision:(p.event?.revision||0)+1,confirmed:false,...(verification?{verification}:{})};
 p.updatedAt=Date.now();return p.event;
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
 p.event={...p.event,...fields,title,summary,revision:p.event.revision+1,confirmed:true,confirmedSources:answerRefs(p.answers)};p.updatedAt=Date.now();
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
