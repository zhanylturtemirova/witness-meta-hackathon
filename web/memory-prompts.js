// Optional invitations, never claims about the narrator's life.
export const MEMORY_PROMPTS=[
 {id:'deja-vu',label:'A strange sense of familiarity',question:'Have you ever had déjà vu — a moment that felt as though you had lived it before? If so, what do you remember?',topic:'small-moment'},
 {id:'patronus',label:'A memory to hold on to',question:'If you could summon a Patronus to keep the Dementors away, which happy memory would you draw on?',topic:'small-moment'},
 {id:'calling',label:'Finding your path',question:'Was there a moment when you began to understand what kind of work you wanted to do?',topic:'turning-point'},
 {id:'belonging',label:'Somewhere you belonged',question:'Can you remember a moment when a place or a group of people began to feel like home?',topic:'small-moment'},
 {id:'kindness',label:'An unexpected kindness',question:'Has a small kindness stayed with you longer than you expected? What happened?',topic:'person'},
 {id:'younger-self',label:'Something you once loved',question:'What did you love doing when you were younger, before you thought about whether you were good at it?',topic:'small-moment'}
];
export function promptOptions(p){
 const used=new Set([...(p.usedMemoryPrompts||[]),...p.answers.map(a=>a.promptId).filter(Boolean)]);
 const text=p.answers.map(a=>a.text).join(' ');
 // A profession is personalised only when the narrator has stated it.
 const profession=text.match(/\bI (?:am|was|became|work as|wanted to be) (?:an? )?(teacher|nurse|doctor|engineer|artist|writer|designer|programmer)\b/i)?.[1];
 return MEMORY_PROMPTS.filter(x=>!used.has(x.id)).map(x=>x.id==='calling'&&profession?{...x,question:`How did you first realise you wanted to be ${/^[aeiou]/i.test(profession)?'an':'a'} ${profession.toLowerCase()}?`}:x);
}
export function suggestedPrompt(p){
 if(p.memoryNudges===false)return null;
 const n=p.answers.length;
 if(n%3!==0||p.dismissedNudgeAt===n||p.interviewer?.provider==='prompt')return null;
 const options=promptOptions(p);return options[(p.memoryPromptOffset||0)%options.length]||null;
}
export function useMemoryPrompt(p,prompt){
 if(p.draft?.trim())throw Error('Save your answer or clear the draft before changing the question.');
 p.usedMemoryPrompts=[...new Set([...(p.usedMemoryPrompts||[]),prompt.id])];
 p.dismissedNudgeAt=p.answers.length;
 p.interviewer={question:prompt.question,intent:'opening',sourceRefs:[],enoughMaterial:false,suggestedNextStep:'continue',provider:'prompt',model:null,promptId:prompt.id};
 p.updatedAt=Date.now();
}
