import test, {beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {isHosted, publicOrigin, isHostAllowed, serverListen, healthBody} from '../server/config.mjs';
import {requireUser, __resetAuthForTests} from '../server/auth.mjs';
import {spendGeneration, acquireSlot, budgetConfig, __resetBudgetForTests} from '../server/ai/budget.mjs';
import {handleAI} from '../server/ai/routes.mjs';
import {handleSpeech} from '../server/transcribe.mjs';
import {toWav} from '../web/audio.js';
import {exampleProject} from '../web/domain.js';
import {witnessAI, projectInput, aiStatus, clearAIStatusCache} from '../web/ai-client.js';
import {setApiToken, setHostedMode, apiAuthHeaders} from '../web/api-auth.js';
import {fetchDiscoveryResults} from '../web/discovery.js';
const HOSTED = {PUBLIC_ORIGIN: 'https://witness.example', META_AI_ENABLED: 'true', MODEL_API_KEY: 'test-key', META_TRANSCRIPTION_ENABLED: 'true', SUPABASE_URL: 'https://sb.example', SUPABASE_PUBLISHABLE_KEY: 'pk'};
const authed = {'Content-Type': 'application/json', Authorization: 'Bearer good-token'};
const getUser = async token => { if (token !== 'good-token') { const e = Error('invalid JWT'); e.status = 401; throw e; } return {id: 'user-1'}; };
const aiPost = (task, body, headers = authed) => new Request('http://localhost/api/ai/' + task, {method: 'POST', headers: {...headers, Origin: 'http://localhost'}, body: JSON.stringify(body)});
beforeEach(() => { __resetAuthForTests(); __resetBudgetForTests(); });
test('hosted mode is explicit and host gating ignores forwarded headers', () => {
  assert.equal(isHosted({}), false);
  assert.equal(isHosted(HOSTED), true);
  assert.equal(publicOrigin(HOSTED), 'https://witness.example');
  assert.equal(publicOrigin({}), null);
  assert.equal(publicOrigin({PUBLIC_ORIGIN: 'not a url'}), null);
  assert.equal(isHostAllowed('127.0.0.1', {}), true);
  assert.equal(isHostAllowed('evil.example', {}), false);
  assert.equal(isHostAllowed('witness.example', HOSTED), true);
  assert.equal(isHostAllowed('WITNESS.example', HOSTED), true);
  assert.equal(isHostAllowed('other.example', HOSTED), false);
  assert.equal(isHostAllowed('127.0.0.1', HOSTED), false);
  assert.deepEqual(serverListen({}), {port: 4173, host: '127.0.0.1', hosted: false});
  assert.deepEqual(serverListen({PORT: '8080', HOST: '0.0.0.0', PUBLIC_ORIGIN: 'https://w.example'}), {port: 8080, host: '0.0.0.0', hosted: true});
  assert.deepEqual(serverListen({PORT: 'junk'}).port, 4173);
  assert.deepEqual(healthBody({}), {ok: true, mode: 'local'});
  assert.deepEqual(healthBody(HOSTED), {ok: true, mode: 'hosted'});
});
test('hosted endpoints require a verified session; local mode skips auth', async () => {
  const req = authedReq => new Request('http://localhost/api/ai/interview', {method: 'POST', headers: authedReq});
  assert.deepEqual(await requireUser(req({}), {}), {userId: null});
  await assert.rejects(requireUser(req({}), HOSTED), /Sign in/);
  await assert.rejects(requireUser(req({Authorization: 'Bearer bad'}), HOSTED, {getUser: async () => { throw Error('invalid JWT'); }}), /not valid/);
  try {
    await requireUser(req({Authorization: 'Bearer bad'}), HOSTED, {getUser});
    assert.fail('expected rejection');
  } catch (err) { assert.equal(err.status, 401); }
  assert.deepEqual(await requireUser(req({Authorization: 'Bearer good-token'}), HOSTED, {getUser}), {userId: 'user-1'});
  let calls = 0;
  const counting = async () => { calls++; return {id: 'user-9'}; };
  await requireUser(req({Authorization: 'Bearer cached-token'}), HOSTED, {getUser: counting});
  await requireUser(req({Authorization: 'Bearer cached-token'}), HOSTED, {getUser: counting});
  assert.equal(calls, 1);
  await assert.rejects(requireUser(req({Authorization: 'Bearer uncached-token'}), {...HOSTED, SUPABASE_URL: ''}), /not configured/);
  await assert.rejects(requireUser(req({Authorization: 'Bearer fresh-token'}), HOSTED, {getUser: async () => { throw Error('fetch failed'); }}), /could not be reached/);
});
test('budget enforces per-user, concurrency, and global caps', () => {
  assert.deepEqual(budgetConfig({}), {userHourlyLimit: 60, maxConcurrent: 1, globalCap: 1000});
  const tiny = {AI_USER_HOURLY_LIMIT: '2', AI_GENERATION_CAP: '10'};
  spendGeneration('u1', tiny); spendGeneration('u1', tiny);
  assert.throws(() => spendGeneration('u1', tiny), /hour\u2019s share/);
  spendGeneration('u2', tiny);
  const capped = {AI_GENERATION_CAP: '1'};
  __resetBudgetForTests();
  spendGeneration('u1', capped);
  assert.throws(() => spendGeneration('u2', capped), /budget/);
  __resetBudgetForTests();
  const release = acquireSlot({});
  assert.throws(() => acquireSlot({}), /Another AI request/);
  release(); release();
  const again = acquireSlot({});
  again();
});
function metaOk(result) {
  return async () => Response.json({choices: [{message: {content: JSON.stringify(result)}, finish_reason: 'stop'}]});
}
test('hosted AI routes authenticate and never serve mocks', async () => {
  const input = projectInput(exampleProject());
  let res = await handleAI(aiPost('interview', input, {'Content-Type': 'application/json'}), HOSTED, metaOk({}), {getUser});
  assert.equal(res.status, 401);
  res = await handleAI(aiPost('interview', input), {...HOSTED, MODEL_API_KEY: ''}, metaOk({}), {getUser});
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /not available/);
  res = await handleAI(aiPost('video', input), {...HOSTED, MODEL_API_KEY: ''}, metaOk({}), {getUser});
  assert.equal(res.status, 503);
  res = await handleAI(aiPost('event', input), {...HOSTED, MODEL_API_KEY: ''}, metaOk({}), {getUser});
  assert.equal(res.status, 503);
  assert.doesNotMatch(JSON.stringify(await res.json()), /mock/i);
  const status = await (await handleAI(new Request('http://localhost/api/ai-status'), HOSTED)).json();
  assert.equal(status.mode, 'hosted');
  assert.equal(status.authRequired, true);
  const local = await (await handleAI(new Request('http://localhost/api/ai-status'), {})).json();
  assert.equal(local.mode, 'local');
  assert.equal(local.authRequired, false);
});
test('hosted transcription and images require a session, not just an origin', async () => {
  const wav = toWav([new Float32Array(2400)], 24000);
  const t = (headers = authed) => new Request('http://127.0.0.1:4173/api/transcribe?language=English', {method: 'POST', headers: {...headers, 'Content-Type': 'audio/wav', Origin: 'http://127.0.0.1:4173'}, body: wav});
  let res = await handleSpeech(t({'Content-Type': 'audio/wav'}), HOSTED, async () => Response.json({transcript: 'x'}), {getUser});
  assert.equal(res.status, 401);
  res = await handleSpeech(t(), {...HOSTED, MODEL_API_KEY: ''}, async () => Response.json({transcript: 'x'}), {getUser});
  assert.equal(res.status, 503);
  res = await handleSpeech(t(), HOSTED, async () => Response.json({transcript: 'A memory.'}), {getUser});
  assert.equal(res.status, 200);
  assert.equal((await res.json()).transcript, 'A memory.');
  const speech = await (await handleSpeech(new Request('http://localhost/api/speech-status'), HOSTED)).json();
  assert.equal(speech.mode, 'hosted');
  assert.equal(speech.authRequired, true);
  const img = await handleAI(aiPost('image', {}, {'Content-Type': 'application/json'}), HOSTED, async () => Response.json({}), {getUser});
  assert.equal(img.status, 401);
});
test('verification and repair calls spend from the same budget', async () => {
  const p = exampleProject(), input = projectInput(p);
  const refs = input.answers.map(a => ({answerId: a.id, revision: a.revision}));
  const candidate = {title: 'A memory', summary: input.answers[0].text, dateText: null, location: null, people: [], themes: [], detailsToConfirm: [], sourceRefs: refs};
  const statement = candidate.summary.split(/(?<=[.!?])\s/)[0];
  let verifyCalls = 0;
  const calls = [];
  const fetcher = async (url, init) => {
    const name = JSON.parse(init.body).response_format.json_schema.name;
    calls.push(name);
    if (name === 'witness_event') return Response.json({choices: [{message: {content: JSON.stringify(candidate)}, finish_reason: 'stop'}]});
    verifyCalls++;
    const out = verifyCalls === 1
      ? {supported: false, issues: [{field: 'summary', statement, answerRefs: refs, reason: 'invented_fact'}]}
      : {supported: true, issues: []};
    return Response.json({choices: [{message: {content: JSON.stringify(out)}, finish_reason: 'stop'}]});
  };
  // Cap 1: the verify call itself is refused before any upstream request.
  let res = await handleAI(aiPost('event', input), {...HOSTED, AI_GENERATION_CAP: '1'}, fetcher, {getUser});
  assert.equal(res.status, 503);
  assert.deepEqual(calls, ['witness_event']);
  // Cap 3 with one failed verification: generate, verify, repair-generate
  // spend; the second verification is refused. Repair work is counted.
  __resetBudgetForTests();
  calls.length = 0; verifyCalls = 0;
  res = await handleAI(aiPost('event', input), {...HOSTED, AI_GENERATION_CAP: '3'}, fetcher, {getUser});
  assert.equal(res.status, 503);
  assert.deepEqual(calls, ['witness_event', 'witness_verify', 'witness_event']);
});
test('hosted clients never fall back to mocks and send the session token', async () => {
  const realFetch = globalThis.fetch;
  try {
    clearAIStatusCache(); setApiToken(''); setHostedMode(false);
    globalThis.fetch = async url => {
      if (url === '/api/ai-status') return Response.json({provider: 'mock', mode: 'hosted', authRequired: true, textLiveAvailable: false, liveTasks: []});
      throw Error('unexpected ' + url);
    };
    const s = await aiStatus(true);
    assert.equal(s.mode, 'hosted');
    await assert.rejects(witnessAI.interview(projectInput(exampleProject())), /not available/);
    await assert.rejects(witnessAI.interview(projectInput(exampleProject()), {provider: 'mock'}), /Mocks are not available/);
    await assert.rejects(witnessAI.event(projectInput(exampleProject())), /not available/);
    clearAIStatusCache();
    let seenAuth = '';
    globalThis.fetch = async (url, init) => {
      if (url === '/api/ai-status') return Response.json({provider: 'meta', mode: 'hosted', authRequired: true, textLiveAvailable: true, liveTasks: ['interview']});
      if (url === '/api/ai/interview') { seenAuth = init.headers.Authorization || ''; return Response.json({provider: 'meta', model: 'muse-spark-1.3', result: {question: 'What stayed with you?', intent: 'meaning', sourceRefs: [], enoughMaterial: true, suggestedNextStep: 'continue'}}); }
      throw Error('unexpected ' + url);
    };
    setApiToken('tok-123');
    const r = await witnessAI.interview(projectInput(exampleProject()));
    assert.equal(r.provider, 'meta');
    assert.equal(seenAuth, 'Bearer tok-123');
    assert.deepEqual(apiAuthHeaders(), {Authorization: 'Bearer tok-123'});
    let discoveryAuth = '';
    await fetchDiscoveryResults(
      {query: 'moving abroad', candidates: [{id: 'c1', revision: 1, text: 'We moved to a new country last spring and started over together slowly.'}]},
      {fetcher: async (url, init) => { discoveryAuth = init.headers.Authorization || ''; return Response.json({provider: 'meta', model: 'muse-spark-1.3', results: []}); }}
    );
    assert.equal(discoveryAuth, 'Bearer tok-123');
  } finally {
    globalThis.fetch = realFetch;
    clearAIStatusCache(); setApiToken(''); setHostedMode(false);
  }
});
