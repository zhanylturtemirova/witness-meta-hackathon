import {TOPICS,hasUncertainty} from './domain.js';
import {answerRefs,enoughMaterial,validateAIInput,validateAIResult} from './ai-contracts.js';
export const VIDEO_TONES=[{id:'warm',label:'Warm & personal'},{id:'documentary',label:'Documentary'},{id:'dramatic',label:'Dramatic'},{id:'humorous',label:'Light & humorous'}];
export const VIDEO_SETTINGS=[{id:'sunlit-studio',label:'A sunlit studio',direction:'A quiet, sunlit studio with warm natural light.'},{id:'garden',label:'A quiet garden',direction:'A sheltered garden with soft daylight and a simple seating area.'},{id:'tv-show',label:'A late-night TV set',direction:'A fictional late-night TV set with a conversation desk and a softly lit backdrop.'}];
export const VIDEO_HOSTS=[{id:'thoughtful',label:'A thoughtful listener'},{id:'curious',label:'A curious storyteller'},{id:'playful',label:'A playful interviewer'}];
const REFUSAL_RE=/\b(i('d| would) rather not|don'?t want to talk about|not comfortable|don'?t ask|leave that|pass on (this|that)|i('d| would) rather stop)\b/i;
// Explicit requests to finish close the interview with a statement, not the
// refusal's invitation to continue — finishing must never trigger another
// content question.
const FINISH_RE=/\b(i want to (stop|finish)|let'?s (stop|finish)|we can stop here|i'?m done|i am done|no more questions|that'?s all for now|stop asking)\b/i;
export function mockInterview(input){
 const ready=enoughMaterial(input),last=input.answers.at(-1),asked=input.answers.map(a=>a.question),used=new Set(input.askedIntents||[]);
 const candidates=[];
 if(!last)return {question:TOPICS.find(t=>t.id===input.topicId)?.opening||TOPICS[0].opening,intent:'opening',sourceRefs:[],enoughMaterial:false,suggestedNextStep:'continue'};
 const sourceRefs=[{answerId:last.id,revision:last.revision}];
 if(REFUSAL_RE.test(last.text))return {question:'Thank you for telling me. Would you like to remember something else instead, or shall we pause here?',intent:'wrap_up',sourceRefs,enoughMaterial:ready,suggestedNextStep:ready?'review_event':'continue'};
 if(FINISH_RE.test(last.text))return {question:'Thank you for sharing this. Your answers are saved, and you can review them whenever you are ready.',intent:'wrap_up',sourceRefs,enoughMaterial:ready,suggestedNextStep:ready?'review_event':'continue'};
 const text=input.answers.map(a=>a.text).join(' ');
 if(hasUncertainty(last))candidates.push(['clarify','You mentioned that some details are uncertain. Is there anything you want to clarify, or would you rather leave it as you remember it?']);
 if(/\b(sister|brother|mother|father|friend|grandmother|grandfather)\b/i.test(last.text))candidates.push(['people','You mentioned someone who was there. What do you remember about being with them in that moment?']);
 if(/\b(concert|music|song|band)\b/i.test(last.text))candidates.push(['detail','What is one sound, sight, or small detail from that day that you still remember?']);
 if(/\b(moved|moving|arrived|new city|new country)\b/i.test(text))candidates.push(['place','What do you remember about your first day in that place?']);
 candidates.push(['detail','Is there a small detail you would like this story to hold?'],['people','Who else was part of this experience, if anyone?'],['meaning','What did that experience mean to you at the time?'],['wrap_up','When you look back now, what feels most important to keep in this story?']);
 const candidate=candidates.find(([intent,q])=>!used.has(intent)&&!asked.includes(q))||['wrap_up','Is there anything else you want to add, or are you ready to take a look at your event?'];
 return {question:candidate[1],intent:candidate[0],sourceRefs,enoughMaterial:ready,suggestedNextStep:ready?'review_event':'continue'};
}
// Deterministic demo checks, not a semantic truth detector.
function approximateDates(answers){
 const dates=new Map();
 for(const a of answers)for(const match of a.text.matchAll(/\b(?:around|about|approximately|sometime in)\s+((?:19|20)\d{2})\b/gi))dates.set(match[1],match[0]);
 return dates;
}
export function mockVerifyEvent(candidate,answers){
 const issues=[];
 const text=answers.map(a=>a.text).join(' '),low=text.toLowerCase();
 const refs=answerRefs(answers),approx=approximateDates(answers);
 for(const field of ['dateText','title','summary']){
  const value=String(candidate[field]??'');
  for(const sentence of value.split(/(?<=[.!?])\s+/)){
   for(const year of approx.keys()){
    if(new RegExp('\\b'+year+'\\b').test(sentence)&&!hasUncertainty({text:sentence})){
     issues.push({field,statement:sentence.slice(0,2000),answerRefs:refs,reason:'certainty_overreach'});break;
    }
   }
  }
 }
 if(candidate.dateText&&!text.includes(candidate.dateText))issues.push({field:'dateText',statement:candidate.dateText,answerRefs:refs,reason:'invented_fact'});
 if(candidate.location&&!low.includes(String(candidate.location).toLowerCase()))issues.push({field:'location',statement:candidate.location,answerRefs:refs,reason:'invented_fact'});
 for(const person of candidate.people||[])if(!low.includes(String(person).toLowerCase()))issues.push({field:'people',statement:person,answerRefs:refs,reason:'invented_fact'});
 for(const field of ['title','summary']){
  for(const year of (String(candidate[field]||'').match(/\b(?:19|20)\d{2}\b/g)||[])){
   if(!text.includes(year)&&!issues.some(i=>i.field===field&&i.statement===year))issues.push({field,statement:year,answerRefs:refs,reason:'contradiction'});
  }
 }
 if(answers.some(hasUncertainty)&&!hasUncertainty({text:String(candidate.summary??'')})&&!issues.some(i=>i.field==='summary'&&i.reason==='certainty_overreach')){
  const statement=(String(candidate.summary).split(/(?<=[.!?])\s/)[0]||String(candidate.summary)).slice(0,2000);
  issues.push({field:'summary',statement,answerRefs:refs,reason:'certainty_overreach'});
 }
 return {supported:!issues.length,issues};
}
function mockRepairEvent(input){
 const base=input.repair.candidate;
 const candidate={...base,people:[...(base.people||[])],themes:[...(base.themes||[])],detailsToConfirm:[...(base.detailsToConfirm||[])]};
 for(const issue of input.repair.issues){
  if(issue.reason==='invented_fact'&&(issue.field==='dateText'||issue.field==='location')){
   if(candidate[issue.field]===issue.statement){candidate[issue.field]=null;candidate.detailsToConfirm.push(`Removed an unsupported ${issue.field==='dateText'?'date':'place'}.`);}
  }else if(issue.reason==='invented_fact'&&issue.field==='people'){
   candidate.people=candidate.people.filter(p=>p!==issue.statement);candidate.detailsToConfirm.push('Removed an unsupported name.');
  }else if(issue.reason==='certainty_overreach'&&issue.field==='summary'){
   // Use the actual answers instead of adding a generic disclaimer to a claim.
   candidate.summary=input.answers.map(a=>a.text).join('\n\n').slice(0,6000);
  }else if(issue.reason==='certainty_overreach'&&issue.field==='dateText'){
   const year=String(candidate.dateText).match(/\b(?:19|20)\d{2}\b/)?.[0];
   candidate.dateText=approximateDates(input.answers).get(year)||null;
  }else if(issue.reason==='certainty_overreach'&&issue.field==='title'){
   for(const [year,date] of approximateDates(input.answers))candidate.title=candidate.title.replace(new RegExp('\\b'+year+'\\b','g'),date);
  }else if(issue.reason==='contradiction'&&(issue.field==='dateText'||issue.field==='location')){
   candidate[issue.field]=null;candidate.detailsToConfirm.push(`Removed a ${issue.field==='dateText'?'date':'place'} that contradicts the answers.`);
  }
 }
 candidate.sourceRefs=answerRefs(input.answers);
 return candidate;
}
export function mockEvent(input){
 if(input.repair)return mockRepairEvent(input);
 const text=input.answers.map(a=>a.text).join(' '),first=input.answers[0].text;
 const date=text.match(/\b(?:(?:around|about|approximately|sometime in)\s+)?(?:19|20)\d{2}\b/i)?.[0]||null;
 const location=text.match(/\b(?:in|to|near)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/)?.[1]||null;
 const people=[...new Set((text.match(/\bmy (?:sister|brother|mother|father|friend|grandmother|grandfather|partner|daughter|son)\b/gi)||[]).map(s=>s.toLowerCase()))];
 const themes=[];if(/\b(concert|song|band|music)\b/i.test(text))themes.push('Live music');if(/\b(moved|moving|arrived|abroad)\b/i.test(text))themes.push('Starting over');if(people.length)themes.push('Relationships');if(!themes.length)themes.push('A personal memory');
 const detailsToConfirm=[];if(input.answers.some(hasUncertainty))detailsToConfirm.push('Some details are uncertain. Keep that uncertainty or clarify it in your answers.');if(!date)detailsToConfirm.push('No date was mentioned. You can leave it open.');if(!location)detailsToConfirm.push('No place was identified. You can leave it open.');
 return {title:input.title||'A memory worth keeping',summary:first.slice(0,Math.min(first.length,1200)),dateText:date,location,people,themes,detailsToConfirm,sourceRefs:answerRefs(input.answers)};
}
const STORY_BEATS=['Where it begins','Inside the memory','The turn','Looking back','What remains','The close'];
// Spread the interview (or its approved story order) across 4-6 chronological
// scenes. Answers shared by two scenes split into exact text halves so every
// caption stays a verbatim trim of its cited answer. Depicts lists stay empty:
// the mock claims no depicted people or places and asks nothing.
function splitCaption(text,parts,part){
 const clean=String(text||'').slice(0,500);
 if(parts<2||!clean.trim())return clean;
 let at=Math.round(clean.length*part/parts);
 if(part>0)while(at<clean.length&&clean[at]!==' ')at++;
 let end=Math.round(clean.length*(part+1)/parts);
 while(end<clean.length&&clean[end]!==' ')end++;
 return clean.slice(at,end).trim()||clean;
}
export function mockVideo(input){
 const setting=VIDEO_SETTINGS.find(s=>s.id===input.options.setting),tone=VIDEO_TONES.find(t=>t.id===input.options.tone).label,host=VIDEO_HOSTS.find(h=>h.id===input.options.host).label;
 const units=(Array.isArray(input.story)&&input.story.length?input.story.map(s=>input.answers.find(a=>a.id===s.sourceId)).filter(Boolean):input.answers);
 const list=units.length?units:input.answers,n=list.length,s=Math.min(6,Math.max(4,n));
 const pick=Array.from({length:s},(_,i)=>Math.floor(i*n/s));
 const scenes=pick.map((answerIndex,i)=>{
  const a=list[answerIndex],uses=pick.filter(x=>x===answerIndex).length,part=pick.slice(0,i).filter(x=>x===answerIndex).length;
  return {title:STORY_BEATS[i],hostQuestion:a.question,narratorText:a.text.slice(0,4000),visualDirection:`${setting.direction} ${host}. ${tone} tone. ${i===0?'Start with a wide shot of the fictional set.':'Use an unhurried conversation shot.'}`,caption:splitCaption(a.text,uses,part),visual:`${setting.direction} ${tone} tone.`,depictsPeople:[],depictsPlaces:[],seconds:5,openVisualQuestions:[],sourceRefs:[{answerId:a.id,revision:a.revision}]};
 });
 return {title:input.event.title,logline:'A conversation built from the interview answers you reviewed.',styleSpec:{palette:'muted ochre, honey, moss and warm cream, following the setting',technique:`hand-painted gouache with pencil hatching and visible grain, ${tone} tone, ${setting.label} staging`,characters:[],locations:[]},scenes};
}
export async function runMockTask(task,input){validateAIInput(task,input);const result=task==='interview'?mockInterview(input):task==='event'?mockEvent(input):task==='archivist'?mockArchivist(input):task==='editor'?mockEditor(input):mockVideo(input);return {provider:'mock',model:null,result:validateAIResult(task,result,input.answers)};}
const ARCHIVIST_CUES=[['Music memories',/\b(concert|music|song|band|gig)\b/i],['Moving and arrival',/\b(moved|moving|arrived|new city|new country|abroad)\b/i],['People',/\b(sister|brother|mother|father|friend|grandmother|grandfather|partner)\b/i]];
export function mockArchivist(input){
 const groups=[];
 const rest=[...input.answers];
 for(const [label,re] of ARCHIVIST_CUES){
  const mine=rest.filter(a=>re.test(a.text+' '+a.question));
  if(!mine.length)continue;
  for(const a of mine)rest.splice(rest.indexOf(a),1);
  groups.push({label,answerRefs:mine.map(a=>({answerId:a.id,revision:a.revision}))});
 }
 if(rest.length)groups.push({label:groups.length?'Other memories':'Memories',answerRefs:rest.map(a=>({answerId:a.id,revision:a.revision}))});
 return {groups};
}
function tidyProse(text){
 let out=text.replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
 if(out&&!/[.!?…]$/.test(out))out+='.';
 return out;
}
function keptPhrases(passage,answers){
 const low=answers.map(a=>a.text.toLowerCase()).join('\n');
 const found=[];
 for(const word of passage.match(/\b[a-z][a-z'-]{5,}\b/gi)||[]){
  const w=word.toLowerCase();
  if(w.length<=20&&low.includes(w)&&!found.some(f=>f.toLowerCase()===w))found.push(word);
  if(found.length>=5)break;
 }
 return found;
}
export function mockEditor(input){
 if(input.repair){
  const base=input.repair.candidate;
  let proposal=base.proposal;
  for(const issue of input.repair.issues){
   if(issue.field==='proposal'&&issue.statement&&proposal.includes(issue.statement))proposal=proposal.replace(issue.statement,'').replace(/[ \t]+/g,' ').trim();
  }
  return {proposal:tidyProse(proposal)||base.proposal,keptPhrases:keptPhrases(proposal,input.answers),sourceRefs:answerRefs(input.answers)};
 }
 const proposal=tidyProse(input.passage);
 return {proposal,keptPhrases:keptPhrases(proposal,input.answers),sourceRefs:answerRefs(input.answers)};
}
export function mockVerifyProse(candidate,answers){
 const issues=[];
 const text=answers.map(a=>a.text).join(' '),low=text.toLowerCase();
 const refs=answerRefs(answers),proposal=String(candidate.proposal??'');
 for(const year of proposal.match(/\b(?:19|20)\d{2}\b/g)||[]){
  if(!text.includes(year)&&!issues.some(i=>i.statement===year))issues.push({field:'proposal',statement:year,answerRefs:refs,reason:'contradiction'});
 }
 for(const name of proposal.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g)||[]){
  if(!low.includes(name.toLowerCase()))issues.push({field:'proposal',statement:name,answerRefs:refs,reason:'invented_fact'});
 }
 for(const year of approximateDates(answers).keys()){
  if(new RegExp('\\b'+year+'\\b').test(proposal)&&!hasUncertainty({text:proposal}))issues.push({field:'proposal',statement:year,answerRefs:refs,reason:'certainty_overreach'});
 }
 return {supported:!issues.length,issues};
}
// Weekly-draft checks mirror the prose checks over the narrative field.
// rangeText is recording-date metadata chosen by the application, not a
// claim in the answers, so it is never flagged here.
export function mockVerifyNarrative(candidate,answers){
 const issues=[];
 const text=answers.map(a=>a.text).join(' '),low=text.toLowerCase();
 const refs=answerRefs(answers),narrative=String(candidate.narrative??'');
 for(const year of narrative.match(/\b(?:19|20)\d{2}\b/g)||[]){
  if(!text.includes(year)&&!issues.some(i=>i.statement===year))issues.push({field:'narrative',statement:year,answerRefs:refs,reason:'contradiction'});
 }
 for(const name of narrative.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g)||[]){
  if(!low.includes(name.toLowerCase()))issues.push({field:'narrative',statement:name,answerRefs:refs,reason:'invented_fact'});
 }
 for(const year of approximateDates(answers).keys()){
  if(new RegExp('\\b'+year+'\\b').test(narrative)&&!hasUncertainty({text:narrative}))issues.push({field:'narrative',statement:year,answerRefs:refs,reason:'certainty_overreach'});
 }
 const title=String(candidate.title??'');
 for(const year of title.match(/\b(?:19|20)\d{2}\b/g)||[]){
  if(!text.includes(year)&&!issues.some(i=>i.field==='title'&&i.statement===year))issues.push({field:'title',statement:year,answerRefs:refs,reason:'contradiction'});
 }
 return {supported:!issues.length,issues};
}
function periodRangeText(input){
 const weekStart=typeof input.weekStart==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(input.weekStart)?input.weekStart:null;
 if(!weekStart)return 'A recent week';
 const start=new Date(weekStart+'T00:00:00Z').getTime();
 const day=ms=>new Intl.DateTimeFormat('en',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(ms));
 const year=new Intl.DateTimeFormat('en',{year:'numeric',timeZone:'UTC'}).format(new Date(start+6*86400000));
 return `${day(start)} – ${day(start+6*86400000)}, ${year}`;
}
function attributeParagraphs(narrative,answers){
 const paras=narrative.split(/\n\n+/).map(s=>s.trim()).filter(Boolean);
 return paras.map(pt=>{
  const owners=answers.filter(a=>a.text.includes(pt));
  return {paragraph:pt,sourceRefs:answerRefs(owners.length?owners:answers)};
 });
}
export function mockPeriod(input){
 if(input.repair){
  const base=input.repair.candidate;
  let title=base.title,narrative=base.narrative;
  for(const issue of input.repair.issues){
   if(issue.field==='title'&&issue.statement&&title.includes(issue.statement))title=title.replace(issue.statement,'').replace(/[ \t]+/g,' ').trim()||'A week worth keeping';
   if(issue.field==='narrative'&&issue.statement&&narrative.includes(issue.statement))narrative=narrative.replace(issue.statement,'').replace(/[ \t]+/g,' ').trim();
  }
  narrative=narrative||base.narrative;
  return {title,rangeText:base.rangeText,narrative,sourceRefs:answerRefs(input.answers),paragraphRefs:attributeParagraphs(narrative,input.answers)};
 }
 const narrative=input.answers.map(a=>a.text).join('\n\n').slice(0,20000);
 return {title:input.title||'A week worth keeping',rangeText:periodRangeText(input),narrative,sourceRefs:answerRefs(input.answers),paragraphRefs:attributeParagraphs(narrative,input.answers)};
}
export async function mockEventGenerate(input,repair){
 const inp=repair?{...input,repair}:input;
 validateAIInput('event',inp);
 return {provider:'mock',model:null,result:mockEvent(inp)};
}
export async function mockEventVerify(candidate,answers){
 return mockVerifyEvent(candidate,answers);
}
export async function mockEditorGenerate(input,repair){
 const inp=repair?{...input,repair}:input;
 validateAIInput('editor',inp);
 return {provider:'mock',model:null,result:mockEditor(inp)};
}
export async function mockEditorVerify(candidate,answers){
 return mockVerifyProse(candidate,answers);
}
export async function mockPeriodGenerate(input,repair){
 const inp=repair?{...input,repair}:input;
 validateAIInput('period',inp);
 return {provider:'mock',model:null,result:mockPeriod(inp)};
}
export async function mockPeriodVerify(candidate,answers){
 return mockVerifyNarrative(candidate,answers);
}
