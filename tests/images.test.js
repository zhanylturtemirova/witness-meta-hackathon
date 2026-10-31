import test from 'node:test';
import assert from 'node:assert/strict';
import {exampleProject,reviseAnswer} from '../web/domain.js';
import {mockEvent,mockVideo} from '../web/mock-ai.js';
import {projectInput} from '../web/ai-client.js';
import {saveEvent,confirmEvent,saveVideo} from '../web/event-model.js';
import {buildImageRequest,runMetaImage,isImageLiveEnabled} from '../server/ai/images.mjs';
import {handleAI} from '../server/ai/routes.mjs';
import {generateSceneImage} from '../web/scene-images.js';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jAKQAAAAASUVORK5CYII=';
function ready(){const p=exampleProject();saveEvent(p,mockEvent(projectInput(p)));confirmEvent(p,{title:p.event.title,summary:p.event.summary});const options={host:'thoughtful',setting:'garden',tone:'warm'};saveVideo(p,mockVideo({...projectInput(p),event:p.event,options}),options);return p;}
function input(p=ready()){return {...projectInput(p),event:p.event,options:p.video.options,scene:p.video.scenes[0],visualNote:'Soft afternoon light'};}
function request(body,origin='http://localhost'){return new Request('http://localhost/api/ai/image',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});}
const enabled={META_AI_ENABLED:'true',MODEL_API_KEY:'test-key'};
test('image requests use the Meta model, one image and only the selected source excerpt',()=>{
 const i=input(),body=buildImageRequest(i);assert.equal(body.model,'muse-image-1.0');assert.equal(body.n,1);assert.equal(body.response_format,'b64_json');assert.equal(body.output_format,'png');assert.deepEqual(body.tool_enablement,{enable_image_search:false,enable_web_search:false,enable_shell:false});assert.ok(body.prompt.includes(i.scene.narratorText));assert.ok(!body.prompt.includes(i.answers[2].text));assert.equal(isImageLiveEnabled(enabled),true);assert.equal(isImageLiveEnabled({...enabled,META_IMAGE_ENABLED:'false'}),false);assert.equal(isImageLiveEnabled({MODEL_API_KEY:'test'}),false);
 i.scene={...i.scene,narratorText:'An invented memory.'};assert.throws(()=>buildImageRequest(i),/directly from a source/);
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
 const p=ready();let calls=0;const fetcher=async()=>{calls++;return Response.json({error:'Meta is busy'},{status:429});};await assert.rejects(()=>generateSceneImage(p,0,'',{fetcher}),/Meta is busy/);assert.equal(calls,1);
 reviseAnswer(p,p.answers[0].id,'A changed memory.');await assert.rejects(()=>generateSceneImage(p,0,'',{fetcher}),/current storyboard/);assert.equal(calls,1);
 const fresh=ready();const image=await generateSceneImage(fresh,0,'',{fetcher:async()=>Response.json({provider:'meta',model:'muse-image-1.0',mimeType:'image/png',image:png})});assert.equal(image.blob.type,'image/png');assert.ok(image.blob.size>8);
});
