import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject, addAnswer } from '../web/domain.js';
import { createAccount } from '../web/auth.js';
import {
  textOnlyPayload, validateCloudRow, isOwnerRow, cloudRevisionOf,
  saveCloudProject, openCloudProject, importGuard, buildLocalCopy,
} from '../web/cloud.js';

function storyProject() {
  const p = newProject('small-moment', 'The bakery morning');
  addAnswer(p, 'One morning, the woman at the bakery remembered my order.');
  addAnswer(p, 'I felt known in a city that was still strange to me.');
  p.recordings = [{ id: 'r1', question: 'q', questionKey: 'k', projectId: p.id, createdAt: Date.now() }];
  p.images = [{ id: 'i1' }];
  return p;
}

// Fake RPC with real compare-and-swap semantics: expected 0 creates,
// otherwise the stored revision must still match.
function fakeRpc(store = new Map(), fail = null) {
  return {
    store,
    async rpc(name, args) {
      assert.equal(name, 'witness_save_project');
      if (fail) {
        if (fail.throws) throw fail.throws;
        return { data: null, error: fail.error };
      }
      const expected = args.p_expected_revision || 0;
      const current = store.get(args.p_id);
      if (expected === 0) {
        if (current) return { data: null, error: new Error('witness_save_project conflict: a copy already exists') };
        store.set(args.p_id, { revision: 1, payload: args.p_payload });
        return { data: { revision: 1 }, error: null };
      }
      if (!current || current.revision !== expected)
        return { data: null, error: new Error('witness_save_project conflict: a newer copy exists') };
      store.set(args.p_id, { revision: expected + 1, payload: args.p_payload });
      return { data: { revision: expected + 1 }, error: null };
    },
    from: () => ({
      select: () => ({
        eq: (_k, v) => ({
          single: async () => {
            const hit = store.get(v);
            if (!hit) return { data: null, error: new Error('No rows') };
            return { data: { id: v, owner_id: 'user-alice', revision: hit.revision, payload: hit.payload }, error: null };
          },
        }),
      }),
    }),
  };
}

function signedAcc(userId = 'user-alice') {
  const acc = createAccount();
  acc.status = 'signed-in';
  acc.userId = userId;
  acc.email = 'alice@example.com';
  return acc;
}

test('text-only packaging strips media and names what stayed behind', () => {
  const p = storyProject();
  const { payload, dropped } = textOnlyPayload(p);
  assert.equal(payload.recordings, undefined);
  assert.equal(payload.images, undefined);
  assert.ok(dropped.includes('recordings'));
  assert.ok(dropped.includes('images'));
  assert.equal(payload.answers.length, 2);
  // The local project is untouched.
  assert.equal(p.recordings.length, 1);
});

test('unauthenticated saves are rejected before any request', async () => {
  let called = false;
  const client = { rpc: async () => { called = true; return {}; } };
  const r = await saveCloudProject(client, createAccount(), storyProject(), 0);
  assert.equal(r.ok, false);
  assert.match(r.error, /Sign in/i);
  assert.equal(called, false);
});

test('first save creates revision 1, later saves compare-and-swap', async () => {
  const client = fakeRpc();
  const acc = signedAcc();
  const p = storyProject();
  const first = await saveCloudProject(client, acc, p, 0);
  assert.ok(first.ok);
  assert.equal(first.revision, 1);
  assert.ok(first.dropped.includes('recordings'));

  // A second save with the fresh revision succeeds; a stale writer holding
  // revision 1 after that is refused instead of silently overwriting.
  const second = await saveCloudProject(client, acc, p, 1);
  assert.ok(second.ok);
  assert.equal(second.revision, 2);
  const stale = await saveCloudProject(client, acc, p, 1);
  assert.equal(stale.ok, false);
  assert.equal(stale.conflict, true);
  assert.match(stale.error, /newer/i);
});

test('failed writes report no success and name the intact local story', async () => {
  const acc = signedAcc();
  const missing = fakeRpc(new Map(), { error: new Error('function public.witness_save_project does not exist') });
  const r = await saveCloudProject(missing, acc, storyProject(), 0);
  assert.equal(r.ok, false);
  assert.equal(r.revision, undefined);
  assert.match(r.error, /not .*set up|not been created/i);

  const offline = { rpc: async () => { throw new TypeError('fetch failed'); } };
  const r2 = await saveCloudProject(offline, acc, storyProject(), 0);
  assert.equal(r2.ok, false);
  assert.match(r2.error, /offline|unchanged/i);
});

test('opening rejects rows owned by another account', async () => {
  const client = fakeRpc();
  client.store.set('shared-id', { revision: 1, payload: storyProject() });
  // Fake returns alice-owned rows; bob must still be refused.
  const bob = signedAcc('user-bob');
  const r = await openCloudProject(client, bob, 'shared-id');
  assert.equal(r.ok, false);
  assert.match(r.error, /different account/i);
});

test('opening validates the row shape before returning it', async () => {
  const acc = signedAcc();
  assert.match(validateCloudRow(null), /damaged/);
  assert.match(validateCloudRow({ id: 'x', owner_id: 'user-alice', revision: 1, payload: { nope: true } }), /damaged/);
  const payload = storyProject();
  const client = fakeRpc();
  client.store.set(payload.id, { revision: 2, payload });
  const r = await openCloudProject(client, acc, payload.id);
  assert.ok(r.ok);
  assert.equal(r.row.revision, 2);
  assert.ok(isOwnerRow(r.row, 'user-alice'));
  assert.ok(!isOwnerRow(r.row, 'user-bob'));
});

test('import is blocked while the tab is stale or capture is pending', () => {
  assert.match(importGuard({ storageConflict: true, capturePending: false }), /behind|reload/i);
  assert.match(importGuard({ storageConflict: false, capturePending: true }), /recording|audio/i);
  assert.equal(importGuard({ storageConflict: false, capturePending: false }), null);
});

test('explicit import preserves ids and marks the cloud revision', () => {
  const payload = storyProject();
  const row = { id: payload.id, owner_id: 'user-alice', revision: 4, payload };
  const r = buildLocalCopy(row, { userId: 'user-alice', existingIds: [], now: 1234 });
  assert.ok(r.ok);
  assert.equal(r.project.id, payload.id);
  assert.equal(r.project.cloudRevision, 4);
  assert.deepEqual(r.project.cloudImport, { revision: 4, at: 1234, cloudId: payload.id });

  const dup = buildLocalCopy(row, { userId: 'user-alice', existingIds: [payload.id] });
  assert.equal(dup.ok, false);
  assert.match(dup.error, /already on this device/i);

  const foreign = buildLocalCopy(row, { userId: 'user-bob', existingIds: [] });
  assert.equal(foreign.ok, false);
  assert.match(foreign.error, /different account/i);
});

test('cloud revision defaults to zero for never-saved stories', () => {
  assert.equal(cloudRevisionOf({}), 0);
  assert.equal(cloudRevisionOf({ cloudRevision: 3 }), 3);
  assert.equal(cloudRevisionOf({ cloudRevision: 'x' }), 0);
});

test('revision is bound to the owning account', () => {
  const mine = { cloudRevision: 4, cloudOwnerId: 'user-alice' };
  assert.equal(cloudRevisionOf(mine, 'user-alice'), 4);
  assert.equal(cloudRevisionOf(mine, 'user-bob'), 0);
  assert.equal(cloudRevisionOf(mine), 4);
  assert.equal(cloudRevisionOf({ cloudRevision: 2 }, 'user-bob'), 2);
});

test('mismatched payload id is rejected before import', () => {
  const payload = storyProject();
  const row = { id: 'other-id', owner_id: 'user-alice', revision: 1, payload };
  assert.match(validateCloudRow(row), /damaged/);
  const r = buildLocalCopy(row, { userId: 'user-alice', existingIds: [] });
  assert.equal(r.ok, false);
});

test('import records the owning account with the revision', () => {
  const payload = storyProject();
  const row = { id: payload.id, owner_id: 'user-alice', revision: 4, payload };
  const r = buildLocalCopy(row, { userId: 'user-alice', existingIds: [] });
  assert.ok(r.ok);
  assert.equal(r.project.cloudOwnerId, 'user-alice');
  assert.equal(cloudRevisionOf(r.project, 'user-alice'), 4);
  assert.equal(cloudRevisionOf(r.project, 'user-bob'), 0);
});

test('text-only packaging strips the owner binding', () => {
  const p = storyProject();
  p.cloudRevision = 3;
  p.cloudOwnerId = 'user-alice';
  p.cloudImport = { revision: 3 };
  const { payload } = textOnlyPayload(p);
  assert.equal(payload.cloudOwnerId, undefined);
  assert.equal(payload.cloudRevision, undefined);
  assert.equal(p.cloudOwnerId, 'user-alice');
});
