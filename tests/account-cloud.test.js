import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccount, clearCloud } from '../web/auth.js';
import { cloudSaveFollowup } from '../web/cloud.js';
import { accountDialogHtml, ACCOUNT_DIALOG_MARKER } from '../web/account.js';

const saved = () => ({ ok: true, revision: 1, dropped: ['recordings'] });

function signedIn() {
  const acc = createAccount();
  acc.status = 'signed-in';
  acc.userId = 'user-alice';
  acc.email = 'alice@example.com';
  return acc;
}

test('a changed account turns a save into an in-dialog error, never success', () => {
  const r = cloudSaveFollowup({ saveUid: 'user-alice', userId: 'user-bob', save: saved(), list: null });
  assert.equal(r.status, 'account-changed');
  assert.equal(r.notice, '');
  assert.match(r.error, /account changed/i);
});

test('a failed save reports the failure, never a success notice', () => {
  const r = cloudSaveFollowup({
    saveUid: 'user-alice', userId: 'user-alice',
    save: { ok: false, error: 'A newer cloud copy exists.' }, list: null,
  });
  assert.equal(r.status, 'save-failed');
  assert.equal(r.notice, '');
  assert.match(r.error, /newer/i);
});

test('a confirmed save keeps its success when the list refresh fails', () => {
  const r = cloudSaveFollowup({ saveUid: 'user-alice', userId: 'user-alice', save: saved(), list: { ok: false } });
  assert.equal(r.status, 'saved-list-stale');
  assert.equal(r.error, '');
  assert.match(r.notice, /saved/i);
  assert.match(r.notice, /recordings/);
});

test('a confirmed save with a fresh list reports success and names what stayed behind', () => {
  const r = cloudSaveFollowup({ saveUid: 'user-alice', userId: 'user-alice', save: saved(), list: { ok: true, rows: [] } });
  assert.equal(r.status, 'saved');
  assert.match(r.notice, /saved/i);
  assert.match(r.notice, /recordings/);
});

test('signing out clears the in-dialog save notice with the cloud list', () => {
  const acc = signedIn();
  acc.notice = 'Cloud copy saved.';
  acc.cloudProjects = [{ id: 'x' }];
  clearCloud(acc);
  assert.equal(acc.notice, '');
  assert.deepEqual(acc.cloudProjects, []);
});

test('the account dialog shows the save notice as a live status and errors as alerts', () => {
  const acc = signedIn();
  acc.notice = 'Cloud copy saved.';
  acc.cloudError = 'The cloud list could not be reached.';
  const html = accountDialogHtml(acc);
  assert.ok(html.includes(ACCOUNT_DIALOG_MARKER));
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.ok(html.includes('Cloud copy saved.'));
  assert.match(html, /role="alert"/);
});

test('the account dialog escapes notice text instead of rendering markup', () => {
  const acc = signedIn();
  acc.notice = 'Saved <b>loudly</b>.';
  const html = accountDialogHtml(acc);
  assert.ok(!html.includes('<b>loudly</b>'));
  assert.ok(html.includes('&lt;b&gt;loudly&lt;/b&gt;'));
});
