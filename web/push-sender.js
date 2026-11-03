// Witness push sender helpers: dependency-injected transport policy shared
// by the Supabase Edge sender and by `node --test`.
//
// DOM-free and network-free: every side effect (the web-push transport, the
// timers, the clock) is injected, so tests drive failures, 410 cleanups,
// deadlines, and caps with fakes. The Deno entry in
// supabase/functions/witness-push-send/index.ts stays thin: it builds the
// real transport over `npm:web-push` and the service-role client, then calls
// sendToDevices() per owner.
//
// Delivery is at-most-once per claim key, never exactly-once guaranteed:
// the claim row only stops a retried run from re-sending, and a failed run
// releases its claim so a later run may try again.
import {
  PUSH_MAX_DEVICES_PER_OWNER,
  PUSH_RUN_DEADLINE_MS,
  PUSH_SEND_TIMEOUT_MS,
} from './push.js';

export const SENDER_TTL_SECONDS = 86400;

// A provider response that means "this subscription is gone": only the
// affected endpoint is ever deleted, never the owner's other devices.
export function isGoneSubscriptionError(err) {
  const status = Number(err?.statusCode ?? err?.status ?? 0);
  return status === 404 || status === 410;
}

export function deadlineExceeded(startedAtMs, nowMs, budgetMs = PUSH_RUN_DEADLINE_MS) {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs)) return true;
  return nowMs - startedAtMs >= budgetMs;
}

// One device send. `transport(subscription, body, options)` is the real
// `webpush.sendNotification` (or a fake in tests) and is ALWAYS invoked with
// `{ TTL, timeout }`. A synchronous throw is caught inside this try; the
// timeout handle is always cleared, so no Promise.race timer is left behind.
// Nothing logged: endpoints, keys, and quote text never leave this module.
export async function sendOnePush(
  transport,
  subscription,
  body,
  {
    timeoutMs = PUSH_SEND_TIMEOUT_MS,
    ttl = SENDER_TTL_SECONDS,
    schedule = setTimeout,
    cancel = clearTimeout,
  } = {},
) {
  let timer = null;
  try {
    const pending = transport(subscription, body, { TTL: ttl, timeout: timeoutMs });
    const send = pending && typeof pending.then === 'function' ? pending : Promise.resolve(pending);
    const result = await new Promise((resolve, reject) => {
      timer = schedule(() => reject(Error('timeout')), timeoutMs);
      send.then(
        (value) => resolve({ settled: 'sent', value }),
        (err) => reject(err),
      );
    });
    void result;
    return 'sent';
  } catch (err) {
    if (isGoneSubscriptionError(err)) return 'gone';
    return 'failed';
  } finally {
    if (timer !== null) {
      try {
        cancel(timer);
      } catch {
        /* timer cleanup is best effort */
      }
    }
  }
}

// Send one payload to every device of one owner. Each DEVICE send is
// counted in `attempted`, including failures; a 404/410 removes only that
// endpoint through `removeEndpoint`. One bad subscription never aborts the
// others: per-device errors resolve to a status, never throw.
export async function sendToDevices(
  { transport, removeEndpoint, devices, payload, now = () => Date.now(), startedAt = 0, budgetMs = PUSH_RUN_DEADLINE_MS, timer = {}, attempted = 0, maxAttempts = Infinity } = {},
) {
  const schedule = timer.schedule || setTimeout;
  const cancel = timer.cancel || clearTimeout;
  const cap = Number.isFinite(maxAttempts) && maxAttempts >= 0 ? maxAttempts : Infinity;
  let sent = 0;
  let done = attempted;
  const list = Array.isArray(devices) ? devices.slice(0, PUSH_MAX_DEVICES_PER_OWNER) : [];
  for (const sub of list) {
    if (deadlineExceeded(startedAt, now(), budgetMs)) return { sent, attempted: done, deadline: true, limit: false };
    // Global attempt cap: checked before every device (not just per owner),
    // so the helper and its caller together can never exceed the run cap.
    // Every started device send counts, including failures.
    if (done >= cap) return { sent, attempted: done, deadline: false, limit: true };
    done += 1;
    let outcome = 'failed';
    try {
      outcome = await sendOnePush(transport, sub, payload, { schedule, cancel });
    } catch {
      outcome = 'failed';
    }
    if (outcome === 'sent') sent += 1;
    else if (outcome === 'gone') {
      try {
        await removeEndpoint(sub.endpoint);
      } catch {
        /* cleanup is best effort; the send is still counted */
      }
    }
  }
  return { sent, attempted: done, deadline: false, limit: false };
}
