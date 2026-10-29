import {runMockTask} from './mock-ai.js';
// Browser and hosted previews stay local. No requests, keys, or automatic provider fallback.
export const witnessAI={interview:input=>runMockTask('interview',input),event:input=>runMockTask('event',input),video:input=>runMockTask('video',input)};
export function projectInput(project){return {title:project.title,topicId:project.topicId,questionIndex:project.questionIndex,answers:project.answers.map(({id,revision,text,question})=>({id,revision,text,question})),askedIntents:[...project.answers.map(a=>a.intent),...(project.skippedIntents||[])].filter(Boolean)};}
