const refSchema={type:'object',properties:{answerId:{type:'string'},revision:{type:'integer'}},required:['answerId','revision'],additionalProperties:false};
const refsSchema={type:'array',items:refSchema};
export const AI_SCHEMAS={
 interview:{type:'object',properties:{question:{type:'string'},intent:{type:'string',enum:['opening','place','time','people','detail','meaning','clarify','wrap_up']},sourceRefs:refsSchema,enoughMaterial:{type:'boolean'},suggestedNextStep:{type:'string',enum:['continue','review_event']}},required:['question','intent','sourceRefs','enoughMaterial','suggestedNextStep'],additionalProperties:false},
 event:{type:'object',properties:{title:{type:'string'},summary:{type:'string'},dateText:{type:['string','null']},location:{type:['string','null']},people:{type:'array',items:{type:'string'}},themes:{type:'array',items:{type:'string'}},detailsToConfirm:{type:'array',items:{type:'string'}},sourceRefs:refsSchema},required:['title','summary','dateText','location','people','themes','detailsToConfirm','sourceRefs'],additionalProperties:false},
 video:{type:'object',properties:{title:{type:'string'},logline:{type:'string'},styleSpec:{type:'object',properties:{palette:{type:'string'},technique:{type:'string'},characters:{type:'array',items:{type:'object',properties:{label:{type:'string'},appearance:{type:'string'},clothing:{type:'string'}},required:['label','appearance','clothing'],additionalProperties:false}},locations:{type:'array',items:{type:'object',properties:{label:{type:'string'},description:{type:'string'}},required:['label','description'],additionalProperties:false}}},required:['palette','technique','characters','locations'],additionalProperties:false},scenes:{type:'array',items:{type:'object',properties:{title:{type:'string'},hostQuestion:{type:'string'},narratorText:{type:'string'},visualDirection:{type:'string'},caption:{type:'string'},visual:{type:'string'},depictsPeople:{type:'array',items:{type:'string'}},depictsPlaces:{type:'array',items:{type:'string'}},seconds:{type:'integer'},openVisualQuestions:{type:'array',items:{type:'string'}},sourceRefs:refsSchema},required:['title','hostQuestion','narratorText','visualDirection','caption','visual','depictsPeople','depictsPlaces','seconds','openVisualQuestions','sourceRefs'],additionalProperties:false}}},required:['title','logline','styleSpec','scenes'],additionalProperties:false},
 verify:{type:'object',properties:{supported:{type:'boolean'},issues:{type:'array',items:{type:'object',properties:{field:{type:'string',enum:['title','summary','dateText','location','people','themes','detailsToConfirm','proposal','narrative']},statement:{type:'string'},answerRefs:refsSchema,reason:{type:'string',enum:['invented_fact','contradiction','certainty_overreach']}},required:['field','statement','answerRefs','reason'],additionalProperties:false}}},required:['supported','issues'],additionalProperties:false},
 archivist:{type:'object',properties:{groups:{type:'array',items:{type:'object',properties:{label:{type:'string'},answerRefs:refsSchema},required:['label','answerRefs'],additionalProperties:false}}},required:['groups'],additionalProperties:false},
 editor:{type:'object',properties:{proposal:{type:'string'},keptPhrases:{type:'array',items:{type:'string'}},sourceRefs:refsSchema},required:['proposal','keptPhrases','sourceRefs'],additionalProperties:false},
 period:{type:'object',properties:{title:{type:'string'},rangeText:{type:'string'},narrative:{type:'string'},sourceRefs:refsSchema,paragraphRefs:{type:'array',items:{type:'object',properties:{paragraph:{type:'string'},sourceRefs:refsSchema},required:['paragraph','sourceRefs'],additionalProperties:false}}},required:['title','rangeText','narrative','sourceRefs','paragraphRefs'],additionalProperties:false},
 match:{type:'object',properties:{matchType:{type:'string',enum:['same_occasion','similar_experience']},reason:{type:'string'},evidenceRefs:refsSchema},required:['matchType','reason','evidenceRefs'],additionalProperties:false},
 discovery:{type:'object',properties:{results:{type:'array',maxItems:40,items:{type:'object',properties:{id:{type:'string'},revision:{type:'integer'},score:{type:'number'},reason:{type:'string'},queryEvidence:{type:'string'},candidateEvidence:{type:'string'}},required:['id','revision','score','reason','queryEvidence','candidateEvidence'],additionalProperties:false}}},required:['results'],additionalProperties:false}
};
export const DISCOVERY_LIMITS={MAX_QUERY:500,MAX_CANDIDATES:40,MAX_CANDIDATE_TEXT:2000,MAX_REASON:280,MAX_EVIDENCE:200};
const str=(v,max=20000)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const nullable=v=>v===null||str(v,500);
const strings=v=>Array.isArray(v)&&v.length<=20&&v.every(x=>str(x,600));
export function enoughMaterial(project){return project.answers.length>=3&&project.answers.map(a=>a.text).join(' ').trim().split(/\s+/).filter(Boolean).length>=50;}
export function answerRefs(answers){return answers.map(a=>({answerId:a.id,revision:a.revision}));}
export function sourcesChanged(refs,answers){return !Array.isArray(refs)||refs.some(ref=>!answers.some(a=>a.id===ref.answerId&&a.revision===ref.revision));}
export function validateRefs(refs,answers,{allowEmpty=false}={}){
 if(!Array.isArray(refs)||(!allowEmpty&&!refs.length))throw Error('The result has no source answers.');
 const seen=new Set();for(const r of refs){if(!r||typeof r.answerId!=='string'||!Number.isInteger(r.revision)||!answers.some(a=>a.id===r.answerId&&a.revision===r.revision)||seen.has(r.answerId))throw Error('The result refers to an unknown or outdated answer.');seen.add(r.answerId);}
}
export function validateEventShape(result){
 if(!result||typeof result!=='object')throw Error('The event response is incomplete.');
 if(!str(result.title,120)||!str(result.summary,6000)||!nullable(result.dateText)||!nullable(result.location)||!strings(result.people)||!strings(result.themes)||!strings(result.detailsToConfirm)||!Array.isArray(result.sourceRefs))throw Error('The event response is incomplete.');
 return result;
}
export function verifyFieldText(candidate,field){
 const v=candidate[field];
 if(typeof v==='string')return v;
 if(Array.isArray(v))return v.join('\n');
 return '';
}
export function validateVerifyIssue(issue,candidate,answers){
 const props=AI_SCHEMAS.verify.properties.issues.items.properties;
 if(!issue||typeof issue!=='object'||!props.field.enum.includes(issue.field)||typeof issue.statement!=='string'||!issue.statement.trim()||issue.statement.length>2000||!props.reason.enum.includes(issue.reason))throw Error('A verification issue could not be read.');
 if(!verifyFieldText(candidate,issue.field).includes(issue.statement))throw Error('A verification issue does not match the checked draft.');
 validateRefs(issue.answerRefs,answers);
 return issue;
}
export function validateVerifyOutput(output,candidate,answers){
 if(!output||typeof output!=='object'||typeof output.supported!=='boolean'||!Array.isArray(output.issues)||output.issues.length>10)throw Error('The verification result could not be read.');
 if(output.supported&&output.issues.length)throw Error('The verification result is inconsistent.');
 if(!output.supported&&!output.issues.length)throw Error('The verification result has no actionable issues.');
 for(const issue of output.issues)validateVerifyIssue(issue,candidate,answers);
 return output;
}
export function validateStyleSpec(spec){
 if(!spec||typeof spec!=='object'||!str(spec.palette,300)||!str(spec.technique,300))throw Error('The film needs one shared style.');
 for(const c of spec.characters||[])if(!c||!str(c.label,80)||!str(c.appearance,300)||!str(c.clothing,200))throw Error('A character description is incomplete.');
 for(const l of spec.locations||[])if(!l||!str(l.label,80)||!str(l.description,300))throw Error('A location description is incomplete.');
 if(!Array.isArray(spec.characters)||spec.characters.length>6||!Array.isArray(spec.locations)||spec.locations.length>6)throw Error('The film style lists are incomplete.');
 return spec;
}
// Creation-time storyboard check: 4-6 chronological new-shape scenes with
// captions, visuals, and durations. Legacy single-scene checks stay in
// validateAIResult so saved storyboards and image requests keep working.
export function validateStoryboard(result,answers){
 const checked=validateAIResult('video',result,answers);
 if(result.styleSpec===undefined)throw Error('The storyboard needs one shared style.');
 if(result.scenes.length<4||result.scenes.length>6)throw Error('The storyboard needs 4 to 6 scenes in story order.');
 let lastIndex=-1;
 for(const scene of result.scenes){
  if(scene.caption===undefined||scene.visual===undefined||scene.seconds===undefined)throw Error('A scene needs its caption, visual description, and duration.');
  const at=answers.findIndex(a=>a.id===scene.sourceRefs[0]?.answerId);
  if(at<0||at<lastIndex)throw Error('Scenes must follow the order of the interview.');
  lastIndex=at;
 }
 return checked;
}
export function validateAIResult(task,result,answers){
 if(!result||typeof result!=='object')throw Error('The result could not be read.');
 if(task==='interview'){
  if(!str(result.question,600)||!AI_SCHEMAS.interview.properties.intent.enum.includes(result.intent)||typeof result.enoughMaterial!=='boolean'||!['continue','review_event'].includes(result.suggestedNextStep))throw Error('The interview response is incomplete.');
  validateRefs(result.sourceRefs,answers,{allowEmpty:true});
 }else if(task==='event'){
  validateEventShape(result);
  validateRefs(result.sourceRefs,answers);
  if(result.sourceRefs.length!==answers.length)throw Error('The event must include all interview answers.');
 }else if(task==='archivist'){
  if(!Array.isArray(result.groups)||!result.groups.length||result.groups.length>8)throw Error('The archivist response is incomplete.');
  const seen=new Set();
  for(const g of result.groups){
   if(!g||typeof g!=='object'||!str(g.label,120))throw Error('An event group is incomplete.');
   validateRefs(g.answerRefs,answers);
   for(const r of g.answerRefs){if(seen.has(r.answerId))throw Error('An answer belongs to two event groups.');seen.add(r.answerId);}
  }
 }else if(task==='editor'){
  if(!str(result.proposal,6000))throw Error('The wording suggestion is incomplete.');
  if(!Array.isArray(result.keptPhrases)||result.keptPhrases.length>10||!result.keptPhrases.every(p=>typeof p==='string'&&p.length<=200))throw Error('The kept phrases could not be read.');
  validateRefs(result.sourceRefs,answers);
 }else if(task==='period'){
  if(!str(result.title,120)||!str(result.rangeText,120)||!str(result.narrative,20000))throw Error('The period summary is incomplete.');
  validateRefs(result.sourceRefs,answers,{allowEmpty:true});
  if(!Array.isArray(result.paragraphRefs)||!result.paragraphRefs.length)throw Error('The weekly draft has no paragraph sources.');
  const paras=String(result.narrative).split(/\n\n+/).map(s=>s.trim()).filter(Boolean);
  const remaining=[...paras];
  for(const e of result.paragraphRefs){
   if(!e||typeof e!=='object'||!str(e.paragraph,20000))throw Error('A weekly paragraph source is incomplete.');
   validateRefs(e.sourceRefs,answers);
   const i=remaining.indexOf(String(e.paragraph).trim());
   if(i<0)throw Error('A weekly paragraph source does not match the draft.');
   remaining.splice(i,1);
  }
  if(remaining.length)throw Error('Every weekly paragraph needs its own sources.');
 }else if(task==='match'){
  if(!['same_occasion','similar_experience'].includes(result.matchType)||!str(result.reason,2000))throw Error('The match explanation is incomplete.');
  validateRefs(result.evidenceRefs,answers);
 }else if(task==='video'){
  if(!str(result.title,120)||!str(result.logline,2000)||!Array.isArray(result.scenes)||!result.scenes.length||result.scenes.length>8)throw Error('The video plan is incomplete.');
  if(result.styleSpec!==undefined)validateStyleSpec(result.styleSpec);
  for(const scene of result.scenes){if(!str(scene.title,120)||!str(scene.hostQuestion,600)||!str(scene.narratorText,4000)||!str(scene.visualDirection,2000))throw Error('A video scene is incomplete.');validateRefs(scene.sourceRefs,answers);const cited=scene.sourceRefs.map(r=>answers.find(a=>a.id===r.answerId)?.text||'');if(!cited.some(t=>t.includes(scene.narratorText)))throw Error('Narrator lines must come directly from a source answer.');
   if(scene.caption!==undefined&&(!str(scene.caption,500)||!cited.some(t=>t.includes(scene.caption))))throw Error('Scene captions must come directly from a source answer.');
   if(scene.visual!==undefined&&!str(scene.visual,1000))throw Error('A scene visual description is incomplete.');
   for(const key of ['depictsPeople','depictsPlaces']){if(scene[key]!==undefined){if(!Array.isArray(scene[key])||scene[key].length>5||!scene[key].every(x=>str(x,80)))throw Error('A scene depicts list is incomplete.');const low=cited.join('\n').toLowerCase();for(const name of scene[key])if(!low.includes(name.toLowerCase()))throw Error(`The storyboard names ${name}, which no source mentions. Ask the narrator instead of inventing it.`);}}
   if(scene.seconds!==undefined&&(!Number.isInteger(scene.seconds)||scene.seconds<3||scene.seconds>12))throw Error('A scene duration must be 3 to 12 seconds.');
   if(scene.openVisualQuestions!==undefined&&(!Array.isArray(scene.openVisualQuestions)||scene.openVisualQuestions.length>3||!scene.openVisualQuestions.every(q=>str(q,300))))throw Error('A scene question list is incomplete.');}
 }else throw Error('Unknown AI task.');
 return result;
}
// Discovery request shape: one search query plus bounded public
// candidate excerpts. Candidates carry only public text — never private
// answers, history, or audio.
export function validateDiscoveryInput(input){
 if(!input||typeof input!=='object')throw Error('The discovery search is empty.');
 const q=input.query;
 if(typeof q!=='string'||!q.trim()||q.length>DISCOVERY_LIMITS.MAX_QUERY)throw Error('The discovery search text must be 1-500 characters.');
 const cands=input.candidates;
 if(!Array.isArray(cands)||!cands.length||cands.length>DISCOVERY_LIMITS.MAX_CANDIDATES)throw Error('Discovery needs 1-40 public candidates.');
 const seen=new Set();
 for(const c of cands){
  if(!c||typeof c!=='object'||typeof c.id!=='string'||!c.id||c.id.length>120||!Number.isInteger(c.revision)||c.revision<1)throw Error('A discovery candidate is incomplete.');
  if(typeof c.text!=='string'||!c.text.trim()||c.text.length>DISCOVERY_LIMITS.MAX_CANDIDATE_TEXT)throw Error('A discovery candidate excerpt is incomplete.');
  if(seen.has(c.id))throw Error('A discovery candidate appears twice.');
  seen.add(c.id);
 }
 return input;
}
// Discovery result validation: fail closed. Unknown ids, revision
// mismatches, out-of-range scores, overlong reasons, and evidence spans
// that are not exact substrings of the cited side are all rejected —
// fabricated or parroted content never reaches the UI.
export function validateDiscoveryResult(result,context){
 if(!result||typeof result!=='object'||!Array.isArray(result.results))throw Error('The discovery ranking could not be read.');
 const query=typeof context?.query==='string'?context.query:'';
 const cands=new Map((Array.isArray(context?.candidates)?context.candidates:[]).map(c=>[c?.id,c]));
 if(result.results.length>DISCOVERY_LIMITS.MAX_CANDIDATES||result.results.length>cands.size)throw Error('The discovery ranking refers to too many stories.');
 const seen=new Set();
 for(const r of result.results){
  if(!r||typeof r!=='object')throw Error('A discovery ranking entry could not be read.');
  if(typeof r.id!=='string'||!r.id||!cands.has(r.id))throw Error('The discovery ranking refers to an unknown story.');
  if(seen.has(r.id))throw Error('The discovery ranking repeats a story.');
  seen.add(r.id);
  const cand=cands.get(r.id);
  if(!Number.isInteger(r.revision)||r.revision!==cand.revision)throw Error('A ranked story changed since the search began. Search again.');
  if(typeof r.score!=='number'||!(r.score>=0&&r.score<=1))throw Error('A discovery score is out of range.');
  if(typeof r.reason!=='string'||!r.reason.trim()||r.reason.length>DISCOVERY_LIMITS.MAX_REASON)throw Error('A discovery reason could not be read.');
  if(typeof r.queryEvidence!=='string'||!r.queryEvidence||r.queryEvidence.length>DISCOVERY_LIMITS.MAX_EVIDENCE||!query.includes(r.queryEvidence))throw Error('A discovery quote does not match the search text exactly.');
  const text=typeof cand.text==='string'?cand.text:'';
  if(typeof r.candidateEvidence!=='string'||!r.candidateEvidence||r.candidateEvidence.length>DISCOVERY_LIMITS.MAX_EVIDENCE||!text.includes(r.candidateEvidence))throw Error('A discovery quote does not match the shared story exactly.');
 }
 return result;
}
export function validateAIInput(task,input){
 if(!AI_SCHEMAS[task]||!input||typeof input!=='object'||typeof input.title!=='string'||input.title.length>120||!Array.isArray(input.answers)||input.answers.length>60)throw Error('This interview could not be read.');
 let total=0;const seen=new Set();for(const a of input.answers){if(!a||typeof a.id!=='string'||!Number.isInteger(a.revision)||a.revision<1||typeof a.question!=='string'||typeof a.text!=='string'||!a.text.trim()||a.text.length>20000||seen.has(a.id))throw Error('An answer is missing or invalid.');total+=a.text.length;seen.add(a.id);}
 if(total>100000)throw Error('Please use a shorter interview for this preview.');
 if(task!=='interview'&&!input.answers.length)throw Error('Add an answer before building an event.');
 if(task==='verify'){
  if(!input.candidate||typeof input.candidate!=='object')throw Error('There is no draft to check.');
  if(typeof input.candidate.proposal==='string'&&input.candidate.title===undefined){
   if(!str(input.candidate.proposal,6000))throw Error('There is no wording draft to check.');
  }else if(typeof input.candidate.narrative==='string'&&input.candidate.summary===undefined){
   validateAIResult('period',input.candidate,input.answers);
  }else validateEventShape(input.candidate);
 }
 if(task==='editor'){
  if(typeof input.passage!=='string'||!input.passage.trim()||input.passage.length>20000)throw Error('There is no passage to reword.');
  if(!input.answers.length)throw Error('A wording suggestion needs its source answers.');
 }
 if(task==='editor'&&input.repair!==undefined||task==='event'&&input.repair!==undefined||task==='period'&&input.repair!==undefined){
  const r=input.repair;
  if(!r||typeof r!=='object'||!r.candidate||typeof r.candidate!=='object'||!Array.isArray(r.issues)||!r.issues.length)throw Error('The repair request could not be read.');
  if(task==='editor')validateAIResult('editor',r.candidate,input.answers);
  else if(task==='period')validateAIResult('period',r.candidate,input.answers);
  else validateEventShape(r.candidate);
  for(const issue of r.issues)validateVerifyIssue(issue,r.candidate,input.answers);
 }
 if(task==='video'){
  if(!input.event?.confirmed||typeof input.event.title!=='string'||typeof input.event.summary!=='string')throw Error('Confirm your event before planning a video.');
  validateRefs(input.event.confirmedSources,input.answers);
  if(input.event.confirmedSources.length!==input.answers.length)throw Error('Review the new answers before planning a video.');
  if(!enoughMaterial(input))throw Error('Add at least three answers with a little more detail before planning a video.');
  if(input.story!==undefined){if(!Array.isArray(input.story)||input.story.length>60)throw Error('The approved story could not be read.');for(const s of input.story){if(!s||typeof s.text!=='string'||!s.text.trim()||s.text.length>20000||typeof s.sourceId!=='string'||!Number.isInteger(s.sourceRevision))throw Error('An approved passage is missing or invalid.');if(!input.answers.some(a=>a.id===s.sourceId&&a.revision===s.sourceRevision))throw Error('An approved passage refers to an unknown answer version.');}}
  const o=input.options;if(!o||!['warm','documentary','dramatic','humorous'].includes(o.tone)||!['sunlit-studio','garden','tv-show'].includes(o.setting)||!['thoughtful','curious','playful'].includes(o.host))throw Error('Choose a host, setting, and tone.');
 }
 return input;
}
