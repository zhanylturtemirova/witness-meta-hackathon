import {TOPICS,hasUncertainty} from './domain.js';
import {answerRefs,enoughMaterial,validateAIInput,validateAIResult} from './ai-contracts.js';
export const VIDEO_TONES=[{id:'warm',label:'Warm & personal'},{id:'documentary',label:'Documentary'},{id:'dramatic',label:'Dramatic'},{id:'humorous',label:'Light & humorous'}];
export const VIDEO_SETTINGS=[{id:'sunlit-studio',label:'A sunlit studio',direction:'A quiet, sunlit studio with warm natural light.'},{id:'garden',label:'A quiet garden',direction:'A sheltered garden with soft daylight and a simple seating area.'},{id:'tv-show',label:'A late-night TV set',direction:'A fictional late-night TV set with a conversation desk and a softly lit backdrop.'}];
export const VIDEO_HOSTS=[{id:'thoughtful',label:'A thoughtful listener'},{id:'curious',label:'A curious storyteller'},{id:'playful',label:'A playful interviewer'}];
export function mockInterview(input){
 const ready=enoughMaterial(input),last=input.answers.at(-1),asked=input.answers.map(a=>a.question),used=new Set(input.askedIntents||[]);
 const candidates=[];
 if(!last)return {question:TOPICS.find(t=>t.id===input.topicId)?.opening||TOPICS[0].opening,intent:'opening',sourceRefs:[],enoughMaterial:false,suggestedNextStep:'continue'};
 const sourceRefs=[{answerId:last.id,revision:last.revision}];
 const text=input.answers.map(a=>a.text).join(' ');
 if(hasUncertainty(last))candidates.push(['clarify','You mentioned that some details are uncertain. Is there anything you want to clarify, or would you rather leave it as you remember it?']);
 if(/\b(sister|brother|mother|father|friend|grandmother|grandfather)\b/i.test(last.text))candidates.push(['people','You mentioned someone who was there. What do you remember about being with them in that moment?']);
 if(/\b(concert|music|song|band)\b/i.test(last.text))candidates.push(['detail','What is one sound, sight, or small detail from that day that you still remember?']);
 if(/\b(moved|moving|arrived|new city|new country)\b/i.test(text))candidates.push(['place','What do you remember about your first day in that place?']);
 candidates.push(['detail','Is there a small detail you would like this story to hold?'],['people','Who else was part of this experience, if anyone?'],['meaning','What did that experience mean to you at the time?'],['wrap_up','When you look back now, what feels most important to keep in this story?']);
 const candidate=candidates.find(([intent,q])=>!used.has(intent)&&!asked.includes(q))||['wrap_up','Is there anything else you want to add, or are you ready to take a look at your event?'];
 return {question:candidate[1],intent:candidate[0],sourceRefs,enoughMaterial:ready,suggestedNextStep:ready?'review_event':'continue'};
}
export function mockEvent(input){
 const text=input.answers.map(a=>a.text).join(' '),first=input.answers[0].text;
 const date=text.match(/\b(?:(?:around|about|approximately|sometime in)\s+)?(?:19|20)\d{2}\b/i)?.[0]||null;
 const location=text.match(/\b(?:in|to|near)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/)?.[1]||null;
 const people=[...new Set((text.match(/\bmy (?:sister|brother|mother|father|friend|grandmother|grandfather|partner|daughter|son)\b/gi)||[]).map(s=>s.toLowerCase()))];
 const themes=[];if(/\b(concert|song|band|music)\b/i.test(text))themes.push('Live music');if(/\b(moved|moving|arrived|abroad)\b/i.test(text))themes.push('Starting over');if(people.length)themes.push('Relationships');if(!themes.length)themes.push('A personal memory');
 const detailsToConfirm=[];if(input.answers.some(hasUncertainty))detailsToConfirm.push('Some details are uncertain. Keep that uncertainty or clarify it in your answers.');if(!date)detailsToConfirm.push('No date was mentioned. You can leave it open.');if(!location)detailsToConfirm.push('No place was identified. You can leave it open.');
 return {title:input.title||'A memory worth keeping',summary:first.slice(0,Math.min(first.length,1200)),dateText:date,location,people,themes,detailsToConfirm,sourceRefs:answerRefs(input.answers)};
}
export function mockVideo(input){
 const setting=VIDEO_SETTINGS.find(s=>s.id===input.options.setting),tone=VIDEO_TONES.find(t=>t.id===input.options.tone).label,host=VIDEO_HOSTS.find(h=>h.id===input.options.host).label;
 const chosen=input.answers.length<=3?input.answers:[input.answers[0],input.answers[Math.floor(input.answers.length/2)],input.answers.at(-1)];
 const scenes=chosen.map((a,i)=>({title:['Where it begins','Inside the memory','Looking back'][i],hostQuestion:a.question,narratorText:a.text.slice(0,4000),visualDirection:`${setting.direction} ${host}. ${tone} tone. ${i===0?'Start with a wide shot of the fictional set.':'Use an unhurried conversation shot.'}`,sourceRefs:[{answerId:a.id,revision:a.revision}]}));
 return {title:input.event.title,logline:'A conversation built from the interview answers you reviewed.',scenes};
}
export async function runMockTask(task,input){validateAIInput(task,input);const result=task==='interview'?mockInterview(input):task==='event'?mockEvent(input):mockVideo(input);return {provider:'mock',model:null,result:validateAIResult(task,result,input.answers)};}
