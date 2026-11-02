import {connectEventsFor} from './connect-events.js';
import {suggestedPrompt,promptOptions,useMemoryPrompt} from './memory-prompts.js';
import {mountVideoExport,unmountVideoExport} from './video-export.js';
import {witnessAI,projectInput,aiStatus} from './ai-client.js';
import {saveEvent,confirmEvent,eventStale,saveVideo,saveVerifiedEvent,captureEventGeneration,eventGenerationStale,answerSignature,acceptCollectionEvent,removeCollectionEvent,entryStatus,confirmCollectionEvent,eventContentSignature} from './event-model.js';
import {eventMarkup,videoMarkup} from './event-view.js';
import {connectMarkup,mountConnect,unmountConnect} from './connect.js';
import {voiceMarkup,mountVoice,voiceBusy,voicePendingSaves,leaveVoice,startVoiceCapture} from './voice.js';
import {INTERVIEW_FIXTURES,fixtureById,buildDemoProject,buildDemoStarter} from './demo-fixtures.js';
import {runArchivist} from './archivist.js';
import {sourcesChanged} from './ai-contracts.js';
import {WEEK_TIMEZONES,deviceTimeZone,validTimeZone,weekRangeLabel,entryDateLabel,groupAnswersByWeek,captureWeeklyBinding,weeklyBindingFresh,acceptWeeklyStory,removeWeeklyStory,sourceVersionText,paragraphSources} from './weekly.js';
import {questionSpeechMarkup,mountQuestionSpeech,unmountQuestionSpeech} from './question-speech.js';
import {storyAudioMarkup,mountStoryAudio,unmountStoryAudio} from './story-audio.js';
import {mediaDelete,MEDIA_RECORDINGS,MEDIA_IMAGES} from './media-store.js';
import {TOPICS,newProject,nextQuestion,addAnswer,reviseAnswer,hasUncertainty,createStory,isStale,refreshPassage,exportStory,exampleProject,validProject,setReviewDraft,reviewText,setInterviewer,resumePoint,passageProposal,dismissProposal,homeQuestion,needsContinue,captureEditorBinding,editorBindingFresh,acceptEditorProposal,STARTER_CHOICES,starterChoice} from './domain.js';
import {SAVED_KEY,LIKES_KEY,addQuote,removeQuote,purgeProjectQuotes,toggleLike,isLiked,loadCollection,storeCollection,validateStorySelection,cleanSelectionText} from './saved.js';
import {SHARED_STORIES} from './connect-data.js';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key='witness.stories.v1';let storageError='',loadError=false,lastSavedRaw=null,storageConflict=false;
let state={version:1,projects:[],active:null,view:'home',homeQuestionOffset:0};
let questionDismissed=false;
try {const raw=localStorage.getItem(key);lastSavedRaw=raw;if(raw){const data=JSON.parse(raw);if(data.version!==1||!Array.isArray(data.projects)||!data.projects.every(validProject))throw Error();state={...state,...data};let backfilled=false;for(const p of state.projects){if(p.event&&!p.event.id){p.event.id=crypto.randomUUID();backfilled=true;}if(p.event&&!p.events){p.events=[{...p.event}];backfilled=true;}}if(backfilled)save();}}
catch {storageError='Saved stories could not be opened. Download your saved data before resetting this browser.';loadError=true;}
// Saved phrases and on-device likes live under their own versioned keys and
// never touch the stories schema above.
let savedQuotes=[],likedStories=[],savedNotice='';
try {const r=loadCollection(localStorage,SAVED_KEY);savedQuotes=r.list;if(r.error)savedNotice=r.error;} catch {savedNotice='Your saved phrases could not be opened.';}
try {likedStories=loadCollection(localStorage,LIKES_KEY).list;} catch {likedStories=[];}
function persistSaved(){const err=storeCollection(localStorage,SAVED_KEY,savedQuotes);if(err){savedQuotes=loadCollection(localStorage,SAVED_KEY).list;savedNotice=err;throw Error(err);}return true;}
function persistLikes(){const err=storeCollection(localStorage,LIKES_KEY,likedStories);if(err){likedStories=loadCollection(localStorage,LIKES_KEY).list;throw Error(err);}}
// The shared story currently open in the Connect reading card, if any.
let openSharedStory=null;
let timer;
let aiSeq=0;
let aiMode={checked:false,liveAvailable:false};
let interviewFlow={phase:'idle',error:'',requestId:0,projectId:null,signature:''};
let eventFlow={phase:'idle',error:'',requestId:0,projectId:null,generation:null};
let archivistFlow={phase:'idle',error:'',requestId:0,projectId:null,drafts:[]};
let editorFlow={};
let weeklyFlow={phase:'idle',error:'',requestId:0,projectId:null,weekStart:null,timeZone:null,selectedIds:[],binding:null,proposal:null,issues:[],provider:null,model:null,editing:false,draftTitle:'',draftNarrative:'',aborter:null};
function weeklyState(p){
 if(weeklyFlow.projectId!==p.id||!weeklyFlow.timeZone){
  const tz=deviceTimeZone(),g=groupAnswersByWeek(p.answers,tz),newest=g.weeks.length?g.weeks[0][0]:null;
  weeklyFlow={phase:'select',error:'',requestId:0,projectId:p.id,weekStart:newest,timeZone:tz,selectedIds:newest?g.weeks[0][1].map(a=>a.id):[],binding:null,proposal:null,issues:[],provider:null,model:null,editing:false,draftTitle:'',draftNarrative:'',aborter:null};
 }
 return weeklyFlow;
}
function invalidatePending(){aiSeq++;if(interviewFlow.phase==='pending')interviewFlow={phase:'idle',error:'',requestId:0,projectId:null,signature:''};if(eventFlow.phase==='pending')eventFlow={phase:'idle',error:'',requestId:0,projectId:null,generation:null};if(archivistFlow.phase==='pending')archivistFlow={phase:'idle',error:'',requestId:0,projectId:null,drafts:[]};if(weeklyFlow.phase==='pending'){try{weeklyFlow.aborter?.abort();}catch{}weeklyFlow={phase:'idle',error:'',requestId:0,projectId:null,weekStart:null,timeZone:null,selectedIds:[],binding:null,proposal:null,issues:[],provider:null,model:null,editing:false,draftTitle:'',draftNarrative:'',aborter:null};}for(const k of Object.keys(editorFlow))if(editorFlow[k].phase==='pending')delete editorFlow[k];}
function interviewerNote(p){
 if(p?.interviewer?.provider==='prompt')return 'This question comes from a saved prompt. No model was called.';
 if(p?.interviewer?.provider==='meta')return 'Suggested live by Meta '+(p.interviewer.model||'muse-spark-1.3')+'.';
 if(p?.interviewer?.provider==='mock')return 'Suggested by a local preview. No model was called.';
 return aiMode.liveAvailable?'Questions use live AI when available, with a local preview as backup.':'Questions come from a local preview. Run the local server with a Meta key for live interviews.';
}
function eventNote(p){
 if(p?.event?.provider==='meta')return 'Drafted live by Meta '+(p.event.model||'muse-spark-1.3')+'.';
 if(p?.event)return 'Drafted by a local preview. No model was called.';
 return aiMode.liveAvailable?'Drafts use live AI when available, with a local preview as backup.':'Drafts use a local preview. No model is called.';
}
async function refreshAIMode(){try{const s=await aiStatus();aiMode={checked:true,liveAvailable:!!s.textLiveAvailable};}catch{aiMode={checked:true,liveAvailable:false};}const cp=current();const label=document.querySelector('#ai-mode-label');if(label)label.textContent=interviewerNote(cp);const tag=document.querySelector('#event-provider-tag');if(tag)tag.textContent=eventNote(cp);}
async function requestInterview(p,provider='auto'){
 const id=++aiSeq;
 interviewFlow={phase:'pending',error:'',requestId:id,projectId:p.id,signature:answerSignature(p.answers)};
 save();render();
 try{
  const res=await witnessAI.interview(projectInput(p),{provider});
  if(interviewFlow.requestId!==id||interviewFlow.projectId!==p.id||state.active!==p.id)return;
  if(answerSignature(p.answers)!==interviewFlow.signature){interviewFlow={phase:'idle',error:'',requestId:0,projectId:null,signature:''};save();render();return;}
  setInterviewer(p,res);interviewFlow={phase:'idle',error:'',requestId:0,projectId:null,signature:''};
  save();render();$('#answer-input')?.focus();$('#answer-form')?.scrollIntoView({block:'center',behavior:'smooth'});
 }catch(err){
  if(interviewFlow.requestId!==id||interviewFlow.projectId!==p.id)return;
  interviewFlow={phase:'error',error:err.message,requestId:id,projectId:p.id,signature:answerSignature(p.answers)};
  save();render();
 }
}
async function requestEvent(p,provider='auto'){
 const id=++aiSeq,capture=captureEventGeneration(p);
 eventFlow={phase:'pending',error:'',requestId:id,projectId:p.id,generation:capture};
 save();render();
 try{
  const env=await witnessAI.event(projectInput(p),{provider});
  if(eventFlow.requestId!==id||eventFlow.projectId!==p.id||state.active!==p.id)return;
  if(env.verification?.status!=='verified'){
   eventFlow={phase:'unresolved',error:'',requestId:id,projectId:p.id,generation:capture,rejected:env.rejected||null,issues:env.verification?.issues||[],attempts:env.verification?.attempts||0,verifier:env.verification?.verifier||'mock'};
   save();render();return;
  }
  if(!saveVerifiedEvent(p,eventFlow.generation,env)){const edited=(p.event?.revision||0)!==(eventFlow.generation?.eventRevision||0);eventFlow={phase:'idle',error:'',requestId:0,projectId:null,generation:null};save();render();if(edited)toast('Event changed during generation; kept your edits.');return;}
  eventFlow={phase:'idle',error:'',requestId:0,projectId:null,generation:null};
  save();render();
 }catch(err){
  if(eventFlow.requestId!==id||eventFlow.projectId!==p.id)return;
  eventFlow={phase:'error',error:err.message,requestId:id,projectId:p.id,generation:captureEventGeneration(p)};
  save();render();
 }
}
async function requestArchivist(p,provider='auto'){
 const id=++aiSeq,signature=answerSignature(p.answers);
 archivistFlow={phase:'pending',error:'',requestId:id,projectId:p.id,drafts:[],partial:null};
 save();render();
 try{
  const inp=projectInput(p);
  const run=await runArchivist(inp,{
   listGroups:async (input,opts)=>(await witnessAI.archivist(input,{provider,...opts})).result.groups,
   draftEvent:async (subset,g,opts)=>{
    const env=await witnessAI.event(subset,{provider,...opts});
    return {label:g.label,answerIds:g.answerRefs.map(r=>r.answerId),status:env.verification.status,event:env.result,rejected:env.rejected,issues:env.verification.issues,attempts:env.verification.attempts,provider:env.provider,model:env.model,verifier:env.verification.verifier};
   },
   shouldStop:()=>{
    if(archivistFlow.requestId!==id||archivistFlow.projectId!==p.id||state.active!==p.id)return 'cancelled';
    if(answerSignature(p.answers)!==signature)return 'stale';
    return null;
   }});
  if(archivistFlow.requestId!==id||archivistFlow.projectId!==p.id||state.active!==p.id)return;
  if(run.stopped==='cancelled')return;
  if(run.stopped==='stale'){archivistFlow={phase:'idle',error:'',requestId:0,projectId:null,drafts:[],partial:null};save();render();toast('Answers changed during extraction; nothing was kept.');return;}
  if((run.stopped==='timeout'||run.stopped==='budget')&&!run.drafts.length){archivistFlow={phase:'error',error:run.stopped==='timeout'?'Extraction took too long. Nothing was kept; you can run it again.':'The shared call budget ran out before any group was drafted. Nothing was kept.',requestId:id,projectId:p.id,drafts:[],partial:null};save();render();return;}
  archivistFlow={phase:'idle',error:'',requestId:id,projectId:p.id,drafts:run.drafts.map(d=>d.envelope),partial:run.stopped?{reason:run.stopped,completed:run.completedGroups,total:run.totalGroups}:null};
  save();render();
 }catch(err){
  if(archivistFlow.requestId!==id||archivistFlow.projectId!==p.id)return;
  archivistFlow={phase:'error',error:err.message,requestId:id,projectId:p.id,drafts:[],partial:null};
  save();render();
 }
}
async function requestEditor(p,passageId,provider='auto'){
 const id=++aiSeq;
 const s=p.story?.passages.find(x=>x.id===passageId),a=p.answers.find(a=>a.id===s?.sourceId);
 if(!s||!a)return;
 const answers=[{id:a.id,revision:a.revision,text:a.text,question:a.question}];
 const binding=captureEditorBinding(p,passageId,answers.map(a=>({answerId:a.id,revision:a.revision})));
 editorFlow[passageId]={phase:'pending',error:'',requestId:id,binding};
 save();render();
 try{
  const env=await witnessAI.editor({title:p.title,answers,passage:s.text},{provider});
  const flow=editorFlow[passageId];
  if(!flow||flow.requestId!==id||state.active!==p.id)return;
  if(!editorBindingFresh(p,flow.binding)){delete editorFlow[passageId];save();render();toast('Your words changed while the suggestion was written; it was dropped.');return;}
  if(env.verification?.status!=='verified'){
   editorFlow[passageId]={phase:'unresolved',error:'',requestId:id,binding:flow.binding,issues:env.verification?.issues||[],rejected:env.rejected||null,provider:env.provider,model:env.model};
  }else{
   editorFlow[passageId]={phase:'ready',error:'',requestId:id,binding:flow.binding,proposal:env.result.proposal,keptPhrases:env.result.keptPhrases||[],provider:env.provider,model:env.model};
  }
  save();render();
 }catch(err){
  const flow=editorFlow[passageId];
  if(!flow||flow.requestId!==id)return;
  editorFlow[passageId]={phase:'error',error:err.message,requestId:id};
  save();render();
 }
}
async function requestWeekly(p,provider='auto'){
 const flow=weeklyState(p);
 if(flow.projectId!==p.id||!flow.selectedIds.length||!flow.weekStart)return;
 const id=++aiSeq;
 const answers=flow.selectedIds.map(aid=>p.answers.find(a=>a.id===aid)).filter(Boolean);
 if(!answers.length)return;
 const binding=captureWeeklyBinding(p,flow.weekStart,flow.timeZone,flow.selectedIds);
 const aborter=new AbortController();
 Object.assign(weeklyFlow,{phase:'pending',error:'',requestId:id,projectId:p.id,binding,proposal:null,issues:[],aborter});
 save();render();
 try{
  const input={title:p.title,weekStart:flow.weekStart,timeZone:flow.timeZone,answers:answers.map(({id,revision,text,question,createdAt})=>({id,revision,text,question,recordedAt:Number.isFinite(createdAt)?new Date(createdAt).toISOString().slice(0,10):null}))};
  const env=await witnessAI.period(input,{provider,signal:aborter.signal});
  const f=weeklyFlow;
  if(!f||f.requestId!==id||f.projectId!==p.id||state.active!==p.id)return;
  if(!weeklyBindingFresh(p,f.binding,{weekStart:f.weekStart,timeZone:f.timeZone,selectedIds:f.selectedIds})){Object.assign(weeklyFlow,{phase:'select',error:'',requestId:0,proposal:null,issues:[],binding:null,aborter:null});save();render();toast('Your entries changed while the draft was written; it was dropped.');return;}
  if(env.verification?.status!=='verified'){
   Object.assign(weeklyFlow,{phase:'unresolved',error:'',requestId:id,issues:env.verification?.issues||[],proposal:null,provider:env.provider,model:env.model,aborter:null});
  }else{
   Object.assign(weeklyFlow,{phase:'ready',error:'',requestId:id,proposal:env.result,issues:[],provider:env.provider,model:env.model,editing:false,draftTitle:env.result.title,draftNarrative:env.result.narrative,aborter:null});
  }
  save();render();
 }catch(err){
  const f=weeklyFlow;
  if(!f||f.requestId!==id)return;
  Object.assign(weeklyFlow,{phase:'error',error:err.message,aborter:null});
  save();render();
 }
}
function paintStorageWarning(){
 const box=$('#storage-warning');if(box){box.hidden=false;box.innerHTML=esc(storageError)+(storageConflict?' <button data-action="backup-current">Download this tab’s draft</button> <button data-action="reload-latest">Reload saved version</button>':'');}
 const label=$('#save-label');if(label)label.textContent='Not saved — download a copy';
}
function checkStorageVersion(){
 if(localStorage.getItem(key)!==lastSavedRaw){storageConflict=true;storageError='Witness changed in another tab. This tab will not overwrite those changes. Download any draft here before reloading the saved version.';paintStorageWarning();}
 return !storageConflict;
}
function save(){
 if(loadError)return false;
 try{
  if(!checkStorageVersion())return false;
  const next=JSON.stringify(state);localStorage.setItem(key,next);lastSavedRaw=next;storageError='';
  const label=$('#save-label');if(label)label.textContent='Saved in this browser';return true;
 }catch{storageError='Your browser could not save this change. Keep this tab open and download your story before leaving.';paintStorageWarning();return false;}
}
function current(){return state.projects.find(p=>p.id===state.active);}
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('show');clearTimeout(timer);timer=setTimeout(()=>$('#toast').classList.remove('show'),3000);}
const arrow='<span aria-hidden="true">↗</span>';
const icons={home:'⌂'};
function wordCount(p){return(p.story?p.story.passages.map(x=>x.text):p.answers.map(x=>x.text)).join(' ').trim().split(/\s+/).filter(Boolean).length;}
function dateLabel(p){return new Intl.DateTimeFormat('en',{month:'short',day:'numeric'}).format(p.updatedAt);}
function go(view,id=state.active){if(voiceBusy()){toast('Stop the recording or wait for transcription before leaving.');return;}if(view!=='interview'||id!==state.active)leaveVoice();invalidatePending();state.view=view;state.active=id;if(current()&&['interview','review','story','video'].includes(view))current().stage=view;save();render();refreshAIMode();window.scrollTo({top:0});$('#main')?.focus({preventScroll:true});}
function sizeTextareas(){document.querySelectorAll('.passage-text, .story-title').forEach(el=>{el.style.height='auto';el.style.height=(el.scrollHeight+4)+'px';});}
window.addEventListener('resize',sizeTextareas);
function render(){
 unmountQuestionSpeech();
 unmountVideoExport();
 unmountConnect();
 unmountStoryAudio();
 const p=current();if(!['home','connect','saved'].includes(state.view)&&!p)state.view='home';
 $('#app').innerHTML=`<aside class="sidebar"><a class="brand" href="#" data-action="home" aria-label="Witness home"><img src="./mark.svg" alt="" width="34" height="34">witness<span class="brand-dot">.</span></a><nav aria-label="Main navigation"><button class="nav-item ${state.view==='home'?'active':''}" data-action="home"><span>${icons.home}</span> My space <span class="nav-count">${state.projects.length}</span></button><button class="nav-item ${state.view==='saved'?'active':''}" data-action="saved"><span aria-hidden="true">❧</span> Saved <span class="nav-count">${savedQuotes.length}</span></button><button class="nav-item nav-connect ${state.view==='connect'?'active':''}" data-action="connect" aria-label="Connect" aria-describedby="connect-nav-tip"><span class="nav-connect-icon" aria-hidden="true">◎</span><span class="nav-connect-copy"><strong>Connect</strong><small>Connect through your stories</small></span><span class="nav-tooltip" id="connect-nav-tip" role="tooltip"><strong>Connect through your stories</strong><span>Find people with experiences like yours.</span></span></button><button class="nav-item" data-action="new"><span>＋</span> New conversation</button></nav><div class="sidebar-bottom"><small>Private · stored on this device</small></div></aside>
 <div class="workspace"><header class="topbar"><span class="breadcrumb">My space <span>/</span> ${state.view==='home'?'My space':state.view==='connect'?'Connect':state.view==='saved'?'Saved':esc(p?.title)}</span><div class="topbar-right"><span class="save-state" id="save-label">${storageError?'Not saved — download a copy':'Saved in this browser'}</span><button class="about-button" data-action="about"><span aria-hidden="true">ⓘ</span> About</button></div></header>
 <div id="storage-warning" class="storage-warning" role="alert" ${storageError?'':'hidden'}>${esc(storageError)}</div>
 <main id="main" tabindex="-1">${state.view==='home'?home():state.view==='connect'?connectMarkup():state.view==='saved'?savedView():flow(p)}</main><footer class="footer"><span>Your stories stay in this browser.</span><span>No streaks. Nothing is due.</span></footer></div>
 <dialog id="modal" aria-labelledby="modal-title"><div id="modal-content"></div></dialog>`;
 sizeTextareas();
 if(state.view==='video'&&p?.video)mountVideoExport(p,{onSave:()=>save()});
 if(state.view==='story'&&p?.story)mountStoryAudio(p);
 if(state.view==='connect')mountConnect({selected:state.connectEvent,events:connectEventsFor(state.projects),onSelect:id=>{state.connectEvent=id;save();},onStory:s=>openConnectStory(s),onReview:id=>go('review',id)});
 if(state.view==='interview')mountVoice(p,{onNotify:toast,onSave:()=>save(),onRevisit:answerId=>{go('review');const t=document.querySelector('#edit-'+CSS.escape(answerId));if(t){t.scrollIntoView({block:'center'});t.focus({preventScroll:true});}},onApply:text=>{const input=$('#answer-input');const combined=[input.value.trim(),text].filter(Boolean).join('\n\n');if(combined.length>20000){toast('This answer is too long. Shorten it before adding the transcript.');return false;}input.value=combined;p.draft=combined;save();return true;}});
 if(state.view==='interview')mountQuestionSpeech({key:JSON.stringify([p.id,p.answers.length,p.questionIndex,nextQuestion(p)]),text:nextQuestion(p),pending:interviewFlow.projectId===p.id&&interviewFlow.phase!=='idle',canSpeak:()=>!voiceBusy()&&!document.hidden&&($('#voice-playback')?.paused!==false)});
 if(storageConflict)paintStorageWarning();
 if(loadError){const w=$('#storage-warning');w.innerHTML=esc(storageError)+' <button data-action="backup">Download saved data</button>';}
}
function roomScene(){
 return `<figure class="room-scene"><svg viewBox="0 0 560 400" role="img" aria-labelledby="room-art-title"><title id="room-art-title">A quiet desk at night with a lamp, a pocket cassette recorder, books and a warm window</title><defs><radialGradient id="lampGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#ffd9a0" stop-opacity=".85"/><stop offset="55%" stop-color="#f2b86d" stop-opacity=".28"/><stop offset="100%" stop-color="#f2b86d" stop-opacity="0"/></radialGradient><linearGradient id="nightSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#232c55"/><stop offset="100%" stop-color="#3c2f5e"/></linearGradient><linearGradient id="deskWood" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7a5a44"/><stop offset="100%" stop-color="#5d4433"/></linearGradient><linearGradient id="recorderBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#aecbbd"/><stop offset="100%" stop-color="#7ba794"/></linearGradient></defs><rect x="0" y="0" width="560" height="400" rx="18" fill="#1a2140"/><rect x="370" y="28" width="150" height="150" rx="10" fill="url(#nightSky)" stroke="#4a3f66" stroke-width="5"/><circle cx="470" cy="70" r="17" fill="#f4e3bb"/><circle cx="464" cy="65" r="15" fill="#2a3560" opacity=".28"/><circle cx="405" cy="60" r="1.6" fill="#f4e3bb"/><circle cx="430" cy="95" r="1.3" fill="#f4e3bb"/><circle cx="495" cy="120" r="1.6" fill="#f4e3bb"/><circle cx="450" cy="140" r="1.2" fill="#f4e3bb"/><circle cx="415" cy="130" r="1.2" fill="#f4e3bb"/><rect x="370" y="178" width="150" height="10" rx="4" fill="#4a3f66"/><ellipse cx="150" cy="150" rx="130" ry="120" fill="url(#lampGlow)"/><rect x="0" y="252" width="560" height="148" fill="url(#deskWood)"/><rect x="0" y="252" width="560" height="8" fill="#8a6a50"/><rect x="96" y="150" width="14" height="104" rx="6" fill="#3a2f4e"/><path d="M103 150 L70 118 L150 118 Z" fill="#c65b3f"/><path d="M70 118 L150 118 L138 104 L82 104 Z" fill="#d9704f"/><ellipse cx="110" cy="104" rx="34" ry="10" fill="#e8a06a" opacity=".55"/><rect x="392" y="196" width="10" height="58" fill="#3a2f4e"/><rect x="372" y="196" width="50" height="12" rx="5" fill="#3a2f4e"/><g><rect x="60" y="196" width="96" height="20" rx="3" fill="#8a4f3d"/><rect x="60" y="176" width="96" height="20" rx="3" fill="#5f6e5a"/><rect x="60" y="156" width="96" height="20" rx="3" fill="#a3764f"/><rect x="60" y="156" width="10" height="60" fill="#00000022"/></g><g><rect x="440" y="216" width="52" height="38" rx="5" fill="#e9e2d2" transform="rotate(4 466 235)"/><rect x="448" y="222" width="36" height="22" rx="3" fill="#8a93a8" transform="rotate(4 466 235)"/><circle cx="466" cy="233" r="7" fill="#3a2f4e" transform="rotate(4 466 235)"/></g><g><ellipse cx="300" cy="262" rx="26" ry="8" fill="#00000033"/><rect x="278" y="218" width="44" height="42" rx="6" fill="#b0512f"/><path d="M322 226 q10 -2 8 8 q-2 8 -12 6" fill="none" stroke="#b0512f" stroke-width="7" stroke-linecap="round"/><path d="M292 218 q2 -8 6 -12 M300 218 q3 -9 8 -13" stroke="#f4e3bb" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".8"/></g><g><rect x="150" y="238" width="260" height="118" rx="22" fill="url(#recorderBody)" stroke="#4e6b62" stroke-width="3"/><rect x="150" y="238" width="260" height="118" rx="22" fill="#ffffff" opacity=".08"/><rect x="172" y="254" width="216" height="86" rx="12" fill="#24383a" stroke="#4e6b62" stroke-width="2"/><rect x="184" y="264" width="192" height="26" rx="4" fill="#efe8d2"/><rect x="196" y="272" width="60" height="7" rx="3.5" fill="#b0512f"/><rect x="196" y="281" width="110" height="4" rx="2" fill="#9a917c"/><circle cx="228" cy="314" r="17" fill="none" stroke="#d9d4ba" stroke-width="7"/><circle cx="228" cy="314" r="4" fill="#d9d4ba"/><path d="M228 300 v28 M214 314 h28 M218 304 l20 20 M238 304 l-20 20" stroke="#9aa994" stroke-width="3"/><circle cx="332" cy="314" r="17" fill="none" stroke="#d9d4ba" stroke-width="7"/><circle cx="332" cy="314" r="4" fill="#d9d4ba"/><path d="M332 300 v28 M318 314 h28 M322 304 l20 20 M342 304 l-20 20" stroke="#9aa994" stroke-width="3"/><rect x="245" y="312" width="70" height="3" fill="#d9d4ba"/><g stroke="#4e6b62" stroke-width="2.5"><line x1="172" y1="352" x2="200" y2="352"/><line x1="172" y1="358" x2="200" y2="358"/><line x1="172" y1="364" x2="200" y2="364"/><line x1="360" y1="352" x2="388" y2="352"/><line x1="360" y1="358" x2="388" y2="358"/><line x1="360" y1="364" x2="388" y2="364"/></g><rect x="216" y="350" width="34" height="16" rx="4" fill="#2e4442"/><rect x="254" y="350" width="34" height="16" rx="4" fill="#2e4442"/><rect x="292" y="350" width="34" height="16" rx="4" fill="#a33327"/><circle cx="392" cy="250" r="5" fill="#f2b86d"/><text x="280" y="252" font-family="DM Sans,Arial,sans-serif" font-size="11" letter-spacing="2" fill="#4e6b62">WITNESS · POCKET</text></svg></figure>`;
}
function collectionCard(p,first){
 const r=resumePoint(p),rec=(p.recordings||[]).length;
 const status=needsContinue(p)?`${r.label} · ${r.detail}`:p.story?`Finished story · ${p.story.passages.length} ${p.story.passages.length===1?'passage':'passages'} · ${wordCount(p)} words${rec?` · original audio kept (${rec})`:''}`:`${r.label} · ${r.detail}`;
 const mainAction=needsContinue(p)?`<button class="${first?'button primary':'button outline'}" data-action="resume" data-id="${p.id}">Continue →</button>`:p.story?`<button class="button outline" data-action="read" data-id="${p.id}">Read →</button>`:`<button class="${first?'button primary':'button outline'}" data-action="resume" data-id="${p.id}">Continue →</button>`;
 const events=(p.events||[]).map(e=>`<p class="collection-event">${esc(entryStatus(e,p.answers))}${e.dateText?` · ${esc(e.dateText)}`:''}${e.location?` · ${esc(e.location)}`:''} · “${esc(e.title)}”</p>`).join('');
 return `<article class="memory-card${first?' first':''}"><div><h3>${esc(p.story?.title||p.title)}</h3>${p.example?'<span class="tag">FICTIONAL EXAMPLE</span>':''}<p class="collection-status">${esc(status)}</p>${events}<p class="collection-date">Last touched ${esc(dateLabel(p))}</p></div><div class="memory-card-actions">${mainAction}${(p.events||[]).length?`<button class="button outline" data-action="event-open" data-id="${p.id}">Open in review →</button>`:''}<button class="icon-button" data-action="delete" data-id="${p.id}" aria-label="Delete ${esc(p.story?.title||p.title)}">×</button></div></article>`;
}
function home(){
 const entry=homeQuestion(state.homeQuestionOffset||0);
 const dateLine=new Intl.DateTimeFormat('en',{weekday:'long',month:'long',day:'numeric'}).format(new Date());
 const projects=[...state.projects].sort((a,b)=>b.updatedAt-a.updatedAt);
 const today=questionDismissed
  ?`<section class="space-restore"><button class="text-button" data-action="home-show">Show today’s question</button></section>`
  :`<section class="space-today" aria-labelledby="space-today-q"><div class="room-hero"><div class="room-copy"><p class="date-line">${esc(dateLine)} · A question for today</p><h1 id="space-today-q">${esc(entry.question)}</h1><p class="muted">Talk for a minute, or write a few lines.</p><div class="space-actions"><button class="button primary" data-action="home-record"><span aria-hidden="true">●</span> Record a moment</button><button class="button outline" data-action="home-write">Write instead</button></div><div class="space-alt"><button class="text-button" data-action="help-start">Help me start →</button><button class="text-button" data-action="home-another">Another question</button><button class="text-button" data-action="home-notnow">Not now</button></div></div>${roomScene()}</div></section>`;
 const shelf=projects.length
  ?`<section class="space-library" aria-label="Your story collection"><div class="section-heading"><h2>Your shelf</h2><span>${projects.length} ${projects.length===1?'story':'stories'}</span></div><p class="muted collection-hint">Conversations, moments and stories to return to.</p>${projects.map((p,i)=>collectionCard(p,i===0)).join('')}</section>`
  :`<section class="space-library" aria-label="Your story collection"><div class="section-heading"><h2>Your shelf</h2><span>Empty for now</span></div><p class="muted">A recording, a few words — start wherever you like.</p></section>`;
 return `${today}${shelf}<section class="space-more"><p class="muted">Curious first? <button class="text-button" data-action="demo-browse">Try a fictional example →</button></p></section>`;
}
function weeklyParagraphRows(p,story){
 return paragraphSources(story).map(row=>{
  const buttons=(row.sourceRefs||[]).map(r=>{const a=p.answers.find(a=>a.id===r.answerId);const n=a?p.answers.indexOf(a)+1:'?';return `<button class="source-button" data-action="weekly-source" data-id="${r.answerId}" data-rev="${r.revision}">↗ Source ${n}${a&&a.revision!==r.revision?' · changed':''}</button>`;}).join('');
  return `<p class="shared-story-paragraph">${esc(row.paragraph)}</p>${buttons?`<span class="passage-actions">${buttons}</span>`:'<p class="muted">No source linked.</p>'}`;
 }).join('');
}
function weeklyMarkup(p){
 const f=weeklyState(p),g=groupAnswersByWeek(p.answers,f.timeZone);
 const list=(g.weeks.find(w=>w[0]===f.weekStart)?.[1])||[];
 const zones=[f.timeZone,...WEEK_TIMEZONES.filter(z=>z!==f.timeZone)];
 const accepted=(p.weekly||[]).map(w=>{const stale=sourcesChanged(w.sourceRefs||[],p.answers);return `<article class="memory-card"><div><h3>${esc(w.title||'Untitled week')}</h3><p>${esc(w.rangeText||'')}${w.timeZone?` · ${esc(w.timeZone)}`:''} · ${(w.sourceRefs||[]).length} ${(w.sourceRefs||[]).length===1?'entry':'entries'}${stale?' · sources changed since accepted':''}</p></div><div class="memory-card-actions"><button class="text-button" data-action="weekly-read" data-id="${w.id}">Read →</button><button class="icon-button" data-action="weekly-remove" data-id="${w.id}" aria-label="Remove weekly story">×</button></div></article>`;}).join('');
 const pending=f.phase==='pending';
 const selection=`<section class="event-panel" aria-label="Choose a week"><div class="section-heading"><div><p class="eyebrow">GATHER A WEEK</p><h2>Choose <em>entries.</em></h2></div></div><details class="provenance"><summary>About this step</summary><p>Entries are grouped by the day they were recorded, in the timezone shown. A memory recorded this week about long ago still belongs to this week; its event keeps its own date. The draft is checked against the entries you select, and your entries and events are never changed by it.</p></details><p><label for="weekly-tz">Timezone for grouping</label> <select id="weekly-tz" ${pending?'disabled':''}>${zones.map(z=>`<option value="${esc(z)}" ${z===f.timeZone?'selected':''}>${esc(z)}</option>`).join('')}</select></p>${g.weeks.length?`<p><label for="weekly-week">Week</label> <select id="weekly-week" ${pending?'disabled':''}>${g.weeks.map(([ws,answers])=>`<option value="${ws}" ${ws===f.weekStart?'selected':''}>${esc(weekRangeLabel(ws))} · ${answers.length} ${answers.length===1?'entry':'entries'}</option>`).join('')}</select></p>`:'<p class="muted">No dated entries yet. Answers are grouped once they are recorded.</p>'}${list.length?`<div role="group" aria-label="Entries in this week">${list.map(a=>`<label class="checkbox-label weekly-entry"><input type="checkbox" value="${a.id}" ${f.selectedIds.includes(a.id)?'checked':''} ${pending?'disabled':''}> <span><strong>${esc(entryDateLabel(a.createdAt,f.timeZone))}</strong> — ${esc(a.question)}<br><span class="muted">${esc(a.text.slice(0,120))}${a.text.length>120?'…':''}</span></span></label>`).join('')}</div><p class="muted" id="weekly-count">${f.selectedIds.length} ${f.selectedIds.length===1?'entry':'entries'} selected.</p>`:''}${g.undated.length?`<p class="muted">${g.undated.length} ${g.undated.length===1?'entry has':'entries have'} no recording date and cannot be placed in a week.</p>`:''}<div class="event-actions"><button class="button primary small" id="weekly-generate" data-action="weekly-generate" ${pending||!f.selectedIds.length?'disabled':''}>${pending?'Gathering…':'Draft this week'}</button></div>${pending?'<div class="gentle-note" role="status"><p>Drafting your week and checking it against the selected entries… Nothing is kept yet.</p><div class="event-actions"><button class="text-button" data-action="weekly-cancel">Stop</button></div></div>':''}${f.phase==='error'?`<div class="stale-banner" role="alert"><p>${esc(f.error)}</p><div class="event-actions"><button class="button primary small" data-action="weekly-retry">Retry live request</button><button class="text-button" data-action="weekly-mock">Continue with mock draft</button></div></div>`:''}</section>`;
 let proposal='';
 if(f.phase==='unresolved')proposal=`<section class="event-panel" aria-label="Weekly draft"><div class="proposal" role="status"><p><strong>The weekly draft did not check out.</strong> Nothing was kept; your entries are unchanged.</p><ul class="issue-list">${(f.issues||[]).map(x=>`<li>${esc(x.reason)}: “${esc(x.statement.slice(0,140))}”</li>`).join('')}</ul><div class="event-actions"><button class="text-button" data-action="weekly-discard">Back to selection</button></div></div></section>`;
 if(f.phase==='ready'&&f.proposal){
  const by=f.provider==='mock'?'a local preview':'Meta '+(f.model||'muse-spark-1.3');
  proposal=`<section class="event-panel" aria-label="Weekly draft"><div class="section-heading"><div><p class="eyebrow">REVIEW YOUR WEEK</p><h2>${esc(f.editing?f.draftTitle:f.proposal.title)}</h2></div></div><p class="muted">Proposed by ${by} and checked against ${f.proposal.sourceRefs.length} ${f.proposal.sourceRefs.length===1?'entry':'entries'} · ${esc(f.proposal.rangeText||'')}. Accept, edit, or discard — your entries and events stay as they are.</p>${f.editing?`<p><label for="weekly-edit-title">Title</label></p><input id="weekly-edit-title" maxlength="120" value="${esc(f.draftTitle)}"><p><label for="weekly-edit-narrative">Story</label></p><textarea id="weekly-edit-narrative" rows="10" maxlength="20000">${esc(f.draftNarrative)}</textarea><p class="muted">Source links below refer to the proposed wording.</p>`:''}${weeklyParagraphRows(p,{narrative:f.proposal.narrative,paragraphRefs:f.proposal.paragraphRefs,sourceRefs:f.proposal.sourceRefs})}<div class="event-actions">${f.editing?'<button class="button primary small" data-action="weekly-accept">Accept this story</button><button class="text-button" data-action="weekly-unedit">Stop editing</button>':'<button class="button primary small" data-action="weekly-accept">Accept this story</button><button class="text-button" data-action="weekly-edit">Edit</button>'}<button class="text-button" data-action="weekly-discard">Discard</button></div></section>`;
 }
 return `<div class="page-heading"><p class="eyebrow">WEEKLY STORIES</p><h1>Your week, <em>gathered.</em></h1><p>Draft one readable story from a week's entries. Nothing is kept until you accept it.</p></div>${proposal}${selection}<section class="space-library" aria-label="Kept weekly stories"><div class="section-heading"><h2>Kept weeks</h2><span>${(p.weekly||[]).length?(p.weekly||[]).length+' kept':'Nothing kept yet'}</span></div>${accepted||'<p class="muted">Accepted weekly stories will appear here, with their sources.</p>'}</section>`;
}
function weeklyDialog(p,w){
 const stale=sourcesChanged(w.sourceRefs||[],p.answers);
 showDialog(`<button class="modal-close" data-action="close" aria-label="Close">×</button><p class="eyebrow">A WEEKLY STORY · ${esc((w.rangeText||'').toUpperCase())}</p><h2 id="modal-title">${esc(w.title||'Untitled week')}</h2>${stale?'<div class="stale-banner" role="status">Some source entries changed since this story was accepted. The story stays as you accepted it.</div>':''}${weeklyParagraphRows(p,w)}<button class="button outline" data-action="close">Back to your weeks ↗</button>`);
}
function flow(p){const steps=[['interview','01','Conversation'],['review','02','Review'],['story','03','Story'],['video','04','Film']];return `<div class="flow-top"><button class="text-button" data-action="home">← My space</button><span class="tag">${p.example?'FICTIONAL EXAMPLE':'YOUR STORY'}</span></div><nav class="steps" aria-label="Story steps">${steps.map(([id,n,label])=>`<button data-action="step" data-id="${id}" ${id==='review'&&!p.answers.length||id==='story'&&!p.story||id==='video'&&!p.event?.confirmed?'disabled':''} ${id===state.view?'aria-current="step"':''}><span>${n}</span>${label}</button>`).join('')}</nav>${state.view==='interview'?interview(p):state.view==='review'?review(p):state.view==='video'?videoMarkup(p):state.view==='weekly'?weeklyMarkup(p):story(p)}`;}
function memoryNudge(p){
 const q=suggestedPrompt(p),pending=interviewFlow.projectId===p.id&&interviewFlow.phase==='pending';
 return `<section class="memory-nudge" aria-label="Questions to explore"><div class="section-heading"><h3>Follow another thread</h3><button class="text-button" data-action="prompt-browse" ${pending?'disabled':''}>See more questions</button></div><label class="checkbox-label"><input type="checkbox" id="memory-nudges" ${p.memoryNudges!==false?'checked':''}> Suggest a new topic from time to time</label>${q&&!pending?`<div class="memory-invitation"><p class="eyebrow">ANOTHER THREAD TO FOLLOW</p><p>${esc(q.question)}</p><div class="event-actions"><button class="text-button" data-action="prompt-use" data-id="${q.id}">Explore this here →</button><button class="text-button" data-action="prompt-new" data-id="${q.id}">Start a separate story</button><button class="text-button" data-action="prompt-another">Another question</button><button class="text-button" data-action="prompt-dismiss">Not now</button></div></div>`:''}</section>`;
}
function promptDialog(p){const options=promptOptions(p);showDialog(`<button class="modal-close" data-action="close" aria-label="Close">×</button><h2 id="modal-title">Follow a new <em>thread.</em></h2><p>Choose what brings something to mind. You can skip any question.</p>${options.length?options.map(q=>`<article class="memory-invitation"><h3>${esc(q.label)}</h3><p>${esc(q.question)}</p><div class="event-actions"><button class="text-button" data-action="prompt-use" data-id="${q.id}">Explore this here →</button><button class="text-button" data-action="prompt-new" data-id="${q.id}">Start a separate story</button></div></article>`).join(''):'<p>You have explored all these prompts. Follow your current conversation, or start a story from another memory.</p>'}`);}
function interview(p){return `<div class="page-heading"><p class="eyebrow">CONVERSATION</p><h1>${esc(p.title)}</h1><p>Answer by voice or text. Your words are saved as you go.</p></div><section class="conversation" aria-label="Conversation"><div class="conversation-title"><div><strong>${esc(p.title)}</strong></div><span class="question-count">${p.answers.length} ${p.answers.length===1?'answer':'answers'}</span></div><div class="answer-list">${p.answers.map((a,i)=>`<article class="conversation-turn"><p class="past-question"><span>0${i+1}</span>${esc(a.question)}</p><div class="answer-bubble">${esc(a.text).replace(/\n/g,'<br>')}</div></article>`).join('')}</div>${memoryNudge(p)}<div class="current-question"><p class="eyebrow">CURRENT QUESTION</p><p>${esc(nextQuestion(p))}</p></div>${questionSpeechMarkup()}${voiceMarkup()}<form id="answer-form"><label class="sr-only" for="answer-input">Your answer</label><textarea id="answer-input" name="answer" rows="5" maxlength="20000" placeholder="Take your time. Start with what comes to mind…">${esc(p.draft)}</textarea><div class="composer-bottom"><span id="draft-status">Your words are saved as you write.</span><button type="submit" class="button primary small" ${interviewFlow.projectId===p.id&&interviewFlow.phase==='pending'?'disabled':''}>${interviewFlow.projectId===p.id&&interviewFlow.phase==='pending'?'Getting question…':'Keep going <span>↑</span>'}</button></div></form>${interviewFlow.projectId===p.id&&interviewFlow.phase==='pending'?'<div class="gentle-note" role="status"><p>Getting your next question… Your answer is saved.</p></div>':''}${interviewFlow.projectId===p.id&&interviewFlow.phase==='error'?`<div class="stale-banner" role="alert"><p>${esc(interviewFlow.error)}</p><div class="event-actions"><button class="button primary small" data-action="interview-retry">Retry live request</button><button class="text-button" data-action="interview-mock">Continue with mock question</button></div><p class="muted">Your answers are saved. Retrying will not add the same answer twice.</p></div>`:''}${p.interviewer?.suggestedNextStep==='review_event'?'<div class="gentle-note"><p>You have the beginnings of an event. Keep talking, or take a look at what you have gathered.</p><button class="text-button" data-action="review">Review my event →</button></div>':''}<div class="interview-bottom"><button class="text-button" data-action="skip" ${interviewFlow.projectId===p.id&&interviewFlow.phase==='pending'?'disabled':''}>Skip this question</button><button class="text-button" data-action="review" ${!p.answers.length?'disabled':''}>I’m ready to review →</button></div><details class="provenance"><summary>About these questions</summary><p id="ai-mode-label">${esc(interviewerNote(p))}</p></details></section>`;}
function archivistMarkup(p){
 const flow=archivistFlow.projectId===p.id?archivistFlow:{phase:'idle',error:'',drafts:[]};
 const entries=(p.events||[]).map(e=>`<article class="memory-card"><div><h3>${esc(e.title)}</h3><p>${esc(entryStatus(e,p.answers))}${e.dateText?` · ${esc(e.dateText)}`:''}${e.location?` · ${esc(e.location)}`:''}</p></div><div class="memory-card-actions"><button class="text-button" data-action="entry-review" data-id="${e.id}">Review event →</button><button class="text-button" data-action="entry-remove" data-id="${e.id}">Remove</button></div></article>`).join('');
 const drafts=(flow.drafts||[]).map((d,i)=>{
  if(d.status!=='verified')return `<div class="proposal" role="status"><p><strong>${esc(d.label)} could not be checked.</strong> Nothing was kept.</p><ul class="issue-list">${d.issues.map(x=>`<li>${esc(x.reason)}: “${esc(x.statement.slice(0,140))}”</li>`).join('')}</ul><div class="event-actions"><button class="text-button" data-action="archivist-dismiss" data-id="${i}">Dismiss</button></div></div>`;
  const by=d.provider==='mock'?'a local check':'Meta '+(d.model||'muse-spark-1.3');
  return `<div class="proposal" role="status"><p><strong>${esc(d.label)}.</strong> Checked by ${by} against ${d.answerIds.length} ${d.answerIds.length===1?'answer':'answers'}.</p><blockquote>${esc(d.event.summary)}</blockquote><p class="muted">${esc(d.event.title)}${d.event.dateText?` · ${esc(d.event.dateText)}`:''}${d.event.location?` · ${esc(d.event.location)}`:''}</p><div class="event-actions"><button class="button primary small" data-action="archivist-accept" data-id="${i}">Keep this event</button><button class="text-button" data-action="archivist-dismiss" data-id="${i}">Dismiss</button></div></div>`;
 }).join('');
 const partial=flow.partial?`<div class="gentle-note" role="status"><p>Kept ${flow.partial.completed} of ${flow.partial.total} groups (${flow.partial.reason==='timeout'?'the shared deadline ran out':'the shared call budget ran out'}). Nothing else was started; run again for the rest.</p></div>`:'';
 return `<section class="event-panel" aria-label="Event collection"><div class="section-heading"><div><p class="eyebrow">DISTINCT EVENTS</p><h2>Your <em>collection.</em></h2></div></div><details class="provenance"><summary>About this step</summary><p>Groups these answers into separate occasions, then checks each draft against its own answers. One shared deadline and call budget cover the whole run. Drafts enter your collection only when you keep them.</p></details><div class="archivist-entries">${entries||'<p class="muted">No events in this story yet.</p>'}</div><div class="event-actions"><button class="button primary small" data-action="archivist-run" ${flow.phase==='pending'||!p.answers.length?'disabled':''}>${flow.phase==='pending'?'Finding events…':'Find distinct events'}</button></div>${flow.phase==='pending'?'<div class="gentle-note" role="status"><p>Grouping your answers and checking each draft… Nothing is kept yet.</p><div class="event-actions"><button class="text-button" data-action="archivist-cancel">Stop</button></div></div>':''}${flow.phase==='error'?`<div class="stale-banner" role="alert"><p>${esc(flow.error)}</p><div class="event-actions"><button class="button primary small" data-action="archivist-retry">Retry live request</button><button class="text-button" data-action="archivist-mock">Continue with mock grouping</button></div></div>`:''}${partial}${drafts}</section>`;
}
function collectionEventDialog(p,id){
 const entry=(p.events||[]).find(e=>e.id===id);if(!entry)return;
 const stale=entryStatus(entry,p.answers)==='Needs review'||sourcesChanged(entry.sourceRefs||[],p.answers);
 showDialog(`<button class="modal-close" data-action="close" aria-label="Close event">×</button><h2 id="modal-title">Review this event.</h2><p>Check the details in your own words. An approximate date can stay approximate. Confirming keeps this event private.</p>${stale?'<p class="stale-banner" role="alert">Its source answers changed. Close this window and find the events again before confirming.</p>':''}<form id="collection-event-form" data-entry="${esc(entry.id)}"><input type="hidden" name="capture" value="${esc(eventContentSignature(entry))}"><label for="collection-title">Event title</label><input id="collection-title" name="title" maxlength="120" value="${esc(entry.title)}" required><label for="collection-summary">What happened</label><textarea id="collection-summary" name="summary" maxlength="6000" rows="5" required>${esc(entry.summary)}</textarea><label for="collection-date">When, as you remember it</label><input id="collection-date" name="dateText" maxlength="500" value="${esc(entry.dateText)}"><label for="collection-location">Event location</label><input id="collection-location" name="location" maxlength="500" value="${esc(entry.location)}"><details class="match-evidence"><summary>Source answers (${entry.sourceRefs.length})</summary>${entry.sourceRefs.map(r=>{const a=p.answers.find(a=>a.id===r.answerId);return `<p>${esc(a?.question)}</p><blockquote>${esc(a?.text)}</blockquote>`;}).join('')}</details><button type="submit" class="button primary" ${stale?'disabled':''}>Confirm this event</button></form>`);
}
function review(p){const uncertain=p.answers.filter(hasUncertainty);return `<div class="page-heading"><p class="eyebrow">REVIEW</p><h1>Check your <em>answers.</em></h1><p>Confirm each answer, then shape them into a story.</p></div>${eventMarkup(p,eventFlow.projectId===p.id?eventFlow:{phase:'idle',error:''},eventNote(p))}${archivistMarkup(p)}<div class="review-layout"><section>${uncertain.length?`<div class="gentle-note"><p>You left room for uncertainty in ${uncertain.length===1?'one answer':`${uncertain.length} answers`}. You can keep it that way.</p></div>`:''}<div class="review-list">${p.answers.map((a,i)=>`<form class="review-card" data-answer="${a.id}"><div class="review-label"><span>ANSWER ${(i+1).toString().padStart(2,'0')}</span><span>Revision ${a.revision}${a.createdAt?` · Recorded ${new Intl.DateTimeFormat('en',{month:'short',day:'numeric'}).format(a.createdAt)}`:''}</span></div><label for="edit-${a.id}">${esc(a.question)}</label><textarea id="edit-${a.id}" name="answer" rows="4" maxlength="20000">${esc(reviewText(p,a))}</textarea><div class="review-foot">${hasUncertainty(a)?`<label class="checkbox-label"><input type="checkbox" data-uncertainty="${a.id}" ${a.uncertaintyReviewed?'checked':''}> Keep the uncertainty in my story</label>`:'<span>Your original wording stays available.</span>'}<button class="text-button" type="submit">Save answer ↗</button></div></form>`).join('')}</div></section><aside class="review-summary"><span class="eyebrow">NEXT STEP</span><h2>${p.answers.length} ${p.answers.length===1?'answer':'answers'} <em>collected.</em></h2><p>Assemble them into a story draft, or keep answering.</p><label for="story-name">Give it a working title</label><input id="story-name" maxlength="120" value="${esc(p.title)}"><button class="button primary full" data-action="assemble">${p.story?'Open your story':'Assemble a story draft'} ${arrow}</button><small>You can come back to these answers anytime.</small></aside></div>`;}
function proposalCard(p,s){
 const proposal=passageProposal(p,s);
 if(!proposal)return '';
 const n=p.answers.findIndex(a=>a.id===proposal.answer.id)+1;
 return `<div class="proposal" role="status"><p><strong>Your answer changed.</strong> Your passage stays as written until you choose.</p><blockquote>${esc(proposal.text)}</blockquote><p class="muted">Source: answer ${n}, revision ${proposal.answer.revision}.</p><div class="event-actions"><button class="button primary small" data-action="refresh" data-id="${s.id}">Use updated answer</button><button class="text-button" data-action="proposal-reject" data-id="${s.id}">Keep my wording</button></div></div>`;
}
function editorMarkup(p,s){
 const f=editorFlow[s.id];
 if(!f)return '';
 if(f.phase==='pending')return `<div class="gentle-note" role="status"><p>Suggesting a wording… Your passage stays as written.</p></div>`;
 if(f.phase==='error')return `<div class="stale-banner" role="alert"><p>${esc(f.error)}</p><div class="event-actions"><button class="button primary small" data-action="editor-retry" data-id="${s.id}">Retry live request</button><button class="text-button" data-action="editor-mock" data-id="${s.id}">Continue with mock wording</button></div></div>`;
 if(f.phase==='unresolved')return `<div class="proposal" role="status"><p><strong>The suggestion did not check out.</strong> Your passage stays as written.</p><ul class="issue-list">${(f.issues||[]).map(x=>`<li>${esc(x.reason)}: “${esc(x.statement.slice(0,140))}”</li>`).join('')}</ul><div class="event-actions"><button class="button primary small" data-action="editor-retry" data-id="${s.id}">Try again</button><button class="text-button" data-action="editor-reject" data-id="${s.id}">Keep mine</button></div></div>`;
 const by=f.provider==='mock'?'a local preview':'Meta '+(f.model||'muse-spark-1.3');
 return `<div class="proposal" role="status"><p><strong>Suggested wording.</strong> Proposed by ${by} and checked against your answer. Your original answer is never changed.</p><blockquote>${esc(f.proposal)}</blockquote>${f.keptPhrases?.length?`<p class="muted">Kept from your wording: ${esc(f.keptPhrases.join(', '))}.</p>`:''}<div class="event-actions"><button class="button primary small" data-action="editor-accept" data-id="${s.id}">Use this wording</button><button class="text-button" data-action="editor-reject" data-id="${s.id}">Keep mine</button></div></div>`;
}
function story(p){if(!p.story)return review(p);const stale=p.story.passages.filter(s=>isStale(p,s)).length;return `<div class="story-top"><div><p class="eyebrow">STORY DRAFT · PRIVATE</p></div><div class="story-top-actions"><button class="button outline" data-action="download">↓ Download story</button>${p.event?.confirmed&&!eventStale(p)?'<button class="button outline" data-action="video-open">Plan a film →</button>':''}</div></div><div class="story-layout"><section class="paper" aria-label="Story draft"><div class="paper-meta"><span>${p.example?'FICTIONAL EXAMPLE':'PRIVATE'}</span><span>IN YOUR WORDS</span></div><label class="sr-only" for="story-title">Story title</label><textarea class="story-title" id="story-title" maxlength="120" rows="1">${esc(p.story.title)}</textarea><div class="paper-rule"></div>${stale?`<div class="stale-banner" role="status">${stale} ${stale===1?'source has':'sources have'} changed. Open the marked sources to review.</div>`:''}${p.story.passages.map((s,i)=>`<article class="passage ${isStale(p,s)?'stale':''}"><label class="sr-only" for="passage-${s.id}">Story passage ${i+1}</label><textarea class="passage-text" id="passage-${s.id}" data-passage="${s.id}" rows="${Math.max(3,Math.ceil(s.text.length/65))}" maxlength="20000">${esc(s.text)}</textarea>${proposalCard(p,s)}${editorMarkup(p,s)}<div class="passage-bottom"><span>${s.edited?'Edited by you':'From your answer'}</span><span class="passage-actions"><button class="text-button" data-action="passage-save" data-id="${s.id}">Save passage</button><button class="text-button" data-action="editor-suggest" data-id="${s.id}">Suggest wording</button><button class="source-button" data-action="source" data-id="${s.id}">${isStale(p,s)?'<i class="warning-dot"></i> Needs review · ':''}↗ Source ${i+1}</button></span></div></article>`).join('')}</section><aside class="story-aside"><span class="eyebrow">ABOUT THIS DRAFT</span><p>Edit any passage. Open its source to see the answer it came from.</p><div class="stat-line"><span>Words</span><strong id="word-count">${wordCount(p)}</strong></div><div class="stat-line"><span>Source answers</span><strong>${p.story.passages.length}</strong></div><button class="text-button" data-action="review">← Back to your answers</button><button class="text-button" data-action="interview">Add another memory +</button><button class="text-button" data-action="weekly-open">Draft a weekly story →</button><div class="demo-explainer"><span>HOW THIS DRAFT WORKS</span><p>Your answers are assembled without AI rewriting. Your edits and source links are saved in this browser.</p></div></aside></div>${storyAudioMarkup(p)}`;}
function showDialog(html){$('#modal-content').innerHTML=html;$('#modal').showModal();}
function starterDialog(){showDialog(`<button class="modal-close" data-action="close" aria-label="Close">×</button><h2 id="modal-title">Where would you like to <em>begin?</em></h2><p>Pick one concrete thread. You can wander, skip, or change direction any time — no need to tell it in order.</p><div class="modal-topics">${STARTER_CHOICES.map(c=>`<button data-action="starter" data-id="${c.id}"><div><strong>${esc(c.label)}</strong><small>${esc(c.hint)} “${esc(c.question)}”</small></div><span aria-hidden="true">↗</span></button>`).join('')}</div>`);}
function startFromChoice(choiceId){const c=starterChoice(choiceId);if(!c)return null;const p=newProject(c.topic);setInterviewer(p,{result:{question:c.question},provider:'prompt',model:null});state.projects.push(p);return p;}
// Connect reading card: Like/Unlike plus saving an exact phrase. The dialog
// sits over the same globe; these handlers only rewrite the dialog, never
// the globe, camera, or chosen event.
function openConnectStory(s){openSharedStory=s;showDialog(connectStoryMarkup(s));}
function connectStoryMarkup(s){
 const liked=isLiked(likedStories,s.id);
 const paras=String(s.story||'').split('\n\n');
 return `<button class="modal-close" data-action="close" aria-label="Close story">×</button><p class="eyebrow">FICTIONAL STORY · ${esc(s.place)}</p><h2 id="modal-title">${esc(s.title)}</h2><p class="muted">${esc(s.name)} · ${esc(s.year)}</p>${paras.map((para,i)=>`<p class="shared-story-paragraph">${esc(para)}</p><button class="text-button passage-save-link" data-action="connect-save-para" data-n="${i}">Save this passage</button>`).join('')}<div class="shared-story-reason"><span>${s.matchType==='same_occasion'?'SAME OCCASION':'SIMILAR EXPERIENCE'}</span><p>${esc(s.reason)}</p></div><div class="connect-keep-row"><button class="button outline small" data-action="connect-like" data-id="${esc(s.id)}" aria-pressed="${liked}">${liked?'Unlike ♥':'Like ♡'}</button><button class="button outline small" data-action="connect-save" data-id="${esc(s.id)}">Save selected words</button></div><p class="muted">Likes and saved phrases stay on this device. No account, no totals.</p><p class="connect-save-note" role="status"></p><p class="shared-story-note">Fictional profile. Messaging and real-user discovery are not connected.</p><button class="button outline" data-action="close">Back to Earth</button>`;
}
function connectNote(text){const n=document.querySelector('#modal-content .connect-save-note');if(n)n.textContent=text;else toast(text);}
function storyParagraphTexts(){return Array.from(document.querySelectorAll('#modal-content .shared-story-paragraph')).map(el=>el.textContent);}
function selectionInsideParagraphs(){
 const sel=window.getSelection();
 if(!sel||sel.rangeCount===0||sel.isCollapsed)return {text:'',error:'Select a few words from the story text first.'};
 const paras=Array.from(document.querySelectorAll('#modal-content .shared-story-paragraph'));
 if(!paras.length)return {text:'',error:'There is no story text to save from here.'};
 const anchor=paras.find(el=>el.contains(sel.anchorNode)),focus=paras.find(el=>el.contains(sel.focusNode));
 if(!anchor||!focus)return {text:'',error:'Save words from this story only. Selections from outside the story text are not kept.'};
 if(anchor!==focus)return {text:'',error:'Keep your selection inside one passage.'};
 return {text:cleanSelectionText(sel.toString()),error:''};
}
function savedView(){
 const quotes=[...savedQuotes].sort((a,b)=>b.createdAt-a.createdAt);
 const liked=likedStories.map(id=>SHARED_STORIES.find(s=>s.id===id)).filter(Boolean);
 return `<div class="page-heading"><p class="eyebrow">SAVED</p><h1>Lines worth <em>keeping.</em></h1><p>Phrases you saved, with who wrote them and where they came from. Everything stays in this browser.</p></div>${savedNotice?`<div class="stale-banner" role="alert">${esc(savedNotice)}</div>`:''}<section aria-label="Saved phrases">${quotes.length?`<div class="saved-list">${quotes.map(q=>`<article class="memory-card"><div><blockquote class="saved-text">“${esc(q.text)}”</blockquote><p class="muted">${esc(q.author)} · ${esc(q.sourceTitle)} · ${q.sourceKind==='own'?'YOUR STORY':'FICTIONAL STORY'}</p></div><div class="memory-card-actions"><button class="text-button" data-action="saved-remove" data-id="${esc(q.id)}">Remove</button></div></article>`).join('')}</div>`:'<p class="muted">Nothing saved yet. Open a story in Connect, select a few exact words, and save them here — or save a passage from one of your own stories.</p>'}</section><section aria-label="Liked stories"><div class="section-heading"><h2>Liked on this device</h2><span>${liked.length}</span></div>${liked.length?`<div class="saved-list">${liked.map(s=>`<article class="memory-card"><div><h3>${esc(s.title)}</h3><p class="muted">${esc(s.name)} · ${esc(s.place)} · fictional</p></div><div class="memory-card-actions"><button class="text-button" data-action="saved-unlike" data-id="${esc(s.id)}">Unlike</button></div></article>`).join('')}</div>`:'<p class="muted">No liked stories yet. Likes stay on this device and are never counted anywhere else.</p>'}</section>`;
}
function newDialog(){showDialog(`<button class="modal-close" data-action="close" aria-label="Close">×</button><h2 id="modal-title">Start a <em>conversation.</em></h2><p>Choose a starting point. You can change direction any time.</p><div class="modal-topics">${TOPICS.map(t=>`<button data-action="topic" data-id="${t.id}"><div><strong>${t.name}</strong><small>${t.hint}</small></div><span aria-hidden="true">↗</span></button>`).join('')}</div>`);}
function sourceDialog(id){const p=current(),s=p.story.passages.find(s=>s.id===id),a=p.answers.find(a=>a.id===s.sourceId);showDialog(`<button class="modal-close" data-action="close" aria-label="Close source">×</button><h2 id="modal-title">Source <em>answer.</em></h2><p class="source-question">${esc(s.question)}</p><span class="tag">ANSWER · REVISION ${s.sourceRevision}</span><blockquote>${esc(s.sourceText)}</blockquote>${isStale(p,s)?`<div class="source-change"><span class="tag">UPDATED ANSWER · REVISION ${a.revision}</span><blockquote>${esc(a.text)}</blockquote><p>Your story still refers to the earlier answer. Replacing this passage will also replace any edits you made to it.</p><button class="button primary" data-action="refresh" data-id="${s.id}">Replace with updated answer ↗</button></div>`:`<p class="muted">This is the saved answer version used for this passage. You can edit your story without changing the original answer.</p>`}<button class="text-button" data-action="review">Edit your answers →</button>`);}
function start(topic){const p=newProject(topic);state.projects.push(p);go('interview',p.id);}
function startWithQuestion(focusComposer){const entry=homeQuestion(state.homeQuestionOffset||0);const p=newProject(entry.topic);setInterviewer(p,{result:{question:entry.question},provider:'prompt',model:null});state.projects.push(p);go('interview',p.id);if(focusComposer)$('#answer-input')?.focus();}
function startRecordingNow(){const entry=homeQuestion(state.homeQuestionOffset||0);const p=newProject(entry.topic);setInterviewer(p,{result:{question:entry.question},provider:'prompt',model:null});state.projects.push(p);go('interview',p.id);document.querySelector('#voice-box')?.scrollIntoView({block:'center'});startVoiceCapture();}
function download(name,text,type='text/markdown;charset=utf-8'){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-action]');if(!b||b.disabled)return;e.preventDefault();const action=b.dataset.action,id=b.dataset.id,p=current();if(voiceBusy()){toast('Stop the recording or wait for transcription before leaving.');return;}
 try {if(!checkStorageVersion()&&!['backup-current','backup','reload-latest','download','close','source','weekly-source','weekly-read','connect-like','connect-save','connect-save-para','passage-save','saved-remove','saved-unlike'].includes(action)){toast('Another tab has newer changes. Download your draft here or reload the saved version.');return;}if(['connect-save','connect-save-para','passage-save','saved-remove'].includes(action)){const latest=loadCollection(localStorage,SAVED_KEY);if(latest.error)throw Error(latest.error);savedQuotes=latest.list;}if(['connect-like','saved-unlike'].includes(action)){const latest=loadCollection(localStorage,LIKES_KEY);if(latest.error)throw Error(latest.error);likedStories=latest.list;}switch(action){
 case'home':go('home');break;case'connect':go('connect');break;case'saved':go('saved');break;case'new':newDialog();break;case'close':$('#modal').close();break;
 case'help-start':starterDialog();break;
 case'starter':{const x=startFromChoice(id);if(!x)break;$('#modal').close();go('interview',x.id);$('#answer-input')?.focus();break;}
 case'connect-like':{const r=toggleLike(likedStories,id);likedStories=r.likes;persistLikes();if(r.error){connectNote(r.error);break;}b.setAttribute('aria-pressed',String(r.liked));b.textContent=r.liked?'Unlike ♥':'Like ♡';connectNote(r.liked?'Liked on this device.':'Removed from your liked stories.');break;}
 case'connect-save':{const s=openSharedStory;if(!s||s.id!==id)break;const sel=selectionInsideParagraphs();const problem=sel.error||validateStorySelection(sel.text,storyParagraphTexts());if(problem){connectNote(problem);break;}const r=addQuote(savedQuotes,{text:sel.text,author:s.name,sourceTitle:s.title,sourceKind:'shared-fictional',sourceId:s.id,sourceRevision:null,projectId:null});savedQuotes=r.list;if(r.error){connectNote(r.error);break;}persistSaved();connectNote(r.duplicate?'Already on your shelf.':'Saved. Find it under Saved.');break;}
 case'connect-save-para':{const s=openSharedStory;if(!s)break;const paras=storyParagraphTexts(),para=paras[Number(b.dataset.n)];if(typeof para!=='string'||!para.trim()){connectNote('There is no passage to save here.');break;}const r=addQuote(savedQuotes,{text:cleanSelectionText(para),author:s.name,sourceTitle:s.title,sourceKind:'shared-fictional',sourceId:s.id,sourceRevision:null,projectId:null});savedQuotes=r.list;if(r.error){connectNote(r.error);break;}persistSaved();connectNote(r.duplicate?'Already on your shelf.':'Passage saved. Find it under Saved.');break;}
 case'passage-save':{const s=p?.story?.passages.find(x=>x.id===id);if(!p||!s)break;const r=addQuote(savedQuotes,{text:s.text,author:'You',sourceTitle:p.story.title||p.title,sourceKind:'own',sourceId:s.id,sourceRevision:s.sourceRevision,projectId:p.id});savedQuotes=r.list;if(r.error){toast(r.error);break;}persistSaved();toast(r.duplicate?'Already on your shelf.':'Passage saved with its source.');break;}
 case'saved-remove':savedQuotes=removeQuote(savedQuotes,id);persistSaved();render();break;
 case'saved-unlike':{const r=toggleLike(likedStories,id);likedStories=r.likes;persistLikes();render();break;}
 case'topic':start(id);break;
 case'prompt-browse':if(interviewFlow.phase!=='pending')promptDialog(p);break;
 case'prompt-another':p.memoryPromptOffset=(p.memoryPromptOffset||0)+1;save();render();break;
 case'prompt-dismiss':p.dismissedNudgeAt=p.answers.length;save();render();break;
 case'prompt-use':case'prompt-new':{if(interviewFlow.phase==='pending')break;const q=promptOptions(p).find(q=>q.id===id);if(!q)break;if(action==='prompt-new'){const x=newProject(q.topic,q.label);useMemoryPrompt(x,q);state.projects.push(x);go('interview',x.id);}else{useMemoryPrompt(p,q);invalidatePending();leaveVoice();save();render();$('#answer-input')?.focus();$('#answer-form')?.scrollIntoView({block:'center',behavior:'smooth'});}break;}
 case'example':{const x=exampleProject();state.projects.push(x);go('interview',x.id);break;}
 case'demo-browse':{showDialog(`<button class="modal-close" data-action="close" aria-label="Close">×</button><h2 id="modal-title">Demo <em>stories.</em></h2><p>Fictional interviews for trying the flow. Starting one gives you the first question with no answers submitted; loading a completed example submits every entry. Either way a new conversation starts; your stories are never overwritten.</p><div class="modal-topics">${INTERVIEW_FIXTURES.map(f=>{const t=TOPICS.find(t=>t.id===f.topic);return `<article class="demo-row"><div><strong>${esc(f.title)}</strong><small>${esc(t?.name||f.topic)} · ${f.entries.length} entries · fictional</small></div><div class="event-actions"><button class="button outline small" data-action="demo-start" data-id="${f.id}">Start demo interview</button><button class="button outline small" data-action="demo-load" data-id="${f.id}">Load completed example</button></div></article>`;}).join('')}</div>`);break;}
 case'demo-start':{const f=fixtureById(id);if(!f)break;const x=buildDemoStarter(f);state.projects.push(x);go('interview',x.id);toast('Demo interview started. Speak or type each entry from the demo script.');break;}
 case'demo-load':{const f=fixtureById(id);if(!f)break;const x=buildDemoProject(f);state.projects.push(x);go('interview',x.id);toast('Completed demo loaded as a new conversation.');break;}
 case'home-record':startRecordingNow();break;
 case'home-write':startWithQuestion(true);break;
 case'home-another':state.homeQuestionOffset=(state.homeQuestionOffset||0)+1;save();render();break;
 case'home-notnow':questionDismissed=true;render();break;
 case'home-show':questionDismissed=false;render();break;
 case'resume':{const x=state.projects.find(p=>p.id===id);const r=resumePoint(x);go(r.view,id);if(r.view==='interview')$('#answer-input')?.focus();break;}
 case'read':go('story',id);break;
 case'event-open':go('review',id);break;
 case'proposal-reject':dismissProposal(p,id);save();render();toast('Kept your wording.');break;
 case'archivist-run':await requestArchivist(p,'auto');break;
 case'archivist-retry':await requestArchivist(p,'live');break;
 case'archivist-mock':await requestArchivist(p,'mock');break;
 case'archivist-cancel':aiSeq++;archivistFlow={phase:'idle',error:'',requestId:0,projectId:null,drafts:[],partial:null};save();render();break;
 case'archivist-accept':{const d=archivistFlow.drafts[+id];if(!d?.event)break;try{acceptCollectionEvent(p,d.event,{provider:d.provider,model:d.model,verification:{status:'verified',attempts:d.attempts}});archivistFlow.drafts.splice(+id,1);save();render();toast('Event kept in your collection.');}catch(err){toast(err.message);}break;}
 case'archivist-dismiss':archivistFlow.drafts.splice(+id,1);save();render();break;
 case'entry-review':collectionEventDialog(p,id);break;
 case'entry-remove':{const e=(p.events||[]).find(x=>x.id===id);showDialog(`<button class="modal-close" data-action="close" aria-label="Close">×</button><h2 id="modal-title">Remove this event?</h2><p>“${esc(e?.title||'Untitled')}” leaves your collection. Your answers and story stay.</p><button class="button primary" data-action="entry-remove-confirm" data-id="${id}">Remove event</button>`);break;}
 case'entry-remove-confirm':removeCollectionEvent(p,id);save();render();toast('Event removed from your collection.');break;
 case'editor-suggest':await requestEditor(p,id,'auto');break;
 case'editor-retry':await requestEditor(p,id,'live');break;
 case'editor-mock':await requestEditor(p,id,'mock');break;
 case'editor-accept':{const f=editorFlow[id],s=p.story?.passages.find(x=>x.id===id);if(!f?.proposal||!s)break;if(!acceptEditorProposal(p,id,f.proposal,f.binding)){delete editorFlow[id];save();render();toast('This suggestion no longer matches your words; kept what you have.');break;}delete editorFlow[id];save();render();toast('Wording updated. Your answer is unchanged.');break;}
 case'editor-reject':delete editorFlow[id];save();render();break;
 case'weekly-open':go('weekly');break;
 case'weekly-generate':await requestWeekly(p,'auto');break;
 case'weekly-retry':await requestWeekly(p,'live');break;
 case'weekly-mock':await requestWeekly(p,'mock');break;
 case'weekly-cancel':weeklyFlow.aborter?.abort();aiSeq++;Object.assign(weeklyFlow,{phase:'select',error:'',requestId:0,proposal:null,issues:[],binding:null,aborter:null});save();render();break;
 case'weekly-edit':weeklyFlow.editing=true;save();render();break;
 case'weekly-unedit':weeklyFlow.editing=false;weeklyFlow.draftTitle=weeklyFlow.proposal.title;weeklyFlow.draftNarrative=weeklyFlow.proposal.narrative;save();render();break;
 case'weekly-accept':{const f=weeklyFlow;if(!f.proposal)break;const story={title:(f.editing?f.draftTitle:f.proposal.title).trim()||f.proposal.title,rangeText:f.proposal.rangeText,narrative:f.editing?f.draftNarrative:f.proposal.narrative,sourceRefs:f.proposal.sourceRefs,paragraphRefs:f.editing?undefined:f.proposal.paragraphRefs,provider:f.provider,model:f.model};if(!acceptWeeklyStory(p,story,f.binding,{weekStart:f.weekStart,timeZone:f.timeZone,selectedIds:f.selectedIds})){Object.assign(weeklyFlow,{phase:'select',proposal:null,binding:null,editing:false});save();render();toast('Your selection or entries changed; this proposal no longer matches. Select the week again.');break;}Object.assign(weeklyFlow,{phase:'select',proposal:null,binding:null,editing:false,draftTitle:'',draftNarrative:''});save();render();toast('Weekly story kept. Your entries are unchanged.');break;}
 case'weekly-discard':Object.assign(weeklyFlow,{phase:'select',error:'',proposal:null,issues:[],binding:null,editing:false});save();render();break;
 case'weekly-read':{const w=(p.weekly||[]).find(x=>x.id===id);if(w)weeklyDialog(p,w);break;}
 case'weekly-remove':{const w=(p.weekly||[]).find(x=>x.id===id);showDialog(`<button class="modal-close" data-action="close" aria-label="Close">×</button><h2 id="modal-title">Remove this weekly story?</h2><p>“${esc(w?.title||'Untitled week')}” leaves your kept weeks. Your entries and events stay.</p><button class="button primary" data-action="weekly-remove-confirm" data-id="${id}">Remove weekly story</button>`);break;}
 case'weekly-remove-confirm':removeWeeklyStory(p,id);save();render();toast('Weekly story removed. Your entries stay.');break;
 case'weekly-source':{const v=sourceVersionText(p,id,Number(b.dataset.rev));if(!v){toast('That source version is no longer available.');break;}showDialog(`<button class="modal-close" data-action="close" aria-label="Close source">×</button><h2 id="modal-title">Source <em>entry.</em></h2><p class="source-question">${esc(v.question)}</p><span class="tag">ENTRY · REVISION ${v.revision}${v.current?'':' · SUPERSEDED'}</span><blockquote>${esc(v.text)}</blockquote>${v.current?'<p class="muted">This is the current wording of the entry.</p>':'<p class="muted">This is the exact wording cited when the story was drafted. The entry has since changed; the story keeps referring to this version.</p>'}<button class="text-button" data-action="review">Open in review →</button>`);break;}
 case'step':go(id);break;case'review':go('review');break;case'interview':go('interview');break;
 case'skip':if(interviewFlow.phase==='pending')break;if(voiceBusy()){toast('Stop recording before changing the question.');break;}leaveVoice();p.questionIndex++;p.skippedIntents=[...(p.skippedIntents||[]),p.interviewer?.intent].filter(Boolean);p.interviewer=null;save();await requestInterview(p,'auto');$('#answer-input')?.focus();break;
case'interview-retry':if(interviewFlow.phase!=='error')break;await requestInterview(p,'live');break;
case'interview-mock':if(interviewFlow.phase!=='error')break;await requestInterview(p,'mock');break;
 case'event-build':{if(eventFlow.phase==='pending')break;if(p.event){showDialog(`<button class="modal-close" data-action="close" aria-label="Close">×</button><h2 id="modal-title">Rebuild this event?</h2><p>This replaces your event edits with a new draft from the answers. Your video plan stays available.</p><button class="button primary" data-action="event-rebuild">Rebuild event ↗</button>`);break;}await requestEvent(p,'auto');break;}
 case'event-rebuild':if(eventFlow.phase==='pending')break;await requestEvent(p,'auto');break;
 case'event-retry':if(eventFlow.phase!=='error')break;await requestEvent(p,'live');break;
 case'event-mock':if(eventFlow.phase!=='error')break;await requestEvent(p,'mock');break;
 case'event-focus-answers':{const t=document.querySelector('.review-card textarea');if(t){t.scrollIntoView({block:'center',behavior:'smooth'});t.focus({preventScroll:true});}break;}
 case'video-open':go('video');break;
 case'video-download':download('witness-video-plan.json',JSON.stringify(p.video,null,2),'application/json');break;
 case'video-source':{const scene=p.video.scenes[Number(id)];showDialog(`<button class="modal-close" data-action="close" aria-label="Close">×</button><h2 id="modal-title">Behind this scene.</h2>${scene.sourceRefs.map(r=>{const a=p.video.sourceAnswers.find(a=>a.id===r.answerId&&a.revision===r.revision);return `<span class="tag">ANSWER · REVISION ${r.revision}</span><p>${esc(a?.question)}</p><blockquote>${esc(a?.text)}</blockquote>`;}).join('')}`);break;}
 case'assemble':if(!p.story)createStory(p);else{const linked=new Set(p.story.passages.map(s=>s.sourceId));for(const a of p.answers.filter(a=>!linked.has(a.id)))p.story.passages.push({id:crypto.randomUUID(),text:a.text,sourceId:a.id,sourceRevision:a.revision,sourceText:a.text,question:a.question,edited:false});}go('story');break;
 case'source':sourceDialog(id);break;case'refresh':refreshPassage(p,id);save();render();toast('Passage updated from your answer.');break;
 case'download':{const slug=p.story.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,70)||'my-story';download(slug+'.md',exportStory(p));toast('Your story has been downloaded.');break;}
 case'delete':{const x=state.projects.find(p=>p.id===id);showDialog(`<button class="modal-close" data-action="close" aria-label="Close">×</button><h2 id="modal-title">Delete this story?</h2><p>“${esc(x.story?.title||x.title)}” and its saved answers, recordings, and scene images will be removed from this browser.</p><div class="dialog-actions"><button class="button outline" data-action="close">Keep it</button><button class="button primary" data-action="confirm-delete" data-id="${id}">Delete story</button></div>`);break;}
 case'confirm-delete':{const gone=state.projects.find(x=>x.id===id);state.projects=state.projects.filter(x=>x.id!==id);if(gone){for(const r of gone.recordings||[])mediaDelete(MEDIA_RECORDINGS,r.id).catch(()=>{});for(const s of gone.video?.scenes||[])if(s.image?.id)mediaDelete(MEDIA_IMAGES,s.image.id).catch(()=>{});const kept=purgeProjectQuotes(savedQuotes,gone.id);if(kept.length!==savedQuotes.length){savedQuotes=kept;persistSaved();}}go('home',null);toast('Story deleted.');break;}
 case'backup-current':download('witness-this-tab-draft.json',JSON.stringify(state,null,2),'application/json');break;
 case'reload-latest':if(voiceBusy()||voicePendingSaves()){toast('Wait for your audio to finish saving before reloading.');break;}window.location.reload();break;
 case'backup':download('witness-saved-data.json',localStorage.getItem(key)||'{}','application/json');break;
 case'about':showDialog(`<button class="modal-close" data-action="close" aria-label="Close">×</button><h2 id="modal-title">About <em>Witness.</em></h2><p>Answer one question at a time, by voice or text. Review your answers, shape them into a story, and trace each passage to its source.</p><p>Interview questions and event drafts use live AI when the local server enables it, with a local preview as backup. Story assembly and video storyboards use local rules, not AI rewriting.</p><p>Your stories are stored in this browser. Clearing browser data removes them, so download anything you want to keep.</p><button class="button primary" data-action="close">Got it ↗</button>`);break;
 }}catch(err){toast(err.message);}
});
document.addEventListener('submit',async e=>{
 if(e.target.id==='answer-form'){e.preventDefault();if(interviewFlow.phase==='pending')return;if(voiceBusy()){toast('Stop recording before continuing.');return;}const p=current(),text=new FormData(e.target).get('answer');try{addAnswer(p,text);}catch(err){toast(err.message);return;}leaveVoice();save();await requestInterview(p,'auto');}
 else if(e.target.id==='collection-event-form'){e.preventDefault();const p=current(),f=Object.fromEntries(new FormData(e.target));try{confirmCollectionEvent(p,e.target.dataset.entry,f,f.capture);save();render();toast('Event confirmed. It is now available in Connect.');}catch(err){toast(err.message);}}
 else if(e.target.id==='event-form'){e.preventDefault();const p=current(),f=Object.fromEntries(new FormData(e.target));try{confirmEvent(p,{title:f.title,summary:f.summary,dateText:f.dateText.trim()||null,location:f.location.trim()||null,people:f.people.split(',').map(x=>x.trim()).filter(Boolean),themes:f.themes.split(',').map(x=>x.trim()).filter(Boolean)});save();render();toast('Event confirmed.');}catch(err){toast(err.message);}}
 else if(e.target.id==='video-form'){e.preventDefault();const p=current(),options=Object.fromEntries(new FormData(e.target));try{saveVideo(p,(await witnessAI.video({...projectInput(p),event:p.event,options})).result,options);save();render();}catch(err){toast(err.message);}}
 else if(e.target.matches('.review-card')){e.preventDefault();const p=current();try{reviseAnswer(p,e.target.dataset.answer,new FormData(e.target).get('answer'));save();render();toast('Answer saved.');}catch(err){toast(err.message);}}
});
document.addEventListener('input',e=>{
 const p=current();if(!p)return;
 if(e.target.matches('.passage-text, .story-title')){e.target.style.height='auto';e.target.style.height=(e.target.scrollHeight+4)+'px';}
 if(e.target.closest('#event-form')){const f=Object.fromEntries(new FormData(e.target.closest('form')));Object.assign(p.event,{title:f.title,summary:f.summary,dateText:f.dateText.trim()||null,location:f.location.trim()||null,people:f.people.split(',').map(x=>x.trim()).filter(Boolean),themes:f.themes.split(',').map(x=>x.trim()).filter(Boolean),confirmed:false,revision:p.event.revision+1});p.updatedAt=Date.now();save();document.querySelector('.video-invite')?.remove();}
 if(e.target.matches('.review-card textarea')){const form=e.target.closest('.review-card');if(form?.dataset.answer){try{setReviewDraft(p,form.dataset.answer,e.target.value);save();}catch{}}}
 if(e.target.id==='answer-input'){p.draft=e.target.value;save();const status=$('#draft-status');if(status)status.textContent=storageError?'Not saved — keep this tab open.':'Draft saved in this browser.';}
 if(e.target.id==='story-name'){p.title=e.target.value;p.updatedAt=Date.now();save();}
 if(e.target.id==='story-title'){p.story.title=e.target.value;p.updatedAt=Date.now();save();}
 if(e.target.dataset.passage){const s=p.story.passages.find(s=>s.id===e.target.dataset.passage);s.text=e.target.value;s.edited=true;p.updatedAt=Date.now();save();const n=$('#word-count');if(n)n.textContent=wordCount(p);const note=e.target.closest('.passage').querySelector('.passage-bottom>span');if(note)note.textContent='Edited by you';}
 if(e.target.id==='weekly-edit-title'){weeklyFlow.draftTitle=e.target.value;return;}
 if(e.target.id==='weekly-edit-narrative'){e.target.style.height='auto';e.target.style.height=(e.target.scrollHeight+4)+'px';weeklyFlow.draftNarrative=e.target.value;return;}
});
document.addEventListener('change',e=>{if(e.target.id==='memory-nudges'){current().memoryNudges=e.target.checked;save();render();return;}if(e.target.dataset.uncertainty){const a=current().answers.find(a=>a.id===e.target.dataset.uncertainty);a.uncertaintyReviewed=e.target.checked;save();return;}if(e.target.id==='weekly-tz'){const p=current(),tz=e.target.value;if(!validTimeZone(tz))return;weeklyState(p);const g=groupAnswersByWeek(p.answers,tz),newest=g.weeks.length?g.weeks[0][0]:null;Object.assign(weeklyFlow,{phase:'select',error:'',proposal:null,issues:[],binding:null,weekStart:newest,timeZone:tz,selectedIds:newest?g.weeks[0][1].map(a=>a.id):[]});save();render();return;}if(e.target.id==='weekly-week'){const p=current();weeklyState(p);const list=(groupAnswersByWeek(p.answers,weeklyFlow.timeZone).weeks.find(w=>w[0]===e.target.value)?.[1])||[];Object.assign(weeklyFlow,{phase:'select',error:'',proposal:null,issues:[],binding:null,weekStart:e.target.value,selectedIds:list.map(a=>a.id)});save();render();return;}if(e.target.matches('.weekly-entry input')){const sel=new Set(weeklyFlow.selectedIds);e.target.checked?sel.add(e.target.value):sel.delete(e.target.value);weeklyFlow.selectedIds=[...sel];if(weeklyFlow.binding||weeklyFlow.proposal){Object.assign(weeklyFlow,{phase:'select',error:'',proposal:null,issues:[],binding:null,editing:false});save();render();return;}const n=$('#weekly-count');if(n)n.textContent=`${weeklyFlow.selectedIds.length} ${weeklyFlow.selectedIds.length===1?'entry':'entries'} selected.`;const gen=$('#weekly-generate');if(gen)gen.disabled=!weeklyFlow.selectedIds.length||weeklyFlow.phase==='pending';}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){document.querySelector('.nav-connect')?.classList.add('tooltip-dismissed');}if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&e.target.id==='answer-input'){e.preventDefault();$('#answer-form').requestSubmit();}});
render();
refreshAIMode();

document.addEventListener('pointerover',e=>{const button=e.target.closest('.nav-connect');if(button&&!button.contains(e.relatedTarget))button.classList.remove('tooltip-dismissed');});
document.addEventListener('focusin',e=>{if(e.target.matches('.nav-connect'))e.target.classList.remove('tooltip-dismissed');});

window.addEventListener('storage',event=>{
 if(event.key===key&&event.newValue!==lastSavedRaw){checkStorageVersion();invalidatePending();}
});
