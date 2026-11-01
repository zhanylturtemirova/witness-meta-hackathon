// Weekly-story selection and proposal binding. Entries are grouped by their
// recording dates (when they were written) in an explicit IANA timezone.
// Historical event dates mentioned in the text never affect grouping: a
// childhood memory recorded this week belongs to this week's entries, while
// its event stays in childhood.
export const WEEK_TIMEZONES=['UTC','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Toronto','America/Sao_Paulo','Europe/London','Europe/Berlin','Europe/Moscow','Asia/Dubai','Asia/Kolkata','Asia/Singapore','Asia/Tokyo','Australia/Sydney','Pacific/Auckland'];
export function deviceTimeZone(){
 try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';}catch{return 'UTC';}
}
export function validTimeZone(tz){
 if(typeof tz!=='string'||!tz)return false;
 try{new Intl.DateTimeFormat('en',{timeZone:tz});return true;}catch{return false;}
}
// Local calendar date (YYYY-MM-DD) of an instant in the given timezone.
export function localDate(ms,timeZone){
 return new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
}
// Monday (YYYY-MM-DD) of the week containing the instant in the timezone.
export function weekStartISO(ms,timeZone){
 const [y,m,d]=localDate(ms,timeZone).split('-').map(Number);
 const day=Date.UTC(y,m-1,d);
 const mondayOffset=(new Date(day).getUTCDay()+6)%7;
 return new Date(day-mondayOffset*86400000).toISOString().slice(0,10);
}
export function weekRangeLabel(weekStart){
 const start=new Date(weekStart+'T00:00:00Z').getTime();
 const end=start+6*86400000;
 const day=ms=>new Intl.DateTimeFormat('en',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(ms));
 const year=new Intl.DateTimeFormat('en',{year:'numeric',timeZone:'UTC'}).format(new Date(end));
 return `${day(start)} – ${day(end)}, ${year}`;
}
export function entryDateLabel(ms,timeZone){
 return new Intl.DateTimeFormat('en',{weekday:'short',month:'short',day:'numeric',timeZone}).format(new Date(ms));
}
// Groups dated answers into weeks (newest first). Answers without a
// recording date are listed separately and cannot be selected by week.
export function groupAnswersByWeek(answers,timeZone){
 const weeks=new Map(),undated=[];
 for(const a of (answers||[])){
  if(!Number.isFinite(a.createdAt)){undated.push(a);continue;}
  const key=weekStartISO(a.createdAt,timeZone);
  if(!weeks.has(key))weeks.set(key,[]);
  weeks.get(key).push(a);
 }
 for(const list of weeks.values())list.sort((a,b)=>a.createdAt-b.createdAt);
 return {weeks:[...weeks.entries()].sort((a,b)=>a[0]<b[0]?1:-1),undated};
}
// A weekly proposal is bound to the exact project, week, timezone, and
// source answer revisions used for generation. Any source change
// invalidates it, both when the response arrives and when accepting.
export function captureWeeklyBinding(p,weekStart,timeZone,selectedIds){
 if(!Array.isArray(selectedIds)||!selectedIds.length)throw Error('Select at least one entry for the week.');
 const sourceRefs=selectedIds.map(id=>{
  const a=(p.answers||[]).find(a=>a.id===id);
  if(!a)throw Error('A selected entry is missing.');
  return {answerId:a.id,revision:a.revision};
 });
 return {projectId:p.id,weekStart,timeZone,selectedIds:[...selectedIds],sourceRefs};
}
export function weeklyBindingFresh(p,binding,selection){
 if(!binding||binding.projectId!==p.id)return false;
 if(selection){
  if(binding.weekStart!==selection.weekStart||binding.timeZone!==selection.timeZone)return false;
  const a=[...(binding.selectedIds||[])].sort().join(','),b=[...(selection.selectedIds||[])].sort().join(',');
  if(a!==b)return false;
 }
 if(!Array.isArray(binding.sourceRefs)||!binding.sourceRefs.length)return false;
 return binding.sourceRefs.every(r=>(p.answers||[]).some(a=>a.id===r.answerId&&a.revision===r.revision));
}
export function acceptWeeklyStory(p,story,binding,selection){
 if(typeof story?.narrative!=='string'||!story.narrative.trim())throw Error('The weekly story is empty.');
 if(!weeklyBindingFresh(p,binding,selection))return false;
 p.weekly=p.weekly||[];
 p.weekly.push({id:crypto.randomUUID(),weekStart:binding.weekStart,timeZone:binding.timeZone,title:story.title,rangeText:story.rangeText,narrative:story.narrative,sourceRefs:binding.sourceRefs.map(r=>({...r})),...(Array.isArray(story.paragraphRefs)?{paragraphRefs:story.paragraphRefs.map(e=>({paragraph:e.paragraph,sourceRefs:(e.sourceRefs||[]).map(r=>({...r}))}))}:{}),provider:story.provider||'mock',model:story.model||null,createdAt:Date.now()});
 p.updatedAt=Date.now();return true;
}
// Resolves the exact cited answer version: the current text when the
// revision matches, otherwise the preserved history entry. Answers keep
// every prior revision in history, so no separate snapshots are needed.
export function sourceVersionText(p,answerId,revision){
 const a=(p.answers||[]).find(a=>a.id===answerId);
 if(!a)return null;
 if(a.revision===revision)return {text:a.text,question:a.question,revision:a.revision,current:true};
 const h=(a.history||[]).find(h=>h.revision===revision);
 if(!h)return null;
 return {text:h.text,question:a.question,revision,current:false};
}
// Paragraphs with their own sources. Stories saved before paragraph
// sources existed fall back to the global source list per paragraph.
export function paragraphSources(story){
 const paras=String(story?.narrative||'').split(/\n\n+/).map(s=>s.trim()).filter(Boolean);
 const refs=Array.isArray(story?.paragraphRefs)&&story.paragraphRefs.length?[...story.paragraphRefs]:null;
 return paras.map(pt=>{
  const index=refs?refs.findIndex(e=>String(e.paragraph||'').trim()===pt):-1;
  const match=index>=0?refs.splice(index,1)[0]:null;
  return {paragraph:pt,sourceRefs:match?match.sourceRefs:(refs?[]:story.sourceRefs||[])};
 });
}
export function removeWeeklyStory(p,id){
 const i=(p.weekly||[]).findIndex(w=>w.id===id);
 if(i<0)return false;
 p.weekly.splice(i,1);p.updatedAt=Date.now();return true;
}
