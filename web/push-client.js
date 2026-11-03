// Browser calls for optional Web Push. Every call requires a signed-in
// user and a configured backend; nothing here prompts for notification
// permission except requestPushPermissionSync(), which the app calls
// SYNCHRONOUSLY inside the explicit "Enable on this device" click — before
// any await — so Safari keeps the user gesture. Preparation (sign-in check
// plus backend/VAPID config) happens earlier, when Settings opens, and its
// result is cached tied to the user id; the click fails closed when the
// cache is missing or stale. Endpoints and keys are never logged.
//
// `client` is the lazily loaded Supabase client (see auth-client.js). The
// Edge function base comes from the public project URL; the service key and
// the VAPID private key never reach this module.
import { SUPABASE_URL } from './supabase-config.js';
import {
  PUSH_REQUEST_JSON_MAX,
  allowedPushEndpoint,
  describeEnableReadiness,
  mayRequestPermission,
} from './push.js';

export const PUSH_FUNCTION = 'witness-push';

export function pushSupported() {
  try {
    return (
      typeof window !== 'undefined' &&
      window.isSecureContext === true &&
      'Notification' in window &&
      'serviceWorker' in navigator &&
      'PushManager' in window
    );
  } catch {
    return false;
  }
}

export function currentPermission() {
  try {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;
  } catch {
    return 'unsupported';
  }
}

function functionUrl() {
  return `${String(SUPABASE_URL).replace(/\/+$/, '')}/functions/v1/${PUSH_FUNCTION}`;
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Safe, generic failure text. Server responses are never echoed: they may
// contain configuration hints that stay server-side.
function genericError(action) {
  const map = {
    config: 'Notification settings are not available right now. Nothing was changed.',
    subscribe: 'This device could not be registered. Nothing was changed.',
    unsubscribe: 'This device could not be removed. It may still be registered.',
    prefs: 'Notification settings could not be saved. Nothing was changed.',
    quote: 'That phrase could not be synced. Nothing was changed.',
    test: 'The test notification could not be sent. Nothing was changed.',
  };
  return map[action] || 'Something did not work. Nothing was changed.';
}

const OUR_ERROR = Symbol('push-error');

function fail(action) {
  return Object.assign(Error(genericError(action)), { [OUR_ERROR]: true });
}

export async function callPushApi(client, action, body = {}, { timeoutMs = 12000 } = {}) {
  const payload = JSON.stringify({ action, ...body });
  if (payload.length > PUSH_REQUEST_JSON_MAX) throw fail(action);
  let token = '';
  try {
    const { data } = await client.auth.getSession();
    token = data?.session?.access_token || '';
  } catch {
    token = '';
  }
  if (!token) throw fail(action);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(functionUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: payload,
      signal: ctrl.signal,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok || !data || typeof data !== 'object') throw fail(action);
    return data;
  } catch (err) {
    if (err && err[OUR_ERROR]) throw err;
    throw fail(action);
  } finally {
    clearTimeout(timer);
  }
}

// Verify the backend (public VAPID key present) before any permission step.
// Returns { ok, publicVapidKey } or { ok:false, error } with generic text.
export async function fetchPushConfig(client) {
  try {
    const data = await callPushApi(client, 'config');
    if (data && data.ok === true && typeof data.publicVapidKey === 'string' && data.publicVapidKey.length > 10)
      return { ok: true, publicVapidKey: data.publicVapidKey };
    return { ok: false, error: 'Reminders are not available yet. Please try again later.' };
  } catch {
    return { ok: false, error: genericError('config') };
  }
}

// Preparation runs when Settings opens (no gesture needed, no prompt):
// support → sign-in → backend config. The returned bundle is cached by the
// app tied to the user id; the Enable button stays disabled until it is
// ready. Returns { ok:true, prepared:{ userId, publicVapidKey } } or
// { ok:false, status, error } with generic text.
export async function preparePushEnable({ client } = {}) {
  if (!pushSupported()) return { ok: false, status: 'unsupported', error: 'This browser cannot receive push notifications. Try a recent Chrome, Edge, Firefox, or Safari.' };
  let userId = null;
  try {
    const { data } = await client.auth.getUser();
    userId = data?.user?.id || null;
  } catch {
    userId = null;
  }
  if (!userId) return { ok: false, status: 'signed-out', error: 'Sign in first — reminders need your account.' };
  if (currentPermission() === 'denied')
    return { ok: false, status: 'denied', error: 'Notifications are blocked for this site. Allow them in the browser site settings, then try again.' };
  const config = await fetchPushConfig(client);
  if (!config.ok) return { ok: false, status: 'unconfigured', error: config.error };
  return { ok: true, status: 'ready', prepared: { userId, publicVapidKey: config.publicVapidKey } };
}

// The ONLY place Notification.requestPermission() is called. Fully
// synchronous: no await runs before the permission call, so the caller MUST
// invoke this directly inside the click handler. `currentUserId` is the
// app's synchronously-known account id; anything missing or stale (no
// bundle, user changed since preparation, key missing, denied browser)
// returns null instead of prompting — fail closed, never prompt blindly.
// On success returns the in-flight permission promise for finishPushEnable.
export function requestPushPermissionSync({ prepared, currentUserId } = {}) {
  try {
    if (!pushSupported()) return null;
    if (!prepared || typeof prepared.publicVapidKey !== 'string' || !prepared.publicVapidKey) return null;
    if (!prepared.userId || !currentUserId || prepared.userId !== currentUserId) return null;
    const ready = describeEnableReadiness({
      supported: true,
      permission: currentPermission(),
      signedIn: true,
      backendConfigured: true,
      deviceEnabled: false,
    });
    if (!mayRequestPermission(ready, { userGesture: true })) return null;
    return Notification.requestPermission();
  } catch {
    return null;
  }
}

// Completes the enable flow AFTER the synchronous permission request:
// granted → device subscribe → backend persist. A device subscription that
// cannot be persisted is removed again, and success is never reported then.
// `permission` is the promise returned by requestPushPermissionSync(); a
// stale bundle (user id changed since preparation) fails closed here too.
export async function finishPushEnable({ client, prepared, currentUserId, permission, getSubscription } = {}) {
  if (!prepared || !prepared.userId || prepared.userId !== currentUserId || !prepared.publicVapidKey)
    return { ok: false, error: genericError('subscribe') };
  let granted = 'default';
  try {
    granted = await permission;
  } catch {
    granted = 'denied';
  }
  if (granted !== 'granted') return { ok: false, error: 'Permission was not granted, so reminders stay off. Nothing was changed.' };
  let subscription = null;
  try {
    const reg = typeof getSubscription === 'function'
      ? await getSubscription()
      : await navigator.serviceWorker.ready;
    const pushManager = reg.pushManager || reg;
    const existing = await pushManager.getSubscription().catch(() => null);
    subscription = existing
      || await pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(prepared.publicVapidKey) });
  } catch {
    return { ok: false, error: genericError('subscribe') };
  }
  const json = typeof subscription.toJSON === 'function' ? subscription.toJSON() : subscription;
  if (!json || !allowedPushEndpoint(json.endpoint)) {
    try {
      await subscription.unsubscribe();
    } catch { /* best effort cleanup */ }
    return { ok: false, error: genericError('subscribe') };
  }
  try {
    const saved = await callPushApi(client, 'subscribe', {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys?.p256dh || '', auth: json.keys?.auth || '' },
    });
    if (!saved || saved.ok !== true) throw Error('persist');
    return { ok: true, endpoint: json.endpoint };
  } catch {
    try {
      await subscription.unsubscribe();
    } catch { /* best effort cleanup */ }
    return { ok: false, error: 'This device subscribed but the server did not keep it, so it was removed again. Nothing is enabled.' };
  }
}

// Disable: remove the backend registration first, then unsubscribe the
// device. A backend failure is reported honestly — never as success.
export async function disableOnThisDevice({ client } = {}) {
  let endpoint = '';
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription().catch(() => null);
    endpoint = sub?.endpoint || '';
    if (endpoint) {
      await callPushApi(client, 'unsubscribe', { endpoint });
    }
    if (sub) {
      try {
        await sub.unsubscribe();
      } catch { /* device already gone */ }
    }
    return { ok: true };
  } catch {
    return { ok: false, error: genericError('unsubscribe') };
  }
}
