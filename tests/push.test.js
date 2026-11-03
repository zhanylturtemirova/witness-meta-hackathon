import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PUSH_BODY_MAX,
  PUSH_TITLE_MAX,
  allowedPushEndpoint,
  buildPushPayload,
  claimKey,
  dueKind,
  inQuietHours,
  localDateParts,
  validatePushPayload,
} from '../web/push.js';
import {
  deadlineExceeded,
  sendOnePush,
  sendToDevices,
} from '../web/push-sender.js';
import { requestPushPermissionSync } from '../web/push-client.js';

const FCM = 'https://fcm.googleapis.com/fcm/send/device-token-1';
const MOZ = 'https://updates.push.services.mozilla.com/wpush/v2/abc';
const APPLE = 'https://web.push.apple.com/device-123';
const WIN = 'https://contoso.notify.windows.com/wU123';

// --- endpoint allowlist: behavior, not source text -------------------------

test('push endpoints allow only the known providers over plain https', () => {
  for (const ok of [FCM, MOZ, APPLE, WIN]) assert.equal(allowedPushEndpoint(ok), true, ok);
});

test('push endpoints reject localhost, IPs, credentials, ports, lookalikes', () => {
  const bad = [
    'http://fcm.googleapis.com/x',
    'https://localhost/x',
    'https://x.localhost/y',
    'https://127.0.0.1/x',
    'https://10.0.0.5/x',
    'https://192.168.1.1/x',
    'https://user:pass@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'https://fcm.googleapis.com.evil.com/x',
    'https://evilnotify.windows.com/x',
    'https://notify.windows.com/x',
    'https://fcm.googleapis.com./x',
    'not-a-url',
    '',
  ];
  for (const endpoint of bad) assert.equal(allowedPushEndpoint(endpoint), false, endpoint);
});

// --- payload validation and privacy -----------------------------------------

function phrasePayload(over = {}) {
  return {
    kind: 'phrase',
    id: '2026-11-04:phrase',
    title: 'A saved line',
    body: 'One of your saved lines is waiting for you.',
    url: './?push=saved',
    ts: Date.now(),
    ...over,
  };
}

test('push payloads reject external urls and over-long fields', () => {
  assert.equal(validatePushPayload(phrasePayload()).ok, true);
  assert.equal(validatePushPayload(phrasePayload({ url: 'https://evil.example/x' })).ok, false);
  assert.equal(validatePushPayload(phrasePayload({ url: '/absolute/path' })).ok, false);
  assert.equal(validatePushPayload(phrasePayload({ title: 'x'.repeat(PUSH_TITLE_MAX + 1) })).ok, false);
  assert.equal(validatePushPayload(phrasePayload({ body: 'x'.repeat(PUSH_BODY_MAX + 1) })).ok, false);
});

test('phrase pushes stay generic unless preview text is enabled', () => {
  const secret = 'these exact words stay on the device';
  const generic = buildPushPayload({
    kind: 'phrase',
    dateStr: '2026-11-04',
    prefs: { previewText: false },
    snapshot: { text: secret, author: 'Mara' },
  });
  assert.equal(generic.ok, true);
  assert.ok(!generic.payload.body.includes(secret));
  const preview = buildPushPayload({
    kind: 'phrase',
    dateStr: '2026-11-04',
    prefs: { previewText: true },
    snapshot: { text: secret, author: 'Mara' },
  });
  assert.equal(preview.ok, true);
  assert.ok(preview.payload.body.includes(secret));
  assert.ok(preview.payload.body.length <= PUSH_BODY_MAX);
});

// --- quiet hours, DST, cadence, claim keys -----------------------------------

test('overnight quiet hours wrap past midnight', () => {
  const start = 22 * 60;
  const end = 7 * 60;
  assert.equal(inQuietHours(23 * 60, start, end), true);
  assert.equal(inQuietHours(6 * 60 + 59, start, end), true);
  assert.equal(inQuietHours(7 * 60, start, end), false);
  assert.equal(inQuietHours(12 * 60, start, end), false);
});

test('local dates follow the IANA database across a DST transition', () => {
  // US spring forward 2026-03-08: 01:30 EST is UTC-5, 04:30 EDT is UTC-4.
  const before = localDateParts('America/New_York', Date.parse('2026-03-08T06:30:00Z'));
  const after = localDateParts('America/New_York', Date.parse('2026-03-08T08:30:00Z'));
  assert.deepEqual(before, { date: '2026-03-08', minutes: 90 });
  assert.deepEqual(after, { date: '2026-03-08', minutes: 270 });
});

function prefs(over = {}) {
  return {
    phraseEnabled: true,
    questionEnabled: true,
    previewText: false,
    cadence: 'daily',
    localTime: '09:00',
    timeZone: 'UTC',
    quietStart: '22:00',
    quietEnd: '07:00',
    lastSentPhrase: null,
    lastSentQuestion: null,
    ...over,
  };
}

const MORNING = Date.parse('2026-11-04T10:00:00Z');

test('daily and weekly cadences gate repeat sends', () => {
  assert.equal(dueKind(prefs(), 'phrase', MORNING).due, true);
  assert.equal(dueKind(prefs({ lastSentPhrase: '2026-11-04' }), 'phrase', MORNING).due, false);
  assert.equal(dueKind(prefs({ cadence: 'weekly', lastSentPhrase: '2026-11-01' }), 'phrase', MORNING).due, false);
  const weeklyDue = dueKind(prefs({ cadence: 'weekly', lastSentPhrase: '2026-10-27' }), 'phrase', MORNING);
  assert.equal(weeklyDue.due, true);
  assert.equal(weeklyDue.date, '2026-11-04');
  assert.equal(dueKind(prefs(), 'phrase', Date.parse('2026-11-04T23:00:00Z')).due, false);
});

test('claim keys bind owner, day, and kind', () => {
  assert.equal(claimKey('owner-1', '2026-11-04', 'phrase'), 'owner-1:2026-11-04:phrase');
  assert.equal(claimKey('', '2026-11-04', 'phrase'), null);
  assert.equal(claimKey('owner-1', 'not-a-date', 'phrase'), null);
  assert.equal(claimKey('owner-1', '2026-11-04', 'email'), null);
});

// --- sender helper with fake transports --------------------------------------

function device(id) {
  return { endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, p256dh: 'p', auth: 'a' };
}

test('a synchronously throwing transport resolves failed, never throws', async () => {
  const outcome = await sendOnePush(() => { throw Error('boom'); }, device('t1'), { x: 1 });
  assert.equal(outcome, 'failed');
});

test('a 410 removes just that endpoint and the batch continues', async () => {
  const removed = [];
  const transport = (sub) =>
    sub.endpoint.endsWith('/gone')
      ? Promise.reject(Object.assign(Error('gone'), { statusCode: 410 }))
      : Promise.resolve({});
  const outcome = await sendToDevices({
    transport,
    removeEndpoint: async (endpoint) => { removed.push(endpoint); },
    devices: [device('gone'), device('kept')],
    payload: { x: 1 },
    startedAt: Date.now(),
  });
  assert.equal(outcome.sent, 1);
  assert.equal(outcome.attempted, 2);
  assert.deepEqual(removed, ['https://fcm.googleapis.com/fcm/send/gone']);
});

test('every started device send counts, including failures', async () => {
  const outcome = await sendToDevices({
    transport: async () => { throw Object.assign(Error('down'), { statusCode: 500 }); },
    removeEndpoint: async () => {},
    devices: [device('a'), device('b')],
    payload: { x: 1 },
    startedAt: Date.now(),
  });
  assert.equal(outcome.sent, 0);
  assert.equal(outcome.attempted, 2);
});

test('an expired deadline stops before the first device', async () => {
  let calls = 0;
  const outcome = await sendToDevices({
    transport: async () => { calls++; return {}; },
    removeEndpoint: async () => {},
    devices: [device('a')],
    payload: { x: 1 },
    startedAt: 0,
    now: () => 200000,
  });
  assert.equal(outcome.deadline, true);
  assert.equal(outcome.attempted, 0);
  assert.equal(calls, 0);
  assert.equal(deadlineExceeded(0, 200000), true);
});

test('a global attempt cap stops the run across owners', async () => {
  let calls = 0;
  const run = { attempted: 0 };
  for (const id of ['a', 'b', 'c']) {
    const outcome = await sendToDevices({
      transport: async () => { calls++; return {}; },
      removeEndpoint: async () => {},
      devices: [device(id)],
      payload: { x: 1 },
      startedAt: Date.now(),
      attempted: run.attempted,
      maxAttempts: 2,
    });
    run.attempted = outcome.attempted;
    if (outcome.limit) break;
  }
  assert.equal(run.attempted, 2);
  assert.equal(calls, 2);
});

test('the transport receives real timeout options and timers are cleared', async () => {
  const seen = [];
  let scheduled = 0;
  let cancelled = 0;
  const timer = {
    schedule: (fn, ms) => { scheduled++; seen.push(ms); return 'handle'; },
    cancel: (handle) => { cancelled++; assert.equal(handle, 'handle'); },
  };
  const transport = (sub, body, options) => {
    assert.equal(options.TTL, 86400);
    assert.equal(options.timeout, 8000);
    return Promise.resolve({});
  };
  const outcome = await sendOnePush(transport, device('t1'), { x: 1 }, { schedule: timer.schedule, cancel: timer.cancel });
  assert.equal(outcome, 'sent');
  assert.equal(scheduled, 1);
  assert.equal(cancelled, 1);
  assert.deepEqual(seen, [8000]);
});

test('a hung transport ends as failed once the timeout fires', async () => {
  let fire = null;
  let cancelled = 0;
  const schedule = (fn) => { fire = fn; return 'handle'; };
  const pending = sendOnePush(() => new Promise(() => {}), device('t1'), { x: 1 }, {
    schedule,
    cancel: () => { cancelled++; },
  });
  assert.ok(typeof fire === 'function');
  fire();
  assert.equal(await pending, 'failed');
  assert.equal(cancelled, 1);
});

// --- permission gate with fake browser globals --------------------------------

function installBrowser({ permission = 'default' } = {}) {
  // Node exposes globals like navigator through getter-only properties, so
  // fakes go in with defineProperty and the originals are restored after.
  const saved = {};
  for (const key of ['window', 'Notification', 'navigator']) {
    saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  }
  let prompts = 0;
  const fakeNotification = {
    permission,
    requestPermission() { prompts++; return Promise.resolve('granted'); },
  };
  Object.defineProperty(globalThis, 'window', {
    value: {
      isSecureContext: true,
      Notification: fakeNotification,
      PushManager: function PushManager() {},
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'Notification', {
    value: fakeNotification,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: { serviceWorker: {} },
    configurable: true,
    writable: true,
  });
  return {
    prompts: () => prompts,
    restore() {
      for (const key of ['window', 'Notification', 'navigator']) {
        if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
        else delete globalThis[key];
      }
    },
  };
}

function prepared() {
  return { userId: 'user-1', publicVapidKey: 'vapid-key-material-ok' };
}

test('permission is requested synchronously, with no await before it', () => {
  const browser = installBrowser();
  try {
    const pending = requestPushPermissionSync({ prepared: prepared(), currentUserId: 'user-1' });
    assert.equal(browser.prompts(), 1);
    assert.equal(typeof pending?.then, 'function');
  } finally {
    browser.restore();
  }
});

test('missing preparation or a stale user never prompts', () => {
  const browser = installBrowser();
  try {
    assert.equal(requestPushPermissionSync({ currentUserId: 'user-1' }), null);
    assert.equal(requestPushPermissionSync({ prepared: prepared(), currentUserId: 'user-2' }), null);
    assert.equal(browser.prompts(), 0);
  } finally {
    browser.restore();
  }
});

test('a denied browser permission never prompts', () => {
  const browser = installBrowser({ permission: 'denied' });
  try {
    assert.equal(requestPushPermissionSync({ prepared: prepared(), currentUserId: 'user-1' }), null);
    assert.equal(browser.prompts(), 0);
  } finally {
    browser.restore();
  }
});
