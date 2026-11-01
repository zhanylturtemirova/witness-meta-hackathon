import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject,addAnswer,nextQuestion,addRecordingMeta,getRecordingMeta,setRecordingTranscript,setInterviewer,questionIdentity,recordingAnswer} from '../web/domain.js';
import {toWav} from '../web/audio.js';

// Minimal fake DOM: enough for web/voice.js mount/draw/handler wiring.
function fakeElement() {
  const stored = {};
  const noop = () => {};
  return new Proxy({}, {
    get(t, key) {
      if (key in stored) return stored[key];
      if (typeof key === 'symbol') return undefined;
      if (key === 'classList') return {toggle: noop, add: noop, remove: noop};
      if (key === 'dataset') return {};
      if (key === 'style') return {};
      return noop;
    },
    set(t, key, value) { stored[key] = value; return true; }
  });
}
let voice = null;
async function loadVoice(els) {
  if (!voice) {
    globalThis.window = {addEventListener() {}};
    globalThis.fetch = async () => { throw Error('offline'); };
    globalThis.document = {activeElement: null, querySelector: sel => els[sel] || null};
    voice = await import('../web/voice.js');
  } else {
    globalThis.document.querySelector = sel => els[sel] || null;
  }
  return voice;
}
function freshEls() {
  const els = {};
  for (const sel of ['#voice-box', '#voice-record', '#voice-record-label', '#voice-duration', '#voice-saved',
    '#voice-saved-wrap', '#voice-status', '#voice-error', '#voice-storage', '#voice-preview', '#voice-playback',
    '#voice-transcribe', '#voice-download', '#voice-discard', '#voice-upload', '#voice-connection',
    '#voice-transcript-box', '#voice-transcript-origin', '#voice-transcript', '#voice-use',
    '#voice-recorded-for', '#voice-revisit']) els[sel] = fakeElement();
  return els;
}

test('a recording resolves to its own answer by stable ID, never by wording', () => {
  const p = newProject('person');
  setInterviewer(p, {result: {question: 'Who was there?'}});
  const key = questionIdentity(p);
  const meta = addRecordingMeta(p, {id: 'r1', question: 'Who was there?', questionKey: key, projectId: p.id});
  const first = addAnswer(p, 'My sister was there.');
  setInterviewer(p, {result: {question: 'Who was there?'}});
  const second = addAnswer(p, 'Later, my brother joined us.');
  assert.equal(first.question, second.question);
  assert.notEqual(first.questionKey, second.questionKey);
  assert.equal(meta.projectId, p.id);
  assert.equal(recordingAnswer(p, meta)?.id, first.id);
  const orphan = addRecordingMeta(p, {id: 'r2', question: 'Who was there?', questionKey: 'unknown-key'});
  assert.equal(recordingAnswer(p, orphan), null);
  const legacy = addRecordingMeta(p, {id: 'r3', question: 'Who was there?'});
  assert.equal(recordingAnswer(p, legacy), null);
  assert.equal(recordingAnswer(p, null), null);
});

test('a transcript is never silently attached to a different question', async () => {
  const els = freshEls();
  const {mountVoice} = await loadVoice(els);
  const applied = [], revisited = [];
  const p = newProject('person');
  const original = nextQuestion(p);
  const key = questionIdentity(p);
  addRecordingMeta(p, {id: 'r1', question: original, questionKey: key});
  setRecordingTranscript(p, 'r1', 'My grandmother was there.', 'muse-voice-transcribe-1.0');
  addAnswer(p, 'A first answer moves the interview on.');
  assert.notEqual(questionIdentity(p), key);
  mountVoice(p, {onApply: text => { applied.push(text); return true; }, onNotify() {}, onSave() {}, onRevisit: id => revisited.push(id)});
  assert.equal(typeof els['#voice-use'].onclick, 'function');
  els['#voice-use'].onclick();
  assert.equal(applied.length, 0);
  assert.equal(els['#voice-revisit'].hidden, false);
  els['#voice-revisit'].onclick();
  assert.deepEqual(revisited, [p.answers[0].id]);
  assert.equal(applied.length, 0);
  els['#voice-use'].onclick();
  assert.deepEqual(applied, ['My grandmother was there.']);
});

test('a transcript for the current question applies immediately', async () => {
  const els = freshEls();
  const {mountVoice} = await loadVoice(els);
  const applied = [];
  const p = newProject('person');
  addRecordingMeta(p, {id: 'r1', question: nextQuestion(p), questionKey: questionIdentity(p)});
  setRecordingTranscript(p, 'r1', 'An answer for right now.', '');
  mountVoice(p, {onApply: text => { applied.push(text); return true; }, onNotify() {}, onSave() {}, onRevisit() {}});
  els['#voice-use'].onclick();
  assert.deepEqual(applied, ['An answer for right now.']);
});

test('an upload stays bound to the question open when it started', async () => {
  const els = freshEls();
  const {mountVoice} = await loadVoice(els);
  const p = newProject('person');
  const original = nextQuestion(p);
  const originalKey = questionIdentity(p);
  mountVoice(p, {onApply: () => true, onNotify() {}, onSave() {}, onRevisit() {}});
  const wav = toWav([new Float32Array(4800)], 24000);
  let release;
  const gate = new Promise(res => { release = res; });
  const file = {size: wav.byteLength, arrayBuffer: () => gate};
  const pending = els['#voice-upload'].onchange({target: {files: [file], value: ''}});
  addAnswer(p, 'The interview moved on while bytes were still arriving.');
  assert.notEqual(nextQuestion(p), original);
  release(wav);
  await pending;
  assert.equal(p.recordings.length, 1);
  assert.equal(p.recordings[0].question, original);
  assert.equal(p.recordings[0].questionKey, originalKey);
  assert.equal(p.recordings[0].projectId, p.id);
});

test('discard during navigation cleans up its owner and leaves the new project alone', async () => {
  const els1 = freshEls();
  const {mountVoice} = await loadVoice(els1);
  const p1 = newProject('person');
  addRecordingMeta(p1, {id: 'r1', question: nextQuestion(p1), questionKey: questionIdentity(p1)});
  mountVoice(p1, {onApply: () => true, onNotify() {}, onSave() {}, onRevisit() {}});
  const els2 = freshEls();
  const p2 = newProject('small-moment');
  addRecordingMeta(p2, {id: 'r2', question: nextQuestion(p2), questionKey: questionIdentity(p2)});
  const discarding = els1['#voice-discard'].onclick();
  await loadVoice(els2);
  mountVoice(p2, {onApply: () => true, onNotify() {}, onSave() {}, onRevisit() {}});
  await discarding;
  assert.equal(p1.recordings.length, 0);
  assert.equal(p2.recordings.length, 1);
  assert.equal(els2['#voice-status'].textContent.includes('discarded'), false);
});

test('transcript confirmation resets when the destination question changes', async () => {
  const els = freshEls();
  const {mountVoice} = await loadVoice(els);
  const applied = [];
  const p = newProject('person');
  addRecordingMeta(p, {id: 'r1', question: nextQuestion(p), questionKey: questionIdentity(p)});
  setRecordingTranscript(p, 'r1', 'Words for the first question.', '');
  addAnswer(p, 'Moving the interview on.');
  mountVoice(p, {onApply: text => { applied.push(text); return true; }, onNotify() {}, onSave() {}, onRevisit() {}});
  els['#voice-use'].onclick();
  assert.equal(applied.length, 0);
  addAnswer(p, 'Moving the interview on again.');
  els['#voice-use'].onclick();
  assert.equal(applied.length, 0);
  els['#voice-use'].onclick();
  assert.deepEqual(applied, ['Words for the first question.']);
});

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
function stubBrowser({devices, AudioContext, AudioWorkletNode}) {
  Object.defineProperty(globalThis, 'navigator', {value: devices === undefined ? {} : {mediaDevices: devices}, configurable: true});
  if (AudioContext !== undefined) { globalThis.window.AudioContext = AudioContext; globalThis.AudioContext = AudioContext; }
  if (AudioWorkletNode !== undefined) { globalThis.window.AudioWorkletNode = AudioWorkletNode; globalThis.AudioWorkletNode = AudioWorkletNode; }
}
function restoreBrowser() {
  if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
  delete globalThis.window.AudioContext;
  delete globalThis.window.AudioWorkletNode;
  delete globalThis.AudioContext;
  delete globalThis.AudioWorkletNode;
}

test('direct capture reports a missing microphone clearly and saves nothing', async () => {
  const els = freshEls();
  const {mountVoice, startVoiceCapture, voiceBusy} = await loadVoice(els);
  const p = newProject('person');
  mountVoice(p, {onApply: () => true, onNotify() {}, onSave() {}, onRevisit() {}});
  stubBrowser({});
  try {
    await startVoiceCapture();
  } finally { restoreBrowser(); }
  assert.match(els['#voice-error'].textContent, /not available in this browser/);
  assert.match(els['#voice-error'].textContent, /upload a WAV/);
  assert.equal((p.recordings || []).length, 0);
  assert.equal(voiceBusy(), false);
});

test('microphone denial keeps the story and explains the next step', async () => {
  const els = freshEls();
  const {mountVoice, startVoiceCapture, voiceBusy} = await loadVoice(els);
  const p = newProject('person');
  addAnswer(p, 'An answer worth keeping.');
  mountVoice(p, {onApply: () => true, onNotify() {}, onSave() {}, onRevisit() {}});
  stubBrowser({devices: {getUserMedia: async () => { throw Object.assign(Error('denied'), {name: 'NotAllowedError'}); }}, AudioContext: class {}});
  try {
    await startVoiceCapture();
  } finally { restoreBrowser(); }
  assert.match(els['#voice-error'].textContent, /not allowed/);
  assert.equal(p.answers.length, 1);
  assert.equal((p.recordings || []).length, 0);
  assert.equal(voiceBusy(), false);
});

test('direct capture starts recording when the microphone opens', async () => {
  const els = freshEls();
  const {mountVoice, startVoiceCapture, leaveVoice, voiceBusy} = await loadVoice(els);
  const p = newProject('person');
  mountVoice(p, {onApply: () => true, onNotify() {}, onSave() {}, onRevisit() {}});
  const track = {stop() {}, onended: null};
  const stream = {getTracks: () => [track], getAudioTracks: () => [track]};
  const gain = () => ({gain: {value: 0}, connect() {}, disconnect() {}});
  class FakeContext {
    constructor() { this.state = 'running'; this.sampleRate = 24000; this.audioWorklet = {addModule: async () => {}}; }
    async resume() {}
    async close() {}
    createMediaStreamSource() { return {connect() {}, disconnect() {}}; }
    createGain() { return gain(); }
  }
  class FakeNode {
    constructor() {
      this.port = {onmessage: null, postMessage: () => queueMicrotask(() => this.port.onmessage && this.port.onmessage({data: {stopped: true}}))};
    }
    connect() {}
    disconnect() {}
  }
  stubBrowser({devices: {getUserMedia: async () => stream}, AudioContext: FakeContext, AudioWorkletNode: FakeNode});
  try {
    await startVoiceCapture();
    assert.equal(voiceBusy(), true);
    assert.equal(els['#voice-record-label'].textContent, 'Stop recording');
  } finally {
    leaveVoice();
    for (let i = 0; i < 100 && voiceBusy(); i++) await new Promise(r => setTimeout(r, 20));
    restoreBrowser();
  }
  assert.equal(voiceBusy(), false);
  assert.equal((p.recordings || []).length, 0);
});

test('a blocked audio start aborts with a clear next tap', async () => {
  const els = freshEls();
  const {mountVoice, startVoiceCapture, voiceBusy} = await loadVoice(els);
  const p = newProject('person');
  mountVoice(p, {onApply: () => true, onNotify() {}, onSave() {}, onRevisit() {}});
  let stopped = 0;
  const track = {stop() { stopped++; }, onended: null};
  const stream = {getTracks: () => [track], getAudioTracks: () => [track]};
  class SuspendedContext {
    constructor() { this.state = 'suspended'; }
    async resume() {}
    async close() {}
  }
  stubBrowser({devices: {getUserMedia: async () => stream}, AudioContext: SuspendedContext});
  try {
    await startVoiceCapture();
  } finally { restoreBrowser(); }
  assert.match(els['#voice-error'].textContent, /Press Record again/);
  assert.equal(stopped, 1);
  assert.equal(voiceBusy(), false);
});
