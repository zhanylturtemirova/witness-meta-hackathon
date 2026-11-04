import test from 'node:test';
import assert from 'node:assert/strict';
import {createFakeIndexedDB} from './helpers/fake-indexeddb.mjs';

// Each case imports a fresh media-store instance so the cached connection
// cannot leak between the working, failing, and blocked IndexedDB setups.
test('media bytes round-trip through the real IndexedDB branch', async () => {
  globalThis.indexedDB = createFakeIndexedDB();
  const store = await import('../web/media-store.js?case=roundtrip');
  const blob = new Blob([new Uint8Array([9, 8, 7])], {type: 'audio/wav'});
  const saved = await store.mediaSave(store.MEDIA_RECORDINGS, {id: 'r1', projectId: 'p', blob});
  assert.equal(saved.persistent, true);
  assert.deepEqual(
    [...globalThis.indexedDB._state('witness-media-v1').stores.keys()],
    [store.MEDIA_RECORDINGS, store.MEDIA_IMAGES, store.MEDIA_FILMS]
  );
  const back = await store.mediaLoad(store.MEDIA_RECORDINGS, 'r1');
  assert.deepEqual(new Uint8Array(await back.blob.arrayBuffer()), new Uint8Array([9, 8, 7]));
  await store.mediaSave(store.MEDIA_IMAGES, {id: 'r1', projectId: 'p', blob: new Blob(['x'])});
  assert.equal(await (await store.mediaLoad(store.MEDIA_IMAGES, 'r1')).blob.text(), 'x');
  await store.mediaSave(store.MEDIA_FILMS, {id: 'f1', projectId: 'p', blob: new Blob(['v'], {type: 'video/mp4'})});
  assert.equal((await store.mediaLoad(store.MEDIA_FILMS, 'f1')).blob.type, 'video/mp4');
  await store.mediaDelete(store.MEDIA_RECORDINGS, 'r1');
  assert.equal(await store.mediaLoad(store.MEDIA_RECORDINGS, 'r1'), null);
  assert.equal((await store.mediaLoad(store.MEDIA_IMAGES, 'r1')).id, 'r1');
  assert.equal(store.mediaStatus().persistent, true);
});

test('a failed IndexedDB open falls back visibly instead of losing media', async () => {
  globalThis.indexedDB = createFakeIndexedDB({failOpen: true});
  const store = await import('../web/media-store.js?case=failopen');
  const saved = await store.mediaSave(store.MEDIA_RECORDINGS, {id: 'r1', projectId: 'p', blob: new Blob(['a'])});
  assert.equal(saved.persistent, false);
  assert.match(saved.error || '', /unavailable/);
  assert.equal((await store.mediaLoad(store.MEDIA_RECORDINGS, 'r1')).id, 'r1');
  assert.equal(store.mediaStatus().persistent, false);
});

test('a blocked IndexedDB upgrade falls back to memory', async () => {
  globalThis.indexedDB = createFakeIndexedDB({blocked: true});
  const store = await import('../web/media-store.js?case=blocked');
  const saved = await store.mediaSave(store.MEDIA_IMAGES, {id: 'i1', projectId: 'p', blob: new Blob(['b'])});
  assert.equal(saved.persistent, false);
  assert.equal((await store.mediaLoad(store.MEDIA_IMAGES, 'i1')).id, 'i1');
});
