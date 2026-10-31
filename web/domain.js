export const TOPICS = [
  { id:'turning-point', name:'A turning point', hint:'A choice, a new start, a different path.', icon:'↗', opening:'What is a moment that changed the direction of your life?' },
  { id:'person', name:'Someone who stayed with you', hint:'The people who made a difference.', icon:'✳', opening:'Who would you like to remember, and where does your story with them begin?' },
  { id:'small-moment', name:'An ordinary, unforgettable day', hint:'The little things that turned out to matter.', icon:'☼', opening:'Which ordinary day or small moment do you keep coming back to?' }
];
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
export function addAnswer(p,text) {
  if (!text.trim()) throw new Error('Write an answer first.');
  if(text.length>20000) throw new Error('Please keep each answer under 20,000 characters.');
  const answer={id:crypto.randomUUID(),question:nextQuestion(p),text:text.trim(),revision:1,history:[],uncertaintyReviewed:false,intent:p.interviewer?.intent||null,promptId:p.interviewer?.promptId||null};
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
  passage.text=a.text;passage.sourceText=a.text;passage.sourceRevision=a.revision;passage.edited=false;p.updatedAt=Date.now();
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
    && Number.isInteger(p.questionIndex) && p.questionIndex>=0 && Array.isArray(p.answers)
    && p.answers.every(a=>typeof a.id==='string'&&typeof a.text==='string'&&typeof a.question==='string'&&Number.isInteger(a.revision)&&Array.isArray(a.history))
    && (p.story===null || (p.story && typeof p.story.title==='string'&&Array.isArray(p.story.passages)
      &&p.story.passages.every(s=>typeof s.id==='string'&&typeof s.text==='string'&&typeof s.sourceText==='string'&&typeof s.question==='string'&&Number.isInteger(s.sourceRevision)&&p.answers.some(a=>a.id===s.sourceId))));
}
