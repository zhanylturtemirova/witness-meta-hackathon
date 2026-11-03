// Witness Web Push: pure policy, schedule, and payload helpers.
//
// Shared by the browser UI and the Supabase Edge functions, so both sides
// enforce the same rules. This module is deliberately DOM-free and
// dependency-free: it runs in the browser, under `node --test`, and on the
// Edge runtime. It never touches the network, storage, or permissions.
//
// Source of truth for: preference bounds, quiet hours, due-send logic,
// stable message ids, payload clamping/validation, the push-endpoint SSRF
// allowlist, notification deep-link intents, and the enable-flow ordering
// (permission is requested only after an explicit user gesture AND a
// verified backend configuration — never before).
export const PUSH_KINDS = ['phrase', 'question'];
export const PUSH_CADENCES = ['daily', 'weekly'];

// Transport and safety bounds. Web Push payloads must stay near ~4KB;
// the visible text is clamped far below that.
export const PUSH_TITLE_MAX = 120;
export const PUSH_BODY_MAX = 300;
export const PUSH_ENDPOINT_MAX = 2000;
export const PUSH_KEY_MAX = 512;
export const PUSH_REQUEST_JSON_MAX = 16384;
export const PUSH_SEND_TIMEOUT_MS = 8000;
export const PUSH_BATCH_LIMIT = 100;
// Intended schedule: at most 2 reminder messages per user per day (one per
// kind at most). The sender enforces this with PUSH_DAILY_USER_CAP, not a
// multiple of it.
export const PUSH_DAILY_USER_CAP = 2;
export const PUSH_DAILY_KIND_CAP = 1;
export const PUSH_WEEKLY_GAP_DAYS = 7;
// Run budget for the scheduled sender. The free worker is killed at 150s,
// so the run stops starting new device sends well before 120s and the
// deadline guard (checked with the run's own clock) is the binding limit.
// Owner/device caps are backstops, not time guarantees.
export const PUSH_RUN_DEADLINE_MS = 110000;
export const PUSH_MAX_OWNERS_PER_RUN = 50;
export const PUSH_MAX_DEVICES_PER_OWNER = 5;

// Ordered enable flow. `permission` sorts AFTER `backend` on purpose: the
// browser client must verify sign-in and backend/VAPID configuration before
// it may call Notification.requestPermission(), and only inside the explicit
// "Enable on this device" gesture. See mayRequestPermission().
export const ENABLE_FLOW_STEPS = [
  'support',
  'signin',
  'backend',
  'permission',
  'subscribe',
  'persist',
];

const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Same-origin deep links only. No absolute URLs, no extra parameters.
const PUSH_URL_RE = /^(\.\/)?\?push=(saved|prompt)(&promptId=[A-Za-z0-9_-]{1,64})?$/;
const PROMPT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// Strict push-provider allowlist (exact hosts, plus subdomain boundary for
// the Windows host). Browsers only ever produce these, so anything else is
// treated as hostile input, never subscribed or fetched.
const PUSH_EXACT_HOSTS = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
]);
const PUSH_SUFFIX_BASES = ['notify.windows.com'];

export function blankPushPrefs() {
  return {
    phraseEnabled: false,
    questionEnabled: false,
    cadence: 'daily',
    localTime: '09:00',
    timeZone: 'UTC',
    quietStart: '22:00',
    quietEnd: '07:00',
    previewText: false,
    lastSentPhrase: null,
    lastSentQuestion: null,
  };
}

export function validTimeZoneName(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function parseClock(value) {
  const m = CLOCK_RE.exec(String(value || ''));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Overnight windows wrap (e.g. 22:00–07:00): quiet when now >= start OR
// now < end. Equal start/end means "no quiet hours".
export function inQuietHours(nowMinutes, startMinutes, endMinutes) {
  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

// The user's local calendar date and minute-of-day in an IANA zone.
// Uses the platform time-zone database, so DST transitions are handled by
// Intl rather than by fixed offsets.
export function localDateParts(timeZone, atMs = Date.now()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = {};
  for (const p of fmt.formatToParts(new Date(atMs))) parts[p.type] = p.value;
  const hour = Number(parts.hour) % 24;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute),
  };
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}

// Pure validation for stored preferences. Rejects out-of-range values
// instead of clamping them, so a bad write never becomes a surprise alarm.
export function validatePushPrefs(raw) {
  const errors = [];
  const v = raw && typeof raw === 'object' ? raw : {};
  const prefs = blankPushPrefs();
  for (const key of ['phraseEnabled', 'questionEnabled', 'previewText']) {
    if (typeof v[key] !== 'boolean') errors.push(`${key}-boolean`);
    else prefs[key] = v[key];
  }
  if (!PUSH_CADENCES.includes(v.cadence)) errors.push('cadence-range');
  else prefs.cadence = v.cadence;
  for (const key of ['localTime', 'quietStart', 'quietEnd']) {
    if (parseClock(v[key]) === null) errors.push(`${key}-clock`);
    else prefs[key] = v[key];
  }
  if (!validTimeZoneName(v.timeZone)) errors.push('timezone-iana');
  else prefs.timeZone = v.timeZone;
  for (const key of ['lastSentPhrase', 'lastSentQuestion']) {
    if (v[key] == null) prefs[key] = null;
    else if (typeof v[key] === 'string' && DATE_RE.test(v[key])) prefs[key] = v[key];
    else errors.push(`${key}-date`);
  }
  return { ok: errors.length === 0, prefs, errors };
}

// Should `kind` be sent now? Fail closed on bad clocks/time zones.
export function dueKind(prefs, kind, atMs = Date.now()) {
  if (!PUSH_KINDS.includes(kind)) return { due: false, reason: 'unknown-kind' };
  const check = validatePushPrefs(prefs);
  if (!check.ok) return { due: false, reason: 'invalid-prefs' };
  const p = check.prefs;
  const enabled = kind === 'phrase' ? p.phraseEnabled : p.questionEnabled;
  if (!enabled) return { due: false, reason: 'disabled' };
  let parts;
  try {
    parts = localDateParts(p.timeZone, atMs);
  } catch {
    return { due: false, reason: 'bad-timezone' };
  }
  const last = kind === 'phrase' ? p.lastSentPhrase : p.lastSentQuestion;
  if (p.cadence === 'weekly') {
    if (last && DATE_RE.test(last) && daysBetween(last, parts.date) < PUSH_WEEKLY_GAP_DAYS)
      return { due: false, reason: 'already-sent' };
  } else if (last === parts.date) {
    return { due: false, reason: 'already-sent' };
  }
  if (parts.minutes < parseClock(p.localTime)) return { due: false, reason: 'not-time-yet' };
  if (inQuietHours(parts.minutes, parseClock(p.quietStart), parseClock(p.quietEnd)))
    return { due: false, reason: 'quiet-hours' };
  return { due: true, reason: 'due', date: parts.date };
}

// Stable claim key: one row per owner, local day, and kind. Claiming is
// at-most-once (an insert that loses a race is skipped, never double-sent);
// it is not a guarantee that the device received anything.
export function claimKey(ownerId, dateStr, kind) {
  if (typeof ownerId !== 'string' || !ownerId || ownerId.length > 100) return null;
  if (typeof dateStr !== 'string' || !DATE_RE.test(dateStr)) return null;
  if (!PUSH_KINDS.includes(kind)) return null;
  return `${ownerId}:${dateStr}:${kind}`;
}

// Deterministic question rotation over the approved local prompt bank
// (MEMORY_PROMPTS). No model call, no paid service.
export function promptForDate(dateStr, bank) {
  if (!DATE_RE.test(String(dateStr)) || !Array.isArray(bank) || !bank.length) return null;
  const days = Math.floor(Date.parse(`${dateStr}T12:00:00Z`) / 86400000);
  return bank[((days % bank.length) + bank.length) % bank.length];
}

export function clampText(value, max) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function savedDeepLink() {
  return './?push=saved';
}

export function promptDeepLink(promptId) {
  return `./?push=prompt&promptId=${promptId}`;
}

// Default pushes are generic: no quote or question text leaves the server
// unless the owner explicitly enabled lock-screen preview text.
export function buildPushPayload({ kind, dateStr, prefs, snapshot = null, prompt = null, atMs = Date.now() }) {
  if (!PUSH_KINDS.includes(kind)) return { ok: false, error: 'unknown-kind' };
  if (typeof dateStr !== 'string' || !DATE_RE.test(dateStr)) return { ok: false, error: 'bad-date' };
  const preview = prefs?.previewText === true;
  let title;
  let body;
  let url;
  if (kind === 'phrase') {
    title = 'A saved line';
    url = savedDeepLink();
    if (preview && snapshot && typeof snapshot.text === 'string' && snapshot.text.trim()) {
      const author = typeof snapshot.author === 'string' && snapshot.author.trim() ? ` — ${snapshot.author.trim()}` : '';
      body = clampText(`“${snapshot.text.trim()}”${author}`, PUSH_BODY_MAX);
    } else {
      body = 'One of your saved lines is waiting for you.';
    }
  } else {
    title = 'A question for today';
    const promptId = prompt && PROMPT_ID_RE.test(String(prompt.id || '')) ? prompt.id : null;
    url = promptId ? promptDeepLink(promptId) : './?push=prompt';
    if (preview && prompt && typeof prompt.question === 'string' && prompt.question.trim()) {
      body = clampText(prompt.question.trim(), PUSH_BODY_MAX);
    } else {
      body = 'A new reflection question is waiting for you.';
    }
  }
  const payload = {
    id: `${dateStr}:${kind}`,
    kind,
    title: clampText(title, PUSH_TITLE_MAX),
    body: clampText(body, PUSH_BODY_MAX),
    url,
    ts: Number.isFinite(atMs) ? Math.floor(atMs) : Date.now(),
  };
  const check = validatePushPayload(payload);
  if (!check.ok) return { ok: false, error: check.error };
  return { ok: true, payload: check.payload };
}

// Strict inbound validation for anything shown from a push event. Unknown
// fields are dropped; anything malformed is refused, never rendered.
export function validatePushPayload(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not-an-object' };
  if (!PUSH_KINDS.includes(raw.kind)) return { ok: false, error: 'unknown-kind' };
  if (typeof raw.id !== 'string' || !new RegExp(`^\\d{4}-\\d{2}-\\d{2}:(${PUSH_KINDS.join('|')})$`).test(raw.id))
    return { ok: false, error: 'bad-id' };
  if (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > PUSH_TITLE_MAX)
    return { ok: false, error: 'bad-title' };
  if (typeof raw.body !== 'string' || !raw.body.trim() || raw.body.length > PUSH_BODY_MAX)
    return { ok: false, error: 'bad-body' };
  if (typeof raw.url !== 'string' || !PUSH_URL_RE.test(raw.url)) return { ok: false, error: 'bad-url' };
  if (!Number.isFinite(raw.ts)) return { ok: false, error: 'bad-ts' };
  return {
    ok: true,
    payload: {
      id: raw.id,
      kind: raw.kind,
      title: raw.title,
      body: raw.body,
      url: raw.url,
      ts: Math.floor(raw.ts),
    },
  };
}

// SSRF guard for push subscriptions: HTTPS only, no credentials, no
// explicit port, no IP or internal hosts — only the exact known provider
// hosts (FCM, Mozilla, Apple) or a strict subdomain of notify.windows.com.
export function allowedPushEndpoint(value) {
  if (typeof value !== 'string' || !value || value.length > PUSH_ENDPOINT_MAX) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.port !== '') return false;
  const host = url.hostname.toLowerCase();
  if (!host || host.endsWith('.')) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  if (host.includes(':')) return false;
  if (PUSH_EXACT_HOSTS.has(host)) return true;
  return PUSH_SUFFIX_BASES.some((base) => host !== base && host.endsWith(`.${base}`));
}

// Recognised notification intents. Returns null for anything else; the app
// handles a recognised intent exactly once and never starts recording or
// publishing from it.
export function parsePushIntent(search) {
  let params;
  try {
    params = new URLSearchParams(String(search || ''));
  } catch {
    return null;
  }
  const push = params.get('push');
  if (push === 'saved') return { kind: 'saved' };
  if (push === 'prompt') {
    const promptId = params.get('promptId');
    if (promptId && PROMPT_ID_RE.test(promptId)) return { kind: 'prompt', promptId };
    return { kind: 'prompt', promptId: null };
  }
  return null;
}

// UI/backend readiness for the Notifications section. Every state is
// explicit: unsupported browsers, denied permission, signed-out users, and a
// missing backend are all reported instead of failing silently.
export function describeEnableReadiness({ supported, permission, signedIn, backendConfigured, deviceEnabled }) {
  if (!supported) return { status: 'unsupported' };
  if (permission === 'denied') return { status: 'denied' };
  if (!signedIn) return { status: 'signed-out' };
  if (!backendConfigured) return { status: 'unconfigured' };
  if (deviceEnabled) return { status: 'on' };
  return { status: 'ready' };
}

// The ONLY gate that permits Notification.requestPermission(). It requires
// the full readiness chain AND the explicit enable gesture in the same call
// stack — never before the user acts, never before config is verified.
export function mayRequestPermission(readiness, { userGesture } = {}) {
  return readiness?.status === 'ready' && userGesture === true;
}
