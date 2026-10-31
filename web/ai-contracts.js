const refSchema={type:'object',properties:{answerId:{type:'string'},revision:{type:'integer'}},required:['answerId','revision'],additionalProperties:false};
const refsSchema={type:'array',items:refSchema};
export const AI_SCHEMAS={
 interview:{type:'object',properties:{question:{type:'string'},intent:{type:'string',enum:['opening','place','time','people','detail','meaning','clarify','wrap_up']},sourceRefs:refsSchema,enoughMaterial:{type:'boolean'},suggestedNextStep:{type:'string',enum:['continue','review_event']}},required:['question','intent','sourceRefs','enoughMaterial','suggestedNextStep'],additionalProperties:false},
 event:{type:'object',properties:{title:{type:'string'},summary:{type:'string'},dateText:{type:['string','null']},location:{type:['string','null']},people:{type:'array',items:{type:'string'}},themes:{type:'array',items:{type:'string'}},detailsToConfirm:{type:'array',items:{type:'string'}},sourceRefs:refsSchema},required:['title','summary','dateText','location','people','themes','detailsToConfirm','sourceRefs'],additionalProperties:false},
 video:{type:'object',properties:{title:{type:'string'},logline:{type:'string'},scenes:{type:'array',items:{type:'object',properties:{title:{type:'string'},hostQuestion:{type:'string'},narratorText:{type:'string'},visualDirection:{type:'string'},sourceRefs:refsSchema},required:['title','hostQuestion','narratorText','visualDirection','sourceRefs'],additionalProperties:false}}},required:['title','logline','scenes'],additionalProperties:false},
 verify:{type:'object',properties:{supported:{type:'boolean'},issues:{type:'array',items:{type:'object',properties:{field:{type:'string',enum:['title','summary','dateText','location','people','themes','detailsToConfirm']},statement:{type:'string'},answerRefs:refsSchema,reason:{type:'string',enum:['invented_fact','contradiction','certainty_overreach']}},required:['field','statement','answerRefs','reason'],additionalProperties:false}}},required:['supported','issues'],additionalProperties:false}
};
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
export function validateAIResult(task,result,answers){
 if(!result||typeof result!=='object')throw Error('The result could not be read.');
 if(task==='interview'){
  if(!str(result.question,600)||!AI_SCHEMAS.interview.properties.intent.enum.includes(result.intent)||typeof result.enoughMaterial!=='boolean'||!['continue','review_event'].includes(result.suggestedNextStep))throw Error('The interview response is incomplete.');
  validateRefs(result.sourceRefs,answers,{allowEmpty:true});
 }else if(task==='event'){
  validateEventShape(result);
  validateRefs(result.sourceRefs,answers);
  if(result.sourceRefs.length!==answers.length)throw Error('The event must include all interview answers.');
 }else if(task==='video'){
  if(!str(result.title,120)||!str(result.logline,2000)||!Array.isArray(result.scenes)||!result.scenes.length||result.scenes.length>8)throw Error('The video plan is incomplete.');
  for(const scene of result.scenes){if(!str(scene.title,120)||!str(scene.hostQuestion,600)||!str(scene.narratorText,4000)||!str(scene.visualDirection,2000))throw Error('A video scene is incomplete.');validateRefs(scene.sourceRefs,answers);if(!scene.sourceRefs.some(r=>answers.find(a=>a.id===r.answerId)?.text.includes(scene.narratorText)))throw Error('Narrator lines must come directly from a source answer.');}
 }else throw Error('Unknown AI task.');
 return result;
}
export function validateAIInput(task,input){
 if(!AI_SCHEMAS[task]||!input||typeof input!=='object'||typeof input.title!=='string'||input.title.length>120||!Array.isArray(input.answers)||input.answers.length>60)throw Error('This interview could not be read.');
 let total=0;const seen=new Set();for(const a of input.answers){if(!a||typeof a.id!=='string'||!Number.isInteger(a.revision)||a.revision<1||typeof a.question!=='string'||typeof a.text!=='string'||!a.text.trim()||a.text.length>20000||seen.has(a.id))throw Error('An answer is missing or invalid.');total+=a.text.length;seen.add(a.id);}
 if(total>100000)throw Error('Please use a shorter interview for this preview.');
 if(task!=='interview'&&!input.answers.length)throw Error('Add an answer before building an event.');
 if(task==='verify'){
  if(!input.candidate||typeof input.candidate!=='object')throw Error('There is no draft to check.');
  validateEventShape(input.candidate);
 }
 if(task==='event'&&input.repair!==undefined){
  const r=input.repair;
  if(!r||typeof r!=='object'||!r.candidate||typeof r.candidate!=='object'||!Array.isArray(r.issues)||!r.issues.length)throw Error('The repair request could not be read.');
  validateEventShape(r.candidate);
  for(const issue of r.issues)validateVerifyIssue(issue,r.candidate,input.answers);
 }
 if(task==='video'){
  if(!input.event?.confirmed||typeof input.event.title!=='string'||typeof input.event.summary!=='string')throw Error('Confirm your event before planning a video.');
  validateRefs(input.event.confirmedSources,input.answers);
  if(input.event.confirmedSources.length!==input.answers.length)throw Error('Review the new answers before planning a video.');
  if(!enoughMaterial(input))throw Error('Add at least three answers with a little more detail before planning a video.');
  const o=input.options;if(!o||!['warm','documentary','dramatic','humorous'].includes(o.tone)||!['sunlit-studio','garden','tv-show'].includes(o.setting)||!['thoughtful','curious','playful'].includes(o.host))throw Error('Choose a host, setting, and tone.');
 }
 return input;
}
