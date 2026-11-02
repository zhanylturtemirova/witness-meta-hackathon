import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAccount, validEmail, authErrorMessage, sendCode, verifyCode,
  startGoogleSignIn, validRedirectUrl, isOAuthReturn,
  refreshAccount, signOutAccount, noteAccountSwitch, listCloud, clearCloud,
} from '../web/auth.js';
import { accountDialogHtml, isAccountFormSubmit, ACCOUNT_FORM_IDS, ACCOUNT_DIALOG_MARKER } from '../web/account.js';

// Fake shaped like the official SDK client: auth namespace plus a tiny
// postgrest-style query chain. Deferred promises let tests interleave a
// sign-out between request and response.
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function fakeClient(overrides = {}) {
  const calls = [];
  const rows = overrides.rows || [];
  const pendingLists = [];
  return {
    calls,
    auth: {
      signInWithOtp: async (args) => {
        calls.push(['signInWithOtp', args.email]);
        if (overrides.otpError) return { data: null, error: overrides.otpError };
        return { data: {}, error: null };
      },
      verifyOtp: async (args) => {
        calls.push(['verifyOtp', args.email]);
        if (overrides.beforeVerify) await overrides.beforeVerify();
        if (overrides.verifyError) return { data: null, error: overrides.verifyError };
        return { data: {}, error: null };
      },
      signInWithOAuth: async (args) => {
        calls.push(['signInWithOAuth', args]);
        if (overrides.beforeOAuth) await overrides.beforeOAuth();
        if (overrides.oauthError) return { data: null, error: overrides.oauthError };
        return { data: {}, error: null };
      },
      getUser: async () => {
        calls.push(['getUser']);
        if (overrides.beforeGetUser) await overrides.beforeGetUser();
        if (overrides.getUserThrows) throw overrides.getUserThrows;
        if (overrides.getUserError) return { data: null, error: overrides.getUserError };
        return { data: { user: overrides.user || null }, error: null };
      },
      signOut: async () => {
        calls.push(['signOut']);
        if (overrides.signOutError) return { error: overrides.signOutError };
        return { error: null };
      },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: () => ({
      select: () => ({
        order: async () => {
          if (overrides.deferredList) {
            const d = deferred();
            pendingLists.push(d);
            calls.push(['list-request']);
            const result = await d.promise;
            calls.push(['list-response']);
            return result;
          }
          calls.push(['list']);
          if (overrides.listError) return { data: null, error: overrides.listError };
          return { data: rows, error: null };
        },
      }),
    }),
    pendingLists,
  };
}

const ALICE = { id: 'user-alice', email: 'alice@example.com' };
const BOB = { id: 'user-bob', email: 'bob@example.com' };

test('nothing is sent until the explicit send click', async () => {
  const client = fakeClient();
  const acc = createAccount();
  assert.equal(client.calls.length, 0);
  assert.equal(acc.status, 'signed-out');
});

test('send validates the address and reports SDK errors without signing in', async () => {
  const acc = createAccount();
  const client = fakeClient();
  await sendCode(client, acc, 'not-an-email');
  assert.match(acc.error, /email/i);
  assert.equal(client.calls.length, 0);
  assert.equal(acc.status, 'signed-out');

  await sendCode(client, acc, '  Alice@Example.com ');
  assert.equal(acc.status, 'code-sent');
  assert.equal(acc.email, 'alice@example.com');
  assert.deepEqual(client.calls, [['signInWithOtp', 'alice@example.com']]);

  const acc2 = createAccount();
  const failing = fakeClient({ otpError: new Error('SMTP is not configured') });
  await sendCode(failing, acc2, 'zed@example.com');
  assert.equal(acc2.status, 'signed-out');
  assert.match(acc2.error, /unavailable right now|stories .* unchanged/i);
});

test('verify signs in on matching code and never echoes the token', async () => {
  const acc = createAccount();
  const client = fakeClient({ user: ALICE });
  await sendCode(client, acc, 'alice@example.com');
  const r = await verifyCode(client, acc, 'alice@example.com', '123456');
  assert.ok(r.ok);
  assert.equal(acc.status, 'signed-in');
  assert.equal(acc.userId, 'user-alice');

  const bad = createAccount();
  const wrong = fakeClient({ verifyError: new Error('Token has expired or is invalid') });
  await verifyCode(wrong, bad, 'alice@example.com', '000000');
  assert.equal(bad.status, 'signed-out');
  assert.doesNotMatch(bad.error, /000000/);
  assert.match(bad.error, /expired|match/i);
});

test('offline failures keep a useful message and change nothing', async () => {
  const acc = createAccount();
  const offline = fakeClient({ otpError: new TypeError('fetch failed') });
  await sendCode(offline, acc, 'alice@example.com');
  assert.equal(acc.status, 'signed-out');
  assert.match(acc.error, /offline/i);

  const signed = createAccount();
  signed.status = 'signed-in';
  signed.userId = 'user-alice';
  signed.cloudProjects = [{ id: 'x', owner_id: 'user-alice' }];
  const dropped = fakeClient({ getUserThrows: new TypeError('Load failed') });
  await refreshAccount(dropped, signed);
  assert.equal(signed.status, 'signed-out');
  assert.equal(signed.cloudProjects.length, 0);
  assert.match(signed.error, /offline/i);
});

test('switching accounts clears the previous cloud list', async () => {
  const acc = createAccount();
  acc.status = 'signed-in';
  acc.userId = 'user-alice';
  acc.cloudProjects = [{ id: 'a', owner_id: 'user-alice' }];
  const switched = noteAccountSwitch(acc, 'user-bob');
  assert.ok(switched);
  assert.equal(acc.cloudProjects.length, 0);
  acc.userId = 'user-bob'; // callers adopt the new id after the switch
  assert.ok(!noteAccountSwitch(acc, 'user-bob'));
});

test('sign-out clears cloud rows and cancels a pending list response', async () => {
  const acc = createAccount();
  acc.status = 'signed-in';
  acc.userId = 'user-alice';
  acc.email = 'alice@example.com';
  const client = fakeClient({ deferredList: true });
  const pending = listCloud(client, acc);
  await signOutAccount(client, acc);
  assert.equal(acc.status, 'signed-out');
  assert.equal(acc.userId, null);
  assert.equal(acc.cloudProjects.length, 0);
  client.pendingLists[0].resolve({ data: [{ id: 'a', owner_id: 'user-alice' }], error: null });
  const r = await pending;
  assert.equal(r.stale, true);
  assert.equal(acc.cloudProjects.length, 0);
});

test('unauthenticated cloud listing is rejected before any request', async () => {
  const acc = createAccount();
  const client = fakeClient();
  const r = await listCloud(client, acc);
  assert.equal(r.ok, false);
  assert.match(acc.cloudError, /Sign in/i);
  assert.ok(!client.calls.includes('list'));
});

test('cloud listing shows only the signed-in user’s rows', async () => {
  const acc = createAccount();
  acc.status = 'signed-in';
  acc.userId = 'user-alice';
  const client = fakeClient({
    rows: [
      { id: 'a', owner_id: 'user-alice', revision: 1 },
      { id: 'b', owner_id: 'user-bob', revision: 2 },
      { id: 'c', owner_id: 'user-alice', revision: 3 },
    ],
  });
  const r = await listCloud(client, acc);
  assert.ok(r.ok);
  assert.deepEqual(acc.cloudProjects.map((x) => x.id), ['a', 'c']);
});

test('missing table surfaces a setup error, not a silent empty list', async () => {
  const acc = createAccount();
  acc.status = 'signed-in';
  acc.userId = 'user-alice';
  const client = fakeClient({ listError: new Error('relation "public.witness_projects" does not exist') });
  const r = await listCloud(client, acc);
  assert.equal(r.ok, false);
  assert.match(acc.cloudError, /not been created|not set up/i);
});

test('expired session on refresh signs out with a useful message', async () => {
  const acc = createAccount();
  acc.status = 'signed-in';
  acc.userId = 'user-alice';
  const client = fakeClient({ getUserError: new Error('Auth session missing!') });
  const r = await refreshAccount(client, acc);
  assert.equal(r.ok, false);
  assert.equal(acc.status, 'signed-out');
  assert.match(acc.error, /expired|Sign in again/i);
});

test('clearCloud is local-only and never touches guest stories', () => {
  const acc = createAccount();
  acc.cloudProjects = [{ id: 'a' }];
  clearCloud(acc);
  assert.equal(acc.cloudProjects.length, 0);
  assert.equal(acc.status, 'signed-out');
  assert.equal(validEmail('a@b.co'), true);
  assert.equal(validEmail('nope'), false);
  assert.match(authErrorMessage(new Error('boom')), /did not work/i);
});

test('account dialog offers Google only, never email forms', () => {
  const signedOut = accountDialogHtml(createAccount());
  assert.ok(signedOut.includes(ACCOUNT_DIALOG_MARKER));
  assert.ok(signedOut.includes('data-action="account-google"'));
  assert.ok(/Continue with Google/.test(signedOut));
  assert.ok(!signedOut.includes('account-email-form'));
  assert.ok(!signedOut.includes('account-code-form'));
  assert.ok(!/entering your email creates/i.test(signedOut));
  assert.ok(!/smtp/i.test(signedOut));
  assert.ok(!signedOut.includes('{{ .Token }}'));
  assert.deepEqual(ACCOUNT_FORM_IDS, []);
  assert.ok(!isAccountFormSubmit('account-email-form'));
  assert.ok(!isAccountFormSubmit('answer-form'));
  const legacy = createAccount();
  legacy.status = 'code-sent';
  legacy.email = 'a@b.co';
  assert.ok(!accountDialogHtml(legacy).includes('account-code-form'));
  const acc = createAccount();
  acc.status = 'signed-in';
  acc.userId = 'user-alice';
  acc.email = 'alice@example.com';
  const signedIn = accountDialogHtml(acc, {});
  assert.match(signedIn, /alice@example\.com/);
  assert.match(signedIn, /recordings stay on this device/i);
  assert.ok(signedIn.includes(ACCOUNT_DIALOG_MARKER));
});

test('a verify that finishes after sign-out cannot sign back in', async () => {
  const acc = createAccount();
  const client = fakeClient({
    user: ALICE,
    beforeVerify: async () => { await signOutAccount(client, acc); },
  });
  await sendCode(client, acc, 'alice@example.com');
  const r = await verifyCode(client, acc, 'alice@example.com', '123456');
  assert.equal(r.stale, true);
  assert.equal(acc.status, 'signed-out');
  assert.equal(acc.userId, null);
});

test('a refresh that finishes after account switch stays dropped', async () => {
  const acc = createAccount();
  acc.status = 'signed-in';
  acc.userId = 'user-alice';
  const client = fakeClient({
    user: BOB,
    beforeGetUser: async () => { await signOutAccount(client, acc); },
  });
  const r = await refreshAccount(client, acc);
  assert.equal(r.stale, true);
  assert.equal(acc.status, 'signed-out');
  assert.equal(acc.userId, null);
  assert.equal(acc.cloudProjects.length, 0);
});

test('google starts only from the button with provider and safe redirect', async () => {
  const acc = createAccount();
  const client = fakeClient();
  assert.equal(client.calls.length, 0);
  const r = await startGoogleSignIn(client, acc, 'http://127.0.0.1:4173/');
  assert.ok(r.ok);
  assert.equal(client.calls.length, 1);
  const [name, args] = client.calls[0];
  assert.equal(name, 'signInWithOAuth');
  assert.equal(args.provider, 'google');
  assert.equal(args.options.redirectTo, 'http://127.0.0.1:4173/');
  assert.ok(!('scopes' in args) && !('scope' in (args.options || {})));
  assert.ok(!/offline/i.test(JSON.stringify(args)));
  assert.equal(acc.status, 'signed-out');
  assert.equal(acc.userId, null);
  assert.equal(acc.error, '');
});

test('google rejects unsafe redirects without calling the SDK', async () => {
  for (const bad of ['javascript:alert(1)', 'http://evil.example.com/', 'not a url', '']) {
    const acc = createAccount();
    const client = fakeClient();
    const r = await startGoogleSignIn(client, acc, bad);
    assert.equal(r.ok, false);
    assert.equal(client.calls.length, 0);
    assert.equal(acc.status, 'signed-out');
    assert.match(acc.error, /did not look right|did not work/i);
  }
  const acc = createAccount();
  const client = fakeClient();
  assert.ok((await startGoogleSignIn(client, acc, 'https://witness.example/auth')).ok);
});

test('google errors stay safe and stale completions are dropped', async () => {
  const denied = createAccount();
  const failing = fakeClient({ oauthError: new Error('access_denied') });
  const r = await startGoogleSignIn(failing, denied, 'https://witness.example/');
  assert.equal(r.ok, false);
  assert.equal(denied.status, 'signed-out');
  assert.match(denied.error, /did not work|did not finish/i);

  const offline = createAccount();
  const down = fakeClient({ oauthError: new TypeError('fetch failed') });
  await startGoogleSignIn(down, offline, 'https://witness.example/');
  assert.match(offline.error, /offline/i);

  const acc = createAccount();
  const client = fakeClient({
    beforeOAuth: async () => { await signOutAccount(client, acc); },
  });
  const stale = await startGoogleSignIn(client, acc, 'https://witness.example/');
  assert.equal(stale.stale, true);
  assert.equal(acc.status, 'signed-out');
});

test('oauth return detection separates callbacks from guest loads', () => {
  assert.equal(isOAuthReturn('https://witness.example/'), false);
  assert.equal(isOAuthReturn('https://witness.example/?topic=x#story'), false);
  assert.equal(isOAuthReturn('https://witness.example/?code=abc123'), true);
  assert.equal(isOAuthReturn('https://witness.example/#access_token=sek&token_type=bearer'), true);
  assert.equal(isOAuthReturn('https://witness.example/#error=access_denied'), true);
  assert.equal(isOAuthReturn('not a url'), false);
  assert.equal(validRedirectUrl('https://witness.example/'), true);
  assert.equal(validRedirectUrl('http://localhost:4173/'), true);
  assert.equal(validRedirectUrl('http://evil.example.com/'), false);
});

test('no signed-in state before a valid getUser', async () => {
  const acc = createAccount();
  const client = fakeClient();
  await startGoogleSignIn(client, acc, 'https://witness.example/');
  assert.equal(acc.status, 'signed-out');
  const r = await refreshAccount(client, acc);
  assert.equal(r.ok, false);
  assert.equal(acc.status, 'signed-out');
});
