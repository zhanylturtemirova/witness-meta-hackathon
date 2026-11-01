import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject,addAnswer,reviseAnswer,createStory,isStale,refreshPassage,exportStory,nextQuestion,validProject,setReviewDraft,reviewDraft,reviewText,addRecordingMeta,getRecordingMeta,removeRecordingMeta,setRecordingTranscript,MAX_RECORDINGS_PER_STORY,resumePoint,passageProposal,dismissProposal,eventSummary,needsContinue,captureEditorBinding,editorBindingFresh,acceptEditorProposal} from '../web/domain.js';
test('an answer edit preserves the source used by an existing passage until explicitly refreshed',()=>{
 const p=newProject('turning-point');const a=addAnswer(p,'I moved around 2018, I think.');createStory(p);const s=p.story.passages[0];
 reviseAnswer(p,a.id,'I moved in 2019.');
 assert.equal(s.sourceText,'I moved around 2018, I think.');assert.equal(s.text,'I moved around 2018, I think.');assert.equal(isStale(p,s),true);
 assert.deepEqual(a.history,[{revision:1,text:'I moved around 2018, I think.'}]);
 assert.match(exportStory(p),/source changed; passage needs review/);
 refreshPassage(p,s.id);assert.equal(s.text,'I moved in 2019.');assert.equal(isStale(p,s),false);assert.equal(s.sourceRevision,2);
});
test('editable story export keeps the narrator edit and the exact original source separately',()=>{
 const p=newProject('person');addAnswer(p,'My sister was with me.');createStory(p);p.story.passages[0].text='That day, my sister came along.';
 const text=exportStory(p);assert.match(text,/That day, my sister came along\. \[1\]/);assert.match(text,/Original answer: My sister was with me\./);
 assert.equal(validProject(JSON.parse(JSON.stringify(p))),true);
});
test('follow-up can respond to the previous answer without inventing details',()=>{
 const p=newProject('small-moment');addAnswer(p,'I went to a concert.');assert.match(nextQuestion(p),/sound, sight, or detail/);
});
test('review drafts keep unsaved text until the answer is saved',()=>{
 const p=newProject('small-moment');const a=addAnswer(p,'A quiet afternoon with my sister.');
 setReviewDraft(p,a.id,'A quiet afternoon with my sister and our neighbour.');
 assert.equal(a.text,'A quiet afternoon with my sister.');assert.equal(a.revision,1);
 assert.equal(reviewText(p,a),'A quiet afternoon with my sister and our neighbour.');
 reviseAnswer(p,a.id,'A quiet afternoon with my sister and our neighbour.');
 assert.equal(reviewDraft(p,a.id),undefined);
 assert.equal(reviewText(p,a),'A quiet afternoon with my sister and our neighbour.');
 assert.equal(validProject(JSON.parse(JSON.stringify(p))),true);
});
test('blank answers and broken source links are rejected',()=>{
 const p=newProject('person');assert.throws(()=>addAnswer(p,'   '));assert.equal(p.answers.length,0);assert.throws(()=>createStory(p));
 const a=addAnswer(p,'A memory.');assert.throws(()=>reviseAnswer(p,a.id,''));createStory(p);p.story.passages[0].sourceId='missing';assert.equal(validProject(p),false);
});
test('answers record when they were written, separately from event dates',()=>{
 const p=newProject('person');
 const before=Date.now();const a=addAnswer(p,'Something from today.');
 assert.ok(Number.isFinite(a.createdAt)&&a.createdAt>=before);
 assert.equal(validProject(JSON.parse(JSON.stringify(p))),true);
 const legacy=JSON.parse(JSON.stringify(p));delete legacy.answers[0].createdAt;
 assert.equal(validProject(legacy),true);
});
test('event summaries expose identity, status, and collection links',()=>{
 const p=newProject('small-moment');addAnswer(p,'A concert with my sister.');
 assert.equal(eventSummary(p),null);
 p.event={id:'e1',title:'First concert',dateText:'around 2018',location:'Manchester',confirmed:true,sourceRefs:[],revision:1};
 assert.deepEqual(eventSummary(p),{id:'e1',title:'First concert',dateText:'around 2018',location:'Manchester',confirmed:true,projectId:p.id,projectTitle:p.title});
 const legacy=newProject('person');addAnswer(legacy,'A memory.');
 legacy.event={title:'Draft',dateText:null,location:null,confirmed:false,sourceRefs:[],revision:1};
 assert.equal(eventSummary(legacy).id,null);
});
test('saved recordings keep their question and transcript until explicitly discarded',()=>{
 const p=newProject('person');
 const r=addRecordingMeta(p,{id:'r1',question:'Who was there?',durationSec:12.34});
 assert.equal(r.question,'Who was there?');assert.equal(r.durationSec,12.3);assert.equal(r.transcript,'');
 setRecordingTranscript(p,'r1','My sister was with me.','muse-voice-transcribe-1.0');
 assert.equal(getRecordingMeta(p,'r1').transcript,'My sister was with me.');
 assert.equal(getRecordingMeta(p,'nope'),null);
 assert.equal(validProject(JSON.parse(JSON.stringify(p))),true);
 assert.equal(removeRecordingMeta(p,'r1'),true);assert.equal(removeRecordingMeta(p,'r1'),false);
 assert.equal((p.recordings||[]).length,0);
});
test('recording metadata is validated and capped per story',()=>{
 const p=newProject('person');
 assert.throws(()=>addRecordingMeta(p,{id:'',question:'Q'}),/missing/);
 assert.throws(()=>addRecordingMeta(p,{id:'r1',question:'  '}),/question/);
 addRecordingMeta(p,{id:'r1',question:'Q'});
 assert.throws(()=>addRecordingMeta(p,{id:'r1',question:'Q'}),/already saved/);
 assert.throws(()=>setRecordingTranscript(p,'nope','x'),/not found/);
 assert.throws(()=>setRecordingTranscript(p,'r1','x'.repeat(20001)),/20,000/);
 for(let i=2;i<=MAX_RECORDINGS_PER_STORY;i++)addRecordingMeta(p,{id:'r'+i,question:'Q'});
 assert.throws(()=>addRecordingMeta(p,{id:'overflow',question:'Q'}),/Discard one first/);
 assert.equal(validProject(p),true);
});
test('resume points to the exact unfinished position',()=>{
 const p=newProject('person');
 assert.deepEqual(resumePoint(p),{view:'interview',label:'Answer the first question',detail:'Nothing written yet.'});
 p.draft='A few words';p.stage='review';
 assert.deepEqual(resumePoint(p),{view:'interview',label:'Continue writing',detail:'Your draft is saved.'});
 p.draft='';addAnswer(p,'My sister was with me.');p.stage='interview';
 assert.deepEqual(resumePoint(p),{view:'interview',label:'Continue the conversation',detail:'1 answer so far.'});
 p.stage='review';
 assert.deepEqual(resumePoint(p),{view:'review',label:'Continue reviewing',detail:'1 answer.'});
 createStory(p);p.stage='story';
 assert.deepEqual(resumePoint(p),{view:'story',label:'Continue reading',detail:'1 passage.'});
 p.stage='video';p.video={scenes:[]};
 assert.deepEqual(resumePoint(p),{view:'video',label:'Continue your film',detail:'1 answer · storyboard ready.'});
});
test('conversations with unsent drafts stay in Continue even with a story',()=>{
 const p=newProject('person');
 assert.equal(needsContinue(p),true);
 addAnswer(p,'A memory.');createStory(p);
 assert.equal(needsContinue(p),false);
 p.draft='More to say';
 assert.equal(needsContinue(p),true);
 assert.equal(resumePoint(p).view,'interview');
 p.draft='   ';
 assert.equal(needsContinue(p),false);
});
test('a changed answer proposes an update the narrator can accept or reject',()=>{
 const p=newProject('person');const a=addAnswer(p,'My sister was with me.');createStory(p);const s=p.story.passages[0];
 assert.equal(passageProposal(p,s),null);
 reviseAnswer(p,a.id,'My sister and our neighbour were with me.');
 const proposal=passageProposal(p,s);
 assert.equal(proposal.answer.id,a.id);assert.equal(proposal.text,'My sister and our neighbour were with me.');
 assert.equal(s.text,'My sister was with me.');
 dismissProposal(p,s.id);
 assert.equal(passageProposal(p,s),null);
 assert.equal(s.text,'My sister was with me.');
 assert.equal(isStale(p,s),true);
 reviseAnswer(p,a.id,'My sister, our neighbour, and the dog were with me.');
 assert.equal(passageProposal(p,s).text,'My sister, our neighbour, and the dog were with me.');
 refreshPassage(p,s.id);
 assert.equal(s.text,'My sister, our neighbour, and the dog were with me.');
 assert.equal(passageProposal(p,s),null);
 assert.equal(validProject(JSON.parse(JSON.stringify(p))),true);
});
test('an editor proposal is bound to its project, passage, and exact source revisions',()=>{
 const p=newProject('turning-point');const a=addAnswer(p,'It was 2019, the summer I left school.');createStory(p);const s=p.story.passages[0];
 const binding=captureEditorBinding(p,s.id,[{answerId:a.id,revision:a.revision}]);
 assert.equal(editorBindingFresh(p,binding),true);
 assert.equal(acceptEditorProposal(p,s.id,'It was 2019, the summer I left school.',binding),true);
 assert.equal(s.edited,true);
 const q=newProject('turning-point');addAnswer(q,'It was 2019, the summer I left school.');
 assert.equal(editorBindingFresh(q,binding),false);
});
test('a stale editor proposal is rejected and the corrected wording stays',()=>{
 const p=newProject('turning-point');const a=addAnswer(p,'It was 2019, the summer I left school.');createStory(p);const s=p.story.passages[0];
 const binding=captureEditorBinding(p,s.id,[{answerId:a.id,revision:a.revision}]);
 const oldProposal='It was 2019, the summer I left school, tidied.';
 reviseAnswer(p,a.id,'It was 2020, the summer I left school.');
 assert.equal(editorBindingFresh(p,binding),false);
 refreshPassage(p,s.id);
 assert.equal(s.text,'It was 2020, the summer I left school.');
 assert.equal(acceptEditorProposal(p,s.id,oldProposal,binding),false);
 assert.equal(s.text,'It was 2020, the summer I left school.');
});
test('editing the passage while a proposal is pending invalidates it',()=>{
 const p=newProject('person');const a=addAnswer(p,'My sister was with me.');createStory(p);const s=p.story.passages[0];
 const binding=captureEditorBinding(p,s.id,[{answerId:a.id,revision:a.revision}]);
 s.text='That day, my sister came along.';s.edited=true;
 assert.equal(editorBindingFresh(p,binding),false);
 assert.equal(acceptEditorProposal(p,s.id,'My sister was with me, tidied.',binding),false);
 assert.equal(s.text,'That day, my sister came along.');
});
