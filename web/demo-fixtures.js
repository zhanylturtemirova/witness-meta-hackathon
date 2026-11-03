import {newProject,addAnswer,setInterviewer} from './domain.js';

// Clearly fictional English interview fixtures for demos, manual checks, and
// automated tests. Fictional people, places, and companies only. Four cases are
// marked holdout:true and are reserved for evaluation AFTER prompt changes:
// automated behavioral tests must use the other eight.
export const INTERVIEW_FIXTURES=[
 {id:'EJ-01',title:'A quiet rainy evening',topic:'small-moment',holdout:false,
  entries:[
   {q:'What stayed with you from today?',text:'Rain ran down the kitchen window all evening. I made soup and read for an hour.'},
   {q:'What did that evening feel like?',text:'Slow and calm. The flat felt small in a good way.'}
  ],
  expected:{facts:['rain in the evening','made soup','read for an hour'],unknowns:['exact date','who else was home'],refs:[{entry:0,note:'evening scene'},{entry:1,note:'feeling'}]},
  prohibited:['2019','Manchester','sister','concert']},
 {id:'EJ-02',title:'A morning walk',topic:'small-moment',holdout:false,
  entries:[
   {q:'What stayed with you from today?',text:'I walked to the bakery before eight and bought two warm rolls.'},
   {q:'What do you remember about the walk?',text:'The street was empty and the air smelled like rain.'}
  ],
  expected:{facts:['walk to the bakery','two warm rolls','empty street'],unknowns:['bakery name','exact date'],refs:[{entry:0,note:'errand'},{entry:1,note:'walk'}]},
  prohibited:['Lisbon','sister','2018','birthday']},
 {id:'FW-01',title:'My first job at a small house-building company',topic:'turning-point',holdout:false,
  entries:[
   {q:'What is a moment that changed the direction of your life?',text:'It was 2019, I think, the summer I left school. A small house-building company hired me as a labourer.'},
   {q:'What did the work involve?',text:'Carrying timber, mixing mortar, and sweeping up at the end of the day. My hands hurt for a month.'},
   {q:'Who taught you something there?',text:'Ray, the foreman, showed me how to read a level. He never raised his voice.'},
   {q:'What are you proud of from that summer?',text:'I helped finish a garden fence by myself. The owners brought us cold drinks.'}
  ],
  expected:{facts:['hired as a labourer','carrying timber','Ray the foreman','finished a garden fence'],unknowns:['company name','exact start date','town'],refs:[{entry:0,note:'hiring'},{entry:1,note:'tasks'},{entry:2,note:'mentor'},{entry:3,note:'victory'}]},
  prohibited:['Harrison','2015','London','apprenticeship certificate']},
 {id:'FW-02',title:'Saturday shifts at a corner café',topic:'turning-point',holdout:true,
  entries:[
   {q:'What is a moment that changed the direction of your life?',text:'When I was seventeen I started Saturday shifts at a corner café near the station.'},
   {q:'What did you learn there?',text:'How to remember five orders at once and how to stay polite when the queue never ends.'}
  ],
  expected:{facts:['Saturday shifts','corner café','remembering orders'],unknowns:['café name','pay','year'],refs:[{entry:0,note:'start'},{entry:1,note:'skills'}]},
  prohibited:['Marco','2016','barista school','Paris']},
 {id:'CO-01',title:'A concert with my sister',topic:'small-moment',holdout:false,
  entries:[
   {q:'Which ordinary day or small moment do you keep coming back to?',text:'We went to a concert in Manchester around 2018. The band played until late.'},
   {q:'Who was with you?',text:'My sister. The music was so loud she covered her ears and laughed.'},
   {q:'What stayed with you from that night?',text:'Walking home past midnight, still hearing the last song. I am not sure about the month.'}
  ],
  expected:{facts:['concert in Manchester','sister present','walked home past midnight'],unknowns:['exact date','band name','venue'],refs:[{entry:0,note:'occasion'},{entry:1,note:'sister'},{entry:2,note:'walk home'}]},
  prohibited:['2015','O2 Arena','The Walters','birthday']},
 {id:'CO-02',title:'A stadium show in the rain',topic:'small-moment',holdout:true,
  entries:[
   {q:'Which ordinary day or small moment do you keep coming back to?',text:'A stadium show in the rain. We stood through the whole set without sitting down.'},
   {q:'Who did you go with?',text:'Two friends from school. We lost each other twice and laughed about it after.'}
  ],
  expected:{facts:['stadium show','rain','two school friends'],unknowns:['band','city','year'],refs:[{entry:0,note:'show'},{entry:1,note:'friends'}]},
  prohibited:['Wembley','2017','encore setlist','sister']},
 {id:'MV-01',title:'Moving to a new city',topic:'turning-point',holdout:false,
  entries:[
   {q:'What is a moment that changed the direction of your life?',text:'We moved to Bristol in 2021 with two suitcases and no plan.'},
   {q:'What do you remember about the first day?',text:'The flat was empty except for a mattress. We ate noodles sitting on the floor.'}
  ],
  expected:{facts:['moved to Bristol','2021','two suitcases','noodles on the floor'],unknowns:['street','reason for moving'],refs:[{entry:0,note:'move'},{entry:1,note:'first day'}]},
  prohibited:['London','2019','new job','landlord name']},
 {id:'MV-02',title:'The first night in the flat',topic:'small-moment',holdout:true,
  entries:[
   {q:'What stayed with you from today?',text:'Our first night in the new flat. The rooms echoed and the heating clicked all night.'},
   {q:'What made it feel like yours?',text:'Nothing yet, except a chipped mug we unpacked first and put on the windowsill.'}
  ],
  expected:{facts:['first night','echoing rooms','chipped mug'],unknowns:['city','date'],refs:[{entry:0,note:'night'},{entry:1,note:'mug'}]},
  prohibited:['Bristol','2021','landlord','renovation']},
 {id:'UN-01',title:'A song I only half remember',topic:'person',holdout:false,
  entries:[
   {q:'Who would you like to remember?',text:'My grandmother hummed an old lullaby while the kettle rattled on the stove. I think it was winter, but I am not sure.'},
   {q:'What else comes back?',text:'Maybe a green armchair. The rest is gone, and I would rather keep it that way than invent it.'}
  ],
  expected:{facts:['grandmother','lullaby','kettle rattled'],unknowns:['season','song title','armchair colour'],refs:[{entry:0,note:'scene'},{entry:1,note:'limits'}]},
  prohibited:['Edelweiss','December','Bavaria','piano']},
 {id:'CR-01',title:'A date I got wrong',topic:'small-moment',holdout:false,
  entries:[
   {q:'Which ordinary day do you keep coming back to?',text:'A concert in Leeds. At first I said 2018, but the ticket stub says 2019.'},
   {q:'What do you remember from the night?',text:'Standing near the front. The lights went down and everyone went quiet for a second.'}
  ],
  expected:{facts:['concert in Leeds','corrected year 2019','standing near the front'],unknowns:['month','band'],refs:[{entry:0,note:'correction'},{entry:1,note:'night'}]},
  prohibited:['2018','O2 Academy','birthday','sister']},
 {id:'RF-01',title:'A question I skip',topic:'person',holdout:false,
  entries:[
   {q:'Who would you like to remember?',text:'My uncle taught me to fish. I would rather not talk about the last summer, though.'}
  ],
  expected:{facts:['uncle','taught fishing'],unknowns:['everything about the last summer'],refs:[{entry:0,note:'boundary'}]},
  prohibited:['funeral','2016','lake house','quarrel']},
 {id:'SH-01',title:'Three short lines',topic:'small-moment',holdout:true,
  entries:[
   {q:'What stayed with you from today?',text:'Rain on the windows.'},
   {q:'Anything else?',text:'Soup for dinner.'},
   {q:'One more?',text:'Bed early.'}
  ],
  expected:{facts:['rain','soup','bed early'],unknowns:['almost everything else'],refs:[{entry:0,note:'weather'},{entry:1,note:'dinner'},{entry:2,note:'rest'}]},
  prohibited:['Manchester','sister','2018','concert']}
];
export const DEMO_STORY_ID='FW-01';
export const HOLDOUT_IDS=['FW-02','CO-02','MV-02','SH-01'];
// The browsable demo collection: four fictional stories for trying the flow,
// separate from the evaluation fixtures above so eval counts never shift.
// The last two are supporting stories for variety, not the main walkthrough.
export const DEMO_COLLECTION=[
 {id:'DC-01',title:'Three knocks through the wall',topic:'person',supporting:false,
  entries:[
   {q:'Who would you like to remember?',text:'My sister moved to Toronto two years ago, I think. We call every Sunday evening.'},
   {q:'What do you remember from when you lived close?',text:'We shared a wall between our rooms. Three knocks meant good night.'},
   {q:'What happens on the calls now?',text:'She knocks three times on the phone speaker before hanging up. I knock back on my desk.'}
  ],
  expected:{facts:['sister in Toronto','Sunday evening calls','three knocks meant good night','knocks on the phone and desk'],unknowns:['exact year of the move','sister occupation'],refs:[{entry:0,note:'calls'},{entry:1,note:'ritual'},{entry:2,note:'today'}]},
  prohibited:['Kowalski','2019','Montreal','three children']},
 {id:'DC-02',title:"Dad's first message",topic:'person',supporting:false,
  entries:[
   {q:'Who would you like to remember?',text:'My dad sent his first message last spring. No words, just a photo.'},
   {q:'What was in the photo?',text:'His tomato plant on the balcony. One small green tomato.'},
   {q:'Did he send more?',text:'One every few days now. Still no words. Under one photo he typed a single word: bigger.'}
  ],
  expected:{facts:['first message last spring','photo with no words','balcony tomato plant','regular photos'],unknowns:['dad name','city','phone type'],refs:[{entry:0,note:'first message'},{entry:1,note:'photo'},{entry:2,note:'habit'}]},
  prohibited:['Petrov','2021','WhatsApp','birthday']},
 {id:'DC-03',title:'"I checked the forecast"',topic:'small-moment',supporting:true,
  entries:[
   {q:'Which ordinary day do you keep coming back to?',text:'My father texts me before every trip. Short messages, usually about the weather.'},
   {q:'What did the last one say?',text:'Last month he wrote: I checked the forecast. Take the blue jacket.'},
   {q:'Did you listen?',text:'I took the jacket. It rained the whole weekend.'}
  ],
  expected:{facts:['texts before every trip','forecast message','took the blue jacket','rained all weekend'],unknowns:['destination','father name'],refs:[{entry:0,note:'habit'},{entry:1,note:'message'},{entry:2,note:'trip'}]},
  prohibited:['Gatwick','2022','new car','surname']},
 {id:'DC-04',title:'"Just stay on the line"',topic:'small-moment',supporting:true,
  entries:[
   {q:'What did Friday look like?',text:'On Fridays my friend and I call and leave the phones on the table.'},
   {q:'What do you do while you talk?',text:'She cooks dinner and I fold laundry. We talk when something comes up.'},
   {q:'How long did the last call run?',text:'Two hours last Friday. Mostly quiet.'}
  ],
  expected:{facts:['Friday calls','phones on the table','cooking and laundry','two hours, mostly quiet'],unknowns:['friend name','city'],refs:[{entry:0,note:'ritual'},{entry:1,note:'evening'},{entry:2,note:'last call'}]},
  prohibited:['Zoom','2023','birthday','wedding']}
];
export function fixtureById(id){return INTERVIEW_FIXTURES.find(f=>f.id===id)||DEMO_COLLECTION.find(f=>f.id===id)||null;}
// Builds a brand-new project from a fixture. Always creates fresh identities,
// so loading a demo can never overwrite an existing story. Demo projects are
// marked as fictional examples for visible provenance; no model path reads
// these flags, so AI behaviour is identical to any other project.
export function buildDemoProject(fixture){
 const p=newProject(fixture.topic);
 p.title=fixture.title;
 p.example=true;p.demoFixtureId=fixture.id;
 for(const e of fixture.entries){
  setInterviewer(p,{result:{question:e.q},provider:'prompt',model:null});
  addAnswer(p,e.text);
 }
 p.interviewer=null;p.draft='';
 return p;
}
// Starts an empty demo interview: the first fixture question is set, but no
// answers are submitted, so the narrator speaks or types each entry.
export function buildDemoStarter(fixture){
 const p=newProject(fixture.topic);
 p.title=fixture.title;
 p.example=true;p.demoFixtureId=fixture.id;
 setInterviewer(p,{result:{question:fixture.entries[0].q},provider:'prompt',model:null});
 p.draft='';
 return p;
}
