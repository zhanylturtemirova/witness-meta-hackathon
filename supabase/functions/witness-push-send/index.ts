// witness-push-send: scheduled sender, cron only.
// verify_jwt = false for THIS function only (see supabase/config.toml):
// pg_cron cannot mint a user JWT, so authentication is the server-only
// PUSH_SCHEDULER_SECRET Vault secret compared against the `apikey` header.
// Ordinary user JWTs never match and are rejected; there is no user
// endpoint here. Builtin env names (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
// are used internally; the service key never leaves the server.
// Extra deployment secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT, PUSH_SCHEDULER_SECRET.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0';
import {
  PUSH_DAILY_USER_CAP,
  PUSH_MAX_DEVICES_PER_OWNER,
  PUSH_MAX_OWNERS_PER_RUN,
  PUSH_RUN_DEADLINE_MS,
  allowedPushEndpoint,
  buildPushPayload,
  claimKey,
  dueKind,
  promptForDate,
  validatePushPrefs,
} from '../../../web/push.js';
import { sendToDevices } from '../../../web/push-sender.js';
import { MEMORY_PROMPTS } from '../../../web/memory-prompts.js';

// Run bounds: stop starting new work at 120s wall clock (the worker is
// killed at 150s), at most 20 device attempts per run (failed sends count),
// at most 50 owners and 5 devices each. Delivery is best effort with claim
// dedupe, never exactly-once: the (owner, day, kind) claim row only stops a
// retried run from re-sending, and a failed run releases its claim.
const PUSH_RUN_WALL_CLOCK_MS = 120000;
const PUSH_RUN_MAX_DEVICE_ATTEMPTS = 20;

function timingEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ ok: false }), { status: 405 });
  const secret = Deno.env.get('PUSH_SCHEDULER_SECRET') || '';
  if (!secret) return new Response(JSON.stringify({ ok: false }), { status: 503 });
  const provided = req.headers.get('apikey') || '';
  if (!timingEqual(provided, secret)) return new Response(JSON.stringify({ ok: false }), { status: 401 });

  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY') || '';
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY') || '';
  const subject = Deno.env.get('VAPID_SUBJECT') || '';
  if (!vapidPublic || !vapidPrivate || !subject) {
    return new Response(JSON.stringify({ ok: false }), { status: 503 });
  }

  const url = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !serviceKey) return new Response(JSON.stringify({ ok: false }), { status: 503 });
  const admin = createClient(url, serviceKey);
  const webpush = (await import('npm:web-push@3.6.7')).default;
  webpush.setVapidDetails(subject, vapidPublic, vapidPrivate);

  const runStart = Date.now();
  const now = runStart;
  let checked = 0;
  let sent = 0;
  let attempts = 0;

  // Real transport over npm:web-push. The shared helper invokes it with
  // { TTL, timeout }, catches synchronous throws, and always clears its
  // timer; nothing here duplicates that logic.
  const transport = (
    sub: { endpoint: string; p256dh: string; auth: string },
    body: Record<string, unknown>,
    options: { TTL: number; timeout: number },
  ) =>
    webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(body),
      { TTL: options.TTL, timeout: options.timeout },
    );

  try {
    const { data: prefs } = await admin
      .from('witness_push_prefs')
      .select('*')
      .or('phrase_enabled.eq.true,question_enabled.eq.true')
      .limit(PUSH_MAX_OWNERS_PER_RUN);
    for (const row of prefs || []) {
      if (Date.now() - runStart >= PUSH_RUN_WALL_CLOCK_MS) break;
      if (attempts >= PUSH_RUN_MAX_DEVICE_ATTEMPTS) break;
      const owner = row.owner_id as string;
      try {
      const check = validatePushPrefs({
        phraseEnabled: row.phrase_enabled,
        questionEnabled: row.question_enabled,
        previewText: row.preview_text,
        cadence: row.cadence,
        localTime: row.local_time,
        timeZone: row.time_zone,
        quietStart: row.quiet_start,
        quietEnd: row.quiet_end,
        lastSentPhrase: row.last_sent_phrase,
        lastSentQuestion: row.last_sent_question,
      });
      if (!check.ok) continue;
      checked++;
      const { data: subs } = await admin
        .from('witness_push_subscriptions')
        .select('endpoint,p256dh,auth')
        .eq('owner_id', owner)
        .limit(PUSH_MAX_DEVICES_PER_OWNER);
      const devices = (subs || []).filter((s) => allowedPushEndpoint(s.endpoint));
      if (!devices.length) continue;
      const todaySends = await admin
        .from('witness_push_sends')
        .select('message_key')
        .eq('owner_id', owner)
        .gte('created_at', new Date(now - 86400000).toISOString());
      const sentKeys = new Set((todaySends.data || []).map((r) => r.message_key as string));
      if (sentKeys.size >= PUSH_DAILY_USER_CAP) continue;

      for (const kind of ['phrase', 'question'] as const) {
        if (Date.now() - runStart >= PUSH_RUN_WALL_CLOCK_MS) break;
        if (attempts >= PUSH_RUN_MAX_DEVICE_ATTEMPTS) break;
        const due = dueKind(check.prefs, kind, now);
        if (!due.due || !due.date) continue;
        if (sentKeys.has(`${owner}:${due.date}:${kind}`)) continue;
        const key = claimKey(owner, due.date, kind);
        if (!key) continue;
        // Atomic day-kind claim: the message_key primary key makes the
        // insert itself the mutex, so concurrent cron ticks cannot
        // double-send. A lost race skips; it never throws.
        const { error: claimError } = await admin
          .from('witness_push_sends')
          .insert({ message_key: key, owner_id: owner, kind, status: 'sending' });
        if (claimError) continue;

        let snapshot: { text: string; author: string } | null = null;
        if (kind === 'phrase') {
          const { data: snaps } = await admin
            .from('witness_push_quotes')
            .select('text,author,source_kind,source_id,source_revision,quote_key,id')
            .eq('owner_id', owner)
            .is('revoked_at', null)
            .order('created_at', { ascending: false })
            .limit(1);
          const cand = (snaps || [])[0];
          if (cand) {
            let revoked = false;
            if (cand.source_kind === 'shared-fictional') {
              // Local fictional demo snapshots never look up a public UUID:
              // source_id here is a local example id, so a missing or
              // revised published copy revokes the snapshot.
              try {
                const { data: pub } = await admin
                  .from('published_stories')
                  .select('revision')
                  .eq('id', cand.source_id)
                  .maybeSingle();
                if (!pub || pub.revision !== cand.source_revision) {
                  revoked = true;
                  await admin
                    .from('witness_push_quotes')
                    .update({ revoked_at: new Date(now).toISOString() })
                    .eq('id', cand.id);
                }
              } catch {
                revoked = true;
              }
            } else if (cand.source_kind === 'published') {
              // quote_key is the owned witness_quotes.id and source_id its
              // published_id. Re-verify the owned quote still cites this
              // copy at this revision and the copy is still current; a
              // malformed id or unknown row revokes safely.
              try {
                const { data: quote, error: quoteError } = await admin
                  .from('witness_quotes')
                  .select('published_id,published_revision')
                  .eq('id', cand.quote_key)
                  .maybeSingle();
                if (quoteError || !quote || quote.published_id !== cand.source_id ||
                  quote.published_revision !== cand.source_revision) {
                  revoked = true;
                } else {
                  const { data: pub } = await admin
                    .from('published_stories')
                    .select('revision')
                    .eq('id', cand.source_id)
                    .maybeSingle();
                  if (!pub || pub.revision !== cand.source_revision) revoked = true;
                }
                if (revoked) {
                  await admin
                    .from('witness_push_quotes')
                    .update({ revoked_at: new Date(now).toISOString() })
                    .eq('id', cand.id);
                }
              } catch {
                revoked = true;
              }
            }
            if (!revoked) snapshot = { text: cand.text, author: cand.author };
          }
        }
        const prompt = kind === 'question' ? promptForDate(due.date, MEMORY_PROMPTS) : null;
        const built = buildPushPayload({
          kind,
          dateStr: due.date,
          prefs: check.prefs,
          snapshot,
          prompt,
          atMs: now,
        });
        if (!built.ok) {
          await admin.from('witness_push_sends').delete().eq('message_key', key);
          continue;
        }
        // One shared helper call per owner: per-device timeouts, sync-throw
        // safety, timer cleanup, 404/410 cleanup of only that endpoint, and
        // the run-wide attempt cap all live in web/push-sender.js.
        const outcome = await sendToDevices({
          transport,
          removeEndpoint: (endpoint: string) =>
            admin.from('witness_push_subscriptions').delete().eq('endpoint', endpoint),
          devices,
          payload: built.payload as Record<string, unknown>,
          startedAt: runStart,
          budgetMs: PUSH_RUN_DEADLINE_MS,
          attempted: attempts,
          maxAttempts: PUSH_RUN_MAX_DEVICE_ATTEMPTS,
        });
        attempts = outcome.attempted;
        if (outcome.sent > 0) {
          await admin.from('witness_push_sends').update({ status: 'sent' }).eq('message_key', key);
          const field = kind === 'phrase' ? 'last_sent_phrase' : 'last_sent_question';
          await admin.from('witness_push_prefs').update({ [field]: due.date }).eq('owner_id', owner);
          sent += outcome.sent;
        } else {
          // Nothing delivered: release the claim so a later run may retry.
          await admin.from('witness_push_sends').delete().eq('message_key', key);
        }
      }
      } catch {
        // One bad owner row never aborts the entire batch.
      }
    }
    return new Response(JSON.stringify({ ok: true, checked, sent }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ ok: false }), { status: 500 });
  }
});
