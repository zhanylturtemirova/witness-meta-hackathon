export const TOPICS = [
  { id:'turning-point', name:'A turning point', hint:'A choice, a new start, a different path.', opening:'What is a moment that changed the direction of your life?' },
  { id:'person', name:'Someone who stayed with you', hint:'The people who made a difference.', opening:'Who would you like to remember, and where does your story with them begin?' },
  { id:'small-moment', name:'An ordinary, unforgettable day', hint:'The little things that turned out to matter.', opening:'Which ordinary day or small moment do you keep coming back to?' }
];
// Concrete first steps for someone who does not know where to begin.
// Each choice binds an exact opening question to the new conversation via
// the existing interviewer prompt path; choosing one makes no network call.
export const STARTER_CHOICES = [
 { id:'today', label:'Something from today', hint:'A small moment from the last day or so.', topic:'small-moment', question:'What stayed with you from today?' },
 { id:'person', label:'A person', hint:'Someone you keep thinking about.', topic:'person', question:'Who would you like to remember, and where does your story with them begin?' },
 { id:'place', label:'A place', hint:'Somewhere you can still picture.', topic:'small-moment', question:'Is there a place you keep coming back to in your memory? What do you remember about being there?' },
 { id:'first', label:'A first time', hint:'Something you did for the first time.', topic:'turning-point', question:'What is a first time you still remember clearly? What happened?' },
 { id:'unsure', label:'I’m not sure', hint:'Start with whatever is on your mind.', topic:'small-moment', question:'What is on your mind today? Even a small fragment is enough to begin.' }
];
export function starterChoice(id) {
 return STARTER_CHOICES.find(c=>c.id===id) || null;
}
const followups = [
  'Where were you, and what do you remember noticing around you?',
  'Who else was part of that moment? What do you remember about them?',
  'Is there a small detail you would like to keep in this story?',
  'What did that experience mean to you then?',
  'When you look back now, is there anything you see differently?',
  'Is there anything else you want this story to hold?'
];
export function newProject(topicId, customTitle='') {
  const topic = TOPICS.find(t=>t.id===topicId) || TOPICS[0];
  return { id:crypto.randomUUID(), title:customTitle.trim() || topic.name, topicId:topic.id,
    createdAt:Date.now(), updatedAt:Date.now(), answers:[], draft:'', questionIndex:0,
    story:null, example:false, stage:'interview' };
}
export function nextQuestion(p) {
  if(p.interviewer?.question)return p.interviewer.question;
  if (p.questionIndex===0) return TOPICS.find(t=>t.id===p.topicId)?.opening || TOPICS[0].opening;
  const previous = p.answers.at(-1)?.text || '';
  if (p.questionIndex===1 && /\b(move[ds]?|moving|arriv\w*|new city|new country)\b/i.test(previous))
    return 'What do you remember about your first day there?';
  if (p.questionIndex===1 && /\b(concert|music|song|band)\b/i.test(previous))
    return 'What is one sound, sight, or detail from that day that you can still remember?';
  if (p.questionIndex===1 && /\b(sister|brother|mother|father|friend|grandma|grandmother)\b/i.test(previous))
    return 'What do you remember about being with that person in that moment?';
  return followups[Math.min(p.questionIndex-1,followups.length-1)];
}
export function questionIdentity(p) {
  return JSON.stringify([(p.answers||[]).length,p.questionIndex||0,p.interviewer?.question||null,p.interviewer?.intent||null,p.interviewer?.promptId||null]);
}
export function recordingForCurrentQuestion(p) {
  const key = questionIdentity(p);
  return (p.recordings || []).find(r => r && r.questionKey === key) || null;
}
export function addAnswer(p,text) {
  if (!text.trim()) throw new Error('Write an answer first.');
  if(text.length>20000) throw new Error('Please keep each answer under 20,000 characters.');
  const answer={id:crypto.randomUUID(),question:nextQuestion(p),questionKey:questionIdentity(p),text:text.trim(),revision:1,history:[],uncertaintyReviewed:false,intent:p.interviewer?.intent||null,promptId:p.interviewer?.promptId||null,createdAt:Date.now()};
  p.answers.push(answer);p.interviewer=null; p.questionIndex++; p.draft=''; p.updatedAt=Date.now(); return answer;
}
export function setReviewDraft(p,id,text) {
  const a=p.answers.find(a=>a.id===id); if(!a) throw new Error('Answer not found.');
  if(typeof text!=='string') throw new Error('Draft is missing.');
  if(!p.reviewDrafts)p.reviewDrafts={};
  p.reviewDrafts[id]=text;
}
export function reviewDraft(p,id) { return p.reviewDrafts?.[id]; }
export function reviewText(p,a) { const d=p.reviewDrafts?.[a.id]; return typeof d==='string'?d:a.text; }
export const MAX_RECORDINGS_PER_STORY=20;
export function addRecordingMeta(p,meta) {
  if(!meta||typeof meta.id!=='string'||!meta.id)throw new Error('Recording is missing.');
  if(typeof meta.question!=='string'||!meta.question.trim())throw new Error('Recording is missing its question.');
  const recordings=p.recordings||[];
  if(recordings.some(r=>r.id===meta.id))throw new Error('Recording already saved.');
  if(recordings.length>=MAX_RECORDINGS_PER_STORY)throw new Error('This story already keeps 20 recordings. Discard one first.');
  const entry={id:meta.id,question:meta.question.slice(0,600),questionKey:typeof meta.questionKey==='string'?meta.questionKey:'',projectId:typeof meta.projectId==='string'&&meta.projectId?meta.projectId:p.id,createdAt:Number.isFinite(meta.createdAt)?meta.createdAt:Date.now(),durationSec:typeof meta.durationSec==='number'&&meta.durationSec>=0?Math.round(meta.durationSec*10)/10:null,transcript:typeof meta.transcript==='string'?meta.transcript.slice(0,20000):'',transcriptModel:typeof meta.transcriptModel==='string'?meta.transcriptModel.slice(0,120):''};
  p.recordings=[...recordings,entry];p.updatedAt=Date.now();return entry;
}
export function getRecordingMeta(p,id) { return (p.recordings||[]).find(r=>r.id===id)||null; }
export function recordingAnswer(p,recording) {
  if(!recording||typeof recording.questionKey!=='string'||!recording.questionKey)return null;
  return (p.answers||[]).find(a=>a.questionKey===recording.questionKey)||null;
}
export function removeRecordingMeta(p,id) {
  const before=(p.recordings||[]).length;
  p.recordings=(p.recordings||[]).filter(r=>r.id!==id);
  if(p.recordings.length!==before)p.updatedAt=Date.now();
  return p.recordings.length!==before;
}
export function setRecordingTranscript(p,id,text,model) {
  const r=getRecordingMeta(p,id);if(!r)throw new Error('Recording not found.');
  if(typeof text!=='string'||text.length>20000)throw new Error('Keep the transcript under 20,000 characters.');
  r.transcript=text;if(typeof model==='string')r.transcriptModel=model.slice(0,120);p.updatedAt=Date.now();return r;
}
export function setInterviewer(p,envelope) {
  if(!envelope||typeof envelope!=='object'||!envelope.result||typeof envelope.result.question!=='string') throw new Error('The interview response is incomplete.');
  p.interviewer={...envelope.result,provider:envelope.provider||'mock',model:envelope.model||null};
  p.updatedAt=Date.now(); return p.interviewer;
}
export function reviseAnswer(p,id,text) {
  const a=p.answers.find(a=>a.id===id); if(!a) throw new Error('Answer not found.');
  if(!text.trim()) throw new Error('An answer cannot be empty.');
  if(text.length>20000) throw new Error('Please keep each answer under 20,000 characters.');
  if(p.reviewDrafts)delete p.reviewDrafts[id];
  if(a.text!==text.trim()) {
    a.history.push({revision:a.revision,text:a.text}); a.text=text.trim(); a.revision++; a.uncertaintyReviewed=false;
    p.updatedAt=Date.now();
  }
  return a;
}
export function hasUncertainty(a) { return /\b(maybe|roughly|around|not sure|don.t remember|can.t remember|think it was|approximately|sometime)\b/i.test(a.text); }
export function createStory(p) {
  if(!p.answers.length) throw new Error('Add at least one answer first.');
  p.story={title:p.title,passages:p.answers.map(a=>({id:crypto.randomUUID(),text:a.text,sourceId:a.id,sourceRevision:a.revision,sourceText:a.text,question:a.question,edited:false}))};
  p.stage='story';p.updatedAt=Date.now();return p.story;
}
export function isStale(p,passage) { return p.answers.find(a=>a.id===passage.sourceId)?.revision !== passage.sourceRevision; }
export function refreshPassage(p,passageId) {
  const passage=p.story?.passages.find(x=>x.id===passageId); const a=p.answers.find(a=>a.id===passage?.sourceId);
  if(!passage||!a) throw new Error('Source not found.');
  passage.text=a.text;passage.sourceText=a.text;passage.sourceRevision=a.revision;passage.edited=false;delete passage.dismissedRevision;p.updatedAt=Date.now();
}
export function passageProposal(p,passage) {
  const a=p.answers.find(a=>a.id===passage?.sourceId);
  if(!passage||!a||a.revision===passage.sourceRevision||passage.dismissedRevision===a.revision)return null;
  return {answer:a,text:a.text};
}
export function dismissProposal(p,passageId) {
  const passage=p.story?.passages.find(x=>x.id===passageId); const a=p.answers.find(a=>a.id===passage?.sourceId);
  if(!passage||!a) throw new Error('Source not found.');
  passage.dismissedRevision=a.revision;p.updatedAt=Date.now();return passage;
}
// Editor proposals are bound to the exact project, passage text, and source
// answer revisions used for generation. Any change invalidates the binding,
// both when the response arrives and when the narrator accepts it.
export function captureEditorBinding(p,passageId,sourceRefs) {
  const passage=p.story?.passages.find(x=>x.id===passageId);
  if(!passage)throw new Error('Passage not found.');
  if(!Array.isArray(sourceRefs)||!sourceRefs.length||!sourceRefs.every(r=>typeof r.answerId==='string'&&Number.isInteger(r.revision)))throw new Error('A wording suggestion needs its source answers.');
  return {projectId:p.id,passageId:passage.id,passageText:passage.text,sourceRefs:sourceRefs.map(r=>({answerId:r.answerId,revision:r.revision}))};
}
export function editorBindingFresh(p,binding) {
  if(!binding||binding.projectId!==p.id)return false;
  const passage=p.story?.passages.find(x=>x.id===binding.passageId);
  if(!passage||passage.text!==binding.passageText)return false;
  if(!Array.isArray(binding.sourceRefs)||!binding.sourceRefs.length)return false;
  return binding.sourceRefs.every(r=>(p.answers||[]).some(a=>a.id===r.answerId&&a.revision===r.revision));
}
export function acceptEditorProposal(p,passageId,proposal,binding) {
  if(typeof proposal!=='string'||!proposal.trim())throw new Error('The wording suggestion is incomplete.');
  if(!editorBindingFresh(p,binding))return false;
  const passage=p.story.passages.find(x=>x.id===passageId);
  passage.text=proposal;passage.edited=true;p.updatedAt=Date.now();return true;
}
export function resumePoint(p) {
  const answers=(p.answers||[]).length;
  if(p.draft&&p.draft.trim())return {view:'interview',label:'Continue writing',detail:'Your draft is saved.'};
  if(!answers)return {view:'interview',label:'Answer the first question',detail:'Nothing written yet.'};
  const count=answers===1?'1 answer':`${answers} answers`;
  if(p.stage==='video'&&p.video)return {view:'video',label:'Continue your film',detail:`${count} · storyboard ready.`};
  if(p.stage==='story'&&p.story)return {view:'story',label:'Continue reading',detail:`${p.story.passages.length===1?'1 passage':`${p.story.passages.length} passages`}.`};
  if(p.stage==='review')return {view:'review',label:'Continue reviewing',detail:`${count}.`};
  return {view:'interview',label:'Continue the conversation',detail:`${count} so far.`};
}
export function needsContinue(p){
 return !p.story||!!(p.draft&&p.draft.trim());
}
export function eventSummary(p){
 if(!p.event)return null;
 return {id:typeof p.event.id==='string'&&p.event.id?p.event.id:null,title:p.event.title,dateText:p.event.dateText||null,location:p.event.location||null,confirmed:!!p.event.confirmed,projectId:p.id,projectTitle:p.story?.title||p.title};
}
export const HOME_QUESTIONS=[
 {topic:'small-moment',question:'What stayed with you from today?'},
 {topic:'small-moment',question:'What did breakfast look like when you were little?'},
 {topic:'person',question:'Who first made your work feel possible?'},
 {topic:'small-moment',question:'What do you remember about the first day somewhere new?'},
 {topic:'turning-point',question:'What is a small choice that changed an ordinary day?'},
 {topic:'person',question:'What is something someone once showed you how to do?'},
 {topic:'small-moment',question:'What sound takes you back to a particular room?'}
];
export function homeQuestion(offset=0,now=new Date()) {
  const localMidnight=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
  const index=((Math.floor(localMidnight/86400000)+offset)%HOME_QUESTIONS.length+HOME_QUESTIONS.length)%HOME_QUESTIONS.length;
  return HOME_QUESTIONS[index];
}
export function exportStory(p) {
  if(!p.story) throw new Error('Create a story first.');
  const notes=p.story.passages.map((s,i)=>`[${i+1}] Answer ${s.sourceId}, revision ${s.sourceRevision}${isStale(p,s)?' — source changed; passage needs review':''}\nQuestion: ${s.question}\nOriginal answer: ${s.sourceText}`);
  return `# ${p.story.title}\n\n${p.example?'Fictional example.\n\n':''}Assembled in Witness demo mode from the narrator's answers; passages may have been edited by the narrator.\n\n${p.story.passages.map((s,i)=>`${s.text} [${i+1}]`).join('\n\n')}\n\n---\n\n## Source notes\n\n${notes.join('\n\n')}\n`;
}
export function exampleProject() {
  const p=newProject('small-moment','The night we missed the last train');p.example=true;
  const answers=[
    'I went to a concert with my sister in Manchester. I think it was around 2018. We had not spent much time together that year, and she had a spare ticket.',
    'There was this moment when the lights went down and she grabbed my hand. I remember the floor sticking to my shoes and everyone singing louder than the band.',
    'We missed the last train home. We sat outside the station sharing a bag of chips, still humming the same song. For once, neither of us was looking at our phone.'
  ]; answers.forEach(text=>addAnswer(p,text));return p;
}
export function validProject(p) {
  return !!p && typeof p.id==='string' && typeof p.title==='string' && TOPICS.some(t=>t.id===p.topicId)
    && Number.isInteger(p.questionIndex) && p.questionIndex>=0 && Array.isArray(p.answers) && (!p.recordings||Array.isArray(p.recordings))
    && p.answers.every(a=>typeof a.id==='string'&&typeof a.text==='string'&&typeof a.question==='string'&&Number.isInteger(a.revision)&&Array.isArray(a.history))
    &&(!p.events||(Array.isArray(p.events)&&p.events.every(e=>e&&typeof e.id==='string'&&typeof e.title==='string')))
    &&(!p.weekly||(Array.isArray(p.weekly)&&p.weekly.every(w=>w&&typeof w.id==='string'&&typeof w.narrative==='string'&&(!w.paragraphRefs||Array.isArray(w.paragraphRefs)))))
    && (p.story===null || (p.story && typeof p.story.title==='string'&&Array.isArray(p.story.passages)
      &&p.story.passages.every(s=>typeof s.id==='string'&&typeof s.text==='string'&&typeof s.sourceText==='string'&&typeof s.question==='string'&&Number.isInteger(s.sourceRevision)&&p.answers.some(a=>a.id===s.sourceId))));
}
