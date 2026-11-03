import test from 'node:test';
import assert from 'node:assert/strict';
import {exampleProject,reviseAnswer} from '../web/domain.js';
import {mockEvent,mockVideo} from '../web/mock-ai.js';
import {projectInput} from '../web/ai-client.js';
import {saveEvent,confirmEvent,saveVideo,approveSceneIllustration,sceneApprovalValid,approveFilmLook} from '../web/event-model.js';
import {buildImageRequest,runMetaImage,isImageLiveEnabled} from '../server/ai/images.mjs';
import {handleAI} from '../server/ai/routes.mjs';
import {generateSceneImage,renderStyleText} from '../web/scene-images.js';
import {mediaSave,MEDIA_IMAGES} from '../web/media-store.js';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jAKQAAAAASUVORK5CYII=';
function ready(){const p=exampleProject();saveEvent(p,mockEvent(projectInput(p)));confirmEvent(p,{title:p.event.title,summary:p.event.summary});const options={host:'thoughtful',setting:'garden',tone:'warm'};saveVideo(p,mockVideo({...projectInput(p),event:p.event,options}),options);return p;}
function input(p=ready()){return {...projectInput(p),event:p.event,options:p.video.options,scene:p.video.scenes[0],visualNote:'Soft afternoon light',styleText:'Warm palette; painted look'};}
function request(body,origin='http://localhost'){return new Request('http://localhost/api/ai/image',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});}
const enabled={META_AI_ENABLED:'true',MODEL_API_KEY:'test-key'};
test('image requests use the Meta model, one image and only the selected source excerpt',()=>{
 const i=input(),built=buildImageRequest(i),body=built.request;assert.equal(built.endpoint,'generations');assert.equal(body.model,'muse-image-1.0');assert.equal(body.n,1);assert.equal(body.response_format,'b64_json');assert.equal(body.output_format,'png');assert.deepEqual(body.tool_enablement,{enable_image_search:false,enable_web_search:false,enable_shell:false});assert.ok(body.prompt.includes(i.scene.caption));assert.ok(body.prompt.includes(i.scene.visual));assert.ok(body.prompt.includes('not a biographical claim'));assert.ok(body.prompt.includes('hand-painted gouache'));assert.ok(body.prompt.includes('never force an autumn look'));assert.ok(body.prompt.includes('Warm palette'));assert.ok(!body.prompt.includes(i.answers[2].text));assert.equal(isImageLiveEnabled(enabled),true);assert.equal(isImageLiveEnabled({...enabled,META_IMAGE_ENABLED:'false'}),false);assert.equal(isImageLiveEnabled({MODEL_API_KEY:'test'}),false);
 i.scene={...i.scene,narratorText:'An invented memory.'};assert.throws(()=>buildImageRequest(i),/directly from a source/);
});
test('later scenes reuse the first approved illustration through the edits endpoint',async()=>{
 const i=input(),ref='data:image/png;base64,'+png;
 const built=buildImageRequest({...i,referenceImage:ref});
 assert.equal(built.endpoint,'edits');assert.deepEqual(built.request.images,[{image_url:ref}]);assert.ok(built.request.prompt.includes('reference image'));
 const result=await runMetaImage({...i,referenceImage:ref},{apiKey:'test-key',fetcher:async(url,opts)=>{assert.equal(url,'https://api.meta.ai/v1/images/edits');assert.equal(JSON.parse(opts.body).images[0].image_url,ref);return Response.json({data:[{b64_json:png}]});}});
 assert.equal(result.usedReference,true);assert.equal(result.image,png);
 assert.throws(()=>buildImageRequest({...i,referenceImage:'data:image/png;base64,'+btoa('not an image')}),/supported image file/);
 assert.throws(()=>buildImageRequest({...i,referenceImage:'data:image/gif;base64,'+png}),/under 8 MB/);
 assert.throws(()=>buildImageRequest({...i,referenceImage:'data:image/png;base64,'+'A'.repeat(11000000)}),/under 8 MB/);
});
test('shared style text renders people, clothing, and places for every scene',()=>{
 const p=ready();
 assert.equal(renderStyleText(p.video.styleSpec).includes('Palette:'),true);
 assert.equal(renderStyleText(null),'');
});
test('Meta image adapter returns validated bytes and never returns key or provider error bodies',async()=>{
 const result=await runMetaImage(input(),{apiKey:'test-key',fetcher:async(url,opts)=>{assert.equal(url,'https://api.meta.ai/v1/images/generations');assert.equal(opts.headers.Authorization,'Bearer test-key');return Response.json({data:[{b64_json:png}]});}});assert.equal(result.image,png);assert.equal(result.model,'muse-image-1.0');assert.ok(!JSON.stringify(result).includes('test-key'));
 await assert.rejects(()=>runMetaImage(input(),{apiKey:'test-key',fetcher:async()=>Response.json({data:[{b64_json:btoa('not an image')}]})}),/unsupported image/);
 await assert.rejects(()=>runMetaImage(input(),{apiKey:'test-key',fetcher:async()=>Response.json({error:'private-provider-details'},{status:403})}),/does not have access/);
});
test('image route requires explicit live configuration, same-origin JSON and a single request at a time',async()=>{
 let calls=0,release;const fetcher=async()=>{calls++;return new Promise(resolve=>{release=()=>resolve(Response.json({data:[{b64_json:png}]}));});};
 assert.equal((await handleAI(request(input()),{},fetcher)).status,503);
 assert.equal((await handleAI(request(input(),'https://other.example'),enabled,fetcher)).status,403);assert.equal(calls,0);
 const first=handleAI(request(input()),enabled,fetcher);while(!release)await new Promise(r=>setTimeout(r,0));
 assert.equal((await handleAI(request(input()),enabled,fetcher)).status,429);assert.equal(calls,1);release();assert.equal((await first).status,200);
 const status=await (await handleAI(new Request('http://localhost/api/ai-status'),enabled)).json();assert.equal(status.imageLiveAvailable,true);assert.equal(status.imageModel,'muse-image-1.0');
});
test('browser image failures never retry or fall back, and stale sources make no requests',async()=>{
 const p=ready();approveSceneIllustration(p,0);let calls=0;const fetcher=async()=>{calls++;return Response.json({error:'Meta is busy'},{status:429});};await assert.rejects(()=>generateSceneImage(p,0,'',{fetcher}),/Meta is busy/);assert.equal(calls,1);
 reviseAnswer(p,p.answers[0].id,'A changed memory.');await assert.rejects(()=>generateSceneImage(p,0,'',{fetcher}),/current storyboard/);assert.equal(calls,1);
 const fresh=ready();approveSceneIllustration(fresh,0);const image=await generateSceneImage(fresh,0,'',{fetcher:async()=>Response.json({provider:'meta',model:'muse-image-1.0',mimeType:'image/png',image:png})});assert.equal(image.blob.type,'image/png');assert.ok(image.blob.size>8);
});
test('scene two sends the approved scene 1 look as reference',async()=>{
 const p=ready();approveSceneIllustration(p,1);
 const bytes=Buffer.from(png,'base64');
 await mediaSave(MEDIA_IMAGES,{id:'ref-1',projectId:p.id,blob:new Blob([bytes],{type:'image/png'})});
 p.video.scenes[0].image={id:'ref-1',kind:'meta',provider:'meta',model:'muse-image-1.0',createdAt:Date.now()};
 approveFilmLook(p);
 let sent=null;
 const fetcher=async(_url,opts)=>{sent=JSON.parse(opts.body);return Response.json({provider:'meta',model:'muse-image-1.0',mimeType:'image/png',image:png,usedReference:true});};
 const out=await generateSceneImage(p,1,'',{fetcher});
 assert.ok(sent.referenceImage.startsWith('data:image/png;base64,'));assert.equal(out.usedReference,true);assert.equal(out.referenceId,'ref-1');
});
test('later scenes block before any paid request without an approved, readable reference',async()=>{
 let calls=0;
 const counting=async()=>{calls++;return Response.json({provider:'meta',model:'muse-image-1.0',mimeType:'image/png',image:png});};
 const missing=ready();approveSceneIllustration(missing,1);
 await assert.rejects(generateSceneImage(missing,1,'',{fetcher:counting}),/Use this look for the film/);
 const unapproved=ready();approveSceneIllustration(unapproved,1);
 unapproved.video.scenes[0].image={id:'ref-1',kind:'meta',provider:'meta',model:'muse-image-1.0',createdAt:Date.now()};
 await assert.rejects(generateSceneImage(unapproved,1,'',{fetcher:counting}),/never approved/);
 const approved=ready();approveSceneIllustration(approved,1);
 approved.video.scenes[0].image={id:'gone',kind:'meta',provider:'meta',model:'muse-image-1.0',createdAt:Date.now()};
 approveFilmLook(approved);
 await assert.rejects(generateSceneImage(approved,1,'',{fetcher:counting}),/could not be opened/);
 assert.equal(calls,0);
});
test('scene images need narrator approval first, and changed sources invalidate it',async()=>{
 const p=ready();let calls=0;
 await assert.rejects(()=>generateSceneImage(p,0,'',{fetcher:async()=>{calls++;return Response.json({});}}),/Approve this scene excerpt/);assert.equal(calls,0);
 approveSceneIllustration(p,1);assert.equal(sceneApprovalValid(p,1),true);assert.equal(sceneApprovalValid(p,0),false);
 reviseAnswer(p,p.answers[0].id,'A changed memory.');
 assert.equal(sceneApprovalValid(p,1),false);
 assert.throws(()=>approveSceneIllustration(p,1),/current storyboard/);
});
test('a new storyboard drops earlier illustration approvals',async()=>{
 const p=ready();approveSceneIllustration(p,0);assert.equal(sceneApprovalValid(p,0),true);
 saveVideo(p,mockVideo({...projectInput(p),event:p.event,options:p.video.options}),p.video.options);
 assert.equal(sceneApprovalValid(p,0),false);
});
