import test from 'node:test';
import assert from 'node:assert/strict';
import {exampleProject} from '../web/domain.js';
import {mockEvent,mockVideo} from '../web/mock-ai.js';
import {projectInput} from '../web/ai-client.js';
import {validateStoryboard,validateAIResult} from '../web/ai-contracts.js';
import {saveEvent,confirmEvent,saveVideo,approveSceneIllustration,sceneApprovalValid,approveFilmLook,filmLookValid,sceneImageNeedsReview,acceptDependentImage} from '../web/event-model.js';
import {recordSceneImage} from '../web/video-export.js';
import {artDirector} from '../agents/art-director.mjs';
import {fixtureById,buildDemoProject} from '../web/demo-fixtures.js';
import {agentForTask} from '../agents/index.mjs';
import {buildMetaRequest} from '../server/ai/meta.mjs';

const options = {host: 'thoughtful', setting: 'garden', tone: 'warm'};
function ready() {
  const p = exampleProject();
  saveEvent(p, mockEvent(projectInput(p)));
  confirmEvent(p, {title: p.event.title, summary: p.event.summary});
  return p;
}
function board(p = ready()) {
  return mockVideo({...projectInput(p), event: p.event, options});
}

test('mock storyboards carry 4-6 chronological scenes, captions, and one style', () => {
  const p = ready(), result = board(p);
  assert.ok(result.scenes.length >= 4 && result.scenes.length <= 6);
  assert.ok(result.styleSpec && result.styleSpec.palette && result.styleSpec.technique);
  const order = result.scenes.map(s => p.answers.findIndex(a => a.id === s.sourceRefs[0].answerId));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  for (const s of result.scenes) {
    assert.ok(s.caption && p.answers.some(a => a.text.includes(s.caption)));
    assert.ok(s.visual && Number.isInteger(s.seconds));
  }
  validateStoryboard(result, p.answers);
});

test('storyboard validation refuses wrong counts, disorder, and invented details', () => {
  const p = ready(), base = board(p);
  assert.throws(() => validateStoryboard({...base, scenes: base.scenes.slice(0, 3)}, p.answers), /4 to 6/);
  assert.throws(() => validateStoryboard({...base, styleSpec: undefined}, p.answers), /shared style/);
  const swapped = {...base, scenes: [base.scenes[2], base.scenes[0], ...base.scenes.slice(1, 2), ...base.scenes.slice(3)]};
  assert.throws(() => validateStoryboard(swapped, p.answers), /order of the interview/);
  const noCaption = structuredClone(base);
  delete noCaption.scenes[0].caption;
  assert.throws(() => validateStoryboard(noCaption, p.answers), /caption, visual description, and duration/);
  const invented = structuredClone(base);
  invented.scenes[0].depictsPeople = ['Nobody McInvented'];
  assert.throws(() => validateStoryboard(invented, p.answers), /no source mentions/);
  const recaptioned = structuredClone(base);
  recaptioned.scenes[1].caption = 'Words nobody ever said here.';
  assert.throws(() => validateStoryboard(recaptioned, p.answers), /directly from a source/);
  const timed = structuredClone(base);
  timed.scenes[0].seconds = 99;
  assert.throws(() => validateStoryboard(timed, p.answers), /3 to 12 seconds/);
});

test('saving a video enforces the storyboard contract', () => {
  const p = ready();
  saveVideo(p, board(p), options);
  assert.ok(p.video.styleSpec);
  const old = board(p);
  const legacy = {title: 'Old', logline: 'Old plan.', scenes: old.scenes.slice(0, 3).map(s => ({title: s.title, hostQuestion: s.hostQuestion, narratorText: s.narratorText, visualDirection: s.visualDirection, sourceRefs: s.sourceRefs}))};
  assert.throws(() => saveVideo(p, legacy, options), /shared style/);
  assert.throws(() => saveVideo(p, {...legacy, styleSpec: old.styleSpec}, options), /4 to 6/);
});

test('illustration approval binds the caption; legacy approvals keep working', () => {
  const p = ready();
  saveVideo(p, board(p), options);
  approveSceneIllustration(p, 0);
  assert.equal(sceneApprovalValid(p, 0), true);
  p.video.scenes[0].caption = p.video.scenes[0].caption.slice(0, 20);
  assert.equal(sceneApprovalValid(p, 0), false);
  delete p.video.scenes[1].caption;
  p.video.scenes[1].illustrationApproval = {excerpt: p.video.scenes[1].narratorText, at: Date.now()};
  assert.equal(sceneApprovalValid(p, 1), true);
});

test('recorded images keep their reference link; other scenes keep theirs', () => {
  const p = ready();
  saveVideo(p, board(p), options);
  recordSceneImage(p, 0, {id: 'img-1', kind: 'meta', provider: 'meta', model: 'muse-image-1.0'});
  recordSceneImage(p, 1, {id: 'img-2', kind: 'meta', provider: 'meta', model: 'muse-image-1.0', refFrom: 'img-1'});
  assert.equal(p.video.scenes[0].image.refFrom, null);
  assert.equal(p.video.scenes[1].image.refFrom, 'img-1');
  recordSceneImage(p, 1, {id: 'img-2b', kind: 'meta', provider: 'meta', model: 'muse-image-1.0', refFrom: 'img-1'});
  assert.equal(p.video.scenes[1].image.id, 'img-2b');
  assert.equal(p.video.scenes[0].image.id, 'img-1');
  assert.throws(() => recordSceneImage(p, 9, {id: 'x'}), /Unknown scene/);
});

test('film-look approval binds the scene 1 image version and the shared style', () => {
  const p = ready();
  saveVideo(p, board(p), options);
  assert.throws(() => approveFilmLook(p), /scene 1 illustration/);
  p.video.scenes[0].image = {id: 'up-1', kind: 'upload', provider: 'upload', model: '', createdAt: Date.now()};
  assert.throws(() => approveFilmLook(p), /scene 1 illustration/);
  recordSceneImage(p, 0, {id: 'img-1', kind: 'meta', provider: 'meta', model: 'muse-image-1.0'});
  approveFilmLook(p);
  assert.equal(filmLookValid(p), true);
  assert.equal(p.video.scenes[0].illustrationApproval, undefined);
});

test('approving a new look never clears older dependents; accept or regenerate does', () => {
  const p = ready();
  saveVideo(p, board(p), options);
  recordSceneImage(p, 0, {id: 'img-1', kind: 'meta', provider: 'meta', model: 'muse-image-1.0'});
  recordSceneImage(p, 1, {id: 'img-2', kind: 'meta', provider: 'meta', model: 'muse-image-1.0', refFrom: 'img-1'});
  approveFilmLook(p);
  assert.deepEqual(sceneImageNeedsReview(p, 1), {review: false, reason: null});
  recordSceneImage(p, 0, {id: 'img-1b', kind: 'meta', provider: 'meta', model: 'muse-image-1.0'});
  assert.equal(filmLookValid(p), false);
  assert.deepEqual(sceneImageNeedsReview(p, 1), {review: true, reason: 'look-unapproved'});
  approveFilmLook(p);
  assert.deepEqual(sceneImageNeedsReview(p, 1), {review: true, reason: 'reference-replaced'});
  assert.equal(p.video.scenes[1].image.id, 'img-2');
  acceptDependentImage(p, 1);
  assert.deepEqual(sceneImageNeedsReview(p, 1), {review: false, reason: null});
  recordSceneImage(p, 0, {id: 'img-1c', kind: 'meta', provider: 'meta', model: 'muse-image-1.0'});
  approveFilmLook(p);
  assert.deepEqual(sceneImageNeedsReview(p, 1), {review: true, reason: 'reference-replaced'});
  recordSceneImage(p, 1, {id: 'img-2b', kind: 'meta', provider: 'meta', model: 'muse-image-1.0', refFrom: 'img-1c'});
  assert.deepEqual(sceneImageNeedsReview(p, 1), {review: false, reason: null});
  assert.deepEqual(sceneImageNeedsReview(p, 0), {review: false, reason: null});
});

test('a style change flags guided dependents until accepted under the new style', () => {
  const p = ready();
  saveVideo(p, board(p), options);
  recordSceneImage(p, 0, {id: 'img-1', kind: 'meta', provider: 'meta', model: 'muse-image-1.0'});
  recordSceneImage(p, 1, {id: 'img-2', kind: 'meta', provider: 'meta', model: 'muse-image-1.0', refFrom: 'img-1'});
  approveFilmLook(p);
  p.video.styleSpec.palette = 'cold neon colours';
  assert.deepEqual(sceneImageNeedsReview(p, 1), {review: true, reason: 'look-unapproved'});
  approveFilmLook(p);
  assert.deepEqual(sceneImageNeedsReview(p, 1), {review: true, reason: 'style-changed'});
  assert.equal(p.video.scenes[1].image.id, 'img-2');
  acceptDependentImage(p, 1);
  assert.deepEqual(sceneImageNeedsReview(p, 1), {review: false, reason: null});
});

test('uploads and unreferenced images are never flagged for look review', () => {
  const p = ready();
  saveVideo(p, board(p), options);
  recordSceneImage(p, 0, {id: 'img-1', kind: 'meta', provider: 'meta', model: 'muse-image-1.0'});
  recordSceneImage(p, 1, {id: 'up-2', kind: 'upload', provider: 'upload', model: ''});
  recordSceneImage(p, 2, {id: 'img-3', kind: 'meta', provider: 'meta', model: 'muse-image-1.0'});
  assert.deepEqual(sceneImageNeedsReview(p, 1), {review: false, reason: null});
  assert.deepEqual(sceneImageNeedsReview(p, 2), {review: false, reason: null});
});

test('the video task uses the art-director instructions with no duplicate prompt', () => {
  assert.equal(agentForTask('video').id, 'art-director');
  const p = ready();
  const request = buildMetaRequest('video', {...projectInput(p), event: p.event, options});
  assert.equal(request.model, 'muse-spark-1.3');
  assert.equal(request.messages[0].content, artDirector.instructions.video);
  assert.equal(request.response_format.json_schema.name, 'witness_video');
  assert.ok(artDirector.instructions.video.includes('hand-painted gouache'));
  assert.ok(artDirector.instructions.video.includes('never a forced autumn look'));
});

test('selected demo stories produce structured film examples', () => {
  const firsts = [];
  for (const id of ['DC-01', 'DC-02']) {
    const p = buildDemoProject(fixtureById(id));
    saveEvent(p, mockEvent(projectInput(p)));
    confirmEvent(p, {title: p.event.title, summary: p.event.summary});
    const result = mockVideo({...projectInput(p), event: p.event, options});
    validateStoryboard(result, p.answers);
    assert.ok(result.styleSpec.technique.includes('gouache'));
    for (const s of result.scenes) assert.ok(p.answers.some(a => a.text.includes(s.caption)), id);
    firsts.push(result.scenes[0].caption);
  }
  assert.notEqual(firsts[0], firsts[1]);
});

test('story input draws scenes from the approved passages', () => {
  const p = ready();
  const picked = [p.answers[1], p.answers[2]];
  const story = picked.map(a => ({text: a.text.slice(0, 200), sourceId: a.id, sourceRevision: a.revision}));
  const result = mockVideo({...projectInput(p), event: p.event, options, story});
  validateStoryboard(result, p.answers);
  assert.ok(result.scenes.every(s => picked.some(a => a.id === s.sourceRefs[0].answerId)));
  assert.equal(result.scenes[0].sourceRefs[0].answerId, p.answers[1].id);
});
