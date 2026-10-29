import {answerRefs,sourcesChanged,validateAIResult} from './ai-contracts.js';
export function eventStale(p){return !p.event||p.event.sourceRefs.length!==p.answers.length||sourcesChanged(p.event.sourceRefs,p.answers);}
export function saveEvent(p,result){validateAIResult('event',result,p.answers);p.event={...result,revision:(p.event?.revision||0)+1,confirmed:false};p.updatedAt=Date.now();return p.event;}
export function confirmEvent(p,fields){
 if(eventStale(p))throw Error('Your answers changed. Rebuild the event before confirming it.');
 const title=fields.title.trim(),summary=fields.summary.trim();if(!title||!summary)throw Error('Give your event a title and a summary.');
 validateAIResult('event',{...p.event,...fields,title,summary},p.answers);
 p.event={...p.event,...fields,title,summary,revision:p.event.revision+1,confirmed:true,confirmedSources:answerRefs(p.answers)};p.updatedAt=Date.now();
}
export function saveVideo(p,result,options){if(!p.event?.confirmed||eventStale(p))throw Error('Review and confirm your event first.');validateAIResult('video',result,p.answers);p.video={...result,options,eventRevision:p.event.revision,sourceRefs:answerRefs(p.answers),sourceAnswers:p.answers.map(({id,revision,question,text})=>({id,revision,question,text}))};p.updatedAt=Date.now();}
export function videoStale(p){return !p.video||eventStale(p)||!p.event.confirmed||p.video.eventRevision!==p.event.revision||sourcesChanged(p.video.sourceRefs,p.answers);}
