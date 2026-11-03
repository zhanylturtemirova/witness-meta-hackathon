// witness-push: user-facing push configuration and subscription.
// verify_jwt = true (see supabase/config.toml). Every request carries the
// signed-in user's JWT; the user is resolved with auth.getUser() — never by
// decoding alone — and all reads/writes go through the owner-scoped RPCs in
// supabase/migrations/20261104_push.sql, which refuse a null caller and
// touch solely auth.uid() rows. The service key is never used here.
// Extra deployment secrets (never hard-coded): VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_ALLOWED_ORIGINS.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0';
import {
  PUSH_REQUEST_JSON_MAX,
  allowedPushEndpoint,
  validatePushPayload,
  validatePushPrefs,
  blankPushPrefs,
} from '../../../web/push.js';

const GENERIC = { ok: false };

function json(status: number, body: unknown, origin: string | null): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (origin) {
    headers['access-control-allow-origin'] = origin;
    headers['vary'] = 'Origin';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function corsOrigin(req: Request): string | null {
  const origin = req.headers.get('origin') || '';
  if (!origin) return null;
  const allowed = (Deno.env.get('PUSH_ALLOWED_ORIGINS') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

async function userClient(req: Request) {
  const header = req.headers.get('authorization') || '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const url = Deno.env.get('SUPABASE_URL') || '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || '';
  if (!url || !anon) return null;
  const client = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
  try {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) return null;
    return client;
  } catch {
    return null;
  }
}

function rpcError(): Response {
  return json(400, GENERIC, null);
}

Deno.serve(async (req: Request) => {
  const origin = corsOrigin(req);
  if (req.headers.get('origin') && !origin) return json(403, GENERIC, null);
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
        'access-control-allow-methods': 'POST',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-max-age': '600',
      },
    });
  }
  if (req.method !== 'POST') return json(405, GENERIC, origin);
  let raw = '';
  try {
    raw = await req.text();
  } catch {
    return json(400, GENERIC, origin);
  }
  if (!raw || raw.length > PUSH_REQUEST_JSON_MAX) return json(413, GENERIC, origin);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, GENERIC, origin);
  }
  if (!body || typeof body !== 'object') return json(400, GENERIC, origin);
  const action = body['action'];

  // Public VAPID key only. Missing key means push is not configured: the
  // frontend reports "unconfigured" and never asks for permission.
  if (action === 'config') {
    const authed = await userClient(req);
    if (!authed) return json(401, GENERIC, origin);
    const publicKey = Deno.env.get('VAPID_PUBLIC_KEY') || '';
    if (!publicKey) return json(503, GENERIC, origin);
    return json(200, { ok: true, publicVapidKey: publicKey }, origin);
  }

  const client = await userClient(req);
  if (!client) return json(401, GENERIC, origin);

  try {
    if (action === 'state') {
      const { data, error } = await client.rpc('witness_push_get_state');
      if (error || !data) return json(500, GENERIC, origin);
      return json(200, {
        ok: true,
        prefs: (data as Record<string, unknown>)['prefs'] || null,
        subscriptions: (data as Record<string, unknown>)['subscriptions'] || 0,
        syncedKeys: (data as Record<string, unknown>)['syncedKeys'] || [],
      }, origin);
    }
    if (action === 'prefs') {
      const input = (body['prefs'] as Record<string, unknown>) || {};
      const check = validatePushPrefs({
        phraseEnabled: input['phraseEnabled'],
        questionEnabled: input['questionEnabled'],
        previewText: input['previewText'],
        cadence: input['cadence'],
        localTime: input['localTime'],
        timeZone: input['timeZone'],
        quietStart: input['quietStart'],
        quietEnd: input['quietEnd'],
        lastSentPhrase: null,
        lastSentQuestion: null,
      });
      if (!check.ok) return json(400, GENERIC, origin);
      const keep = blankPushPrefs();
      void keep;
      const { error } = await client.rpc('witness_push_save_prefs', {
        p_prefs: {
          phraseEnabled: check.prefs.phraseEnabled,
          questionEnabled: check.prefs.questionEnabled,
          cadence: check.prefs.cadence,
          localTime: check.prefs.localTime,
          timeZone: check.prefs.timeZone,
          quietStart: check.prefs.quietStart,
          quietEnd: check.prefs.quietEnd,
          previewText: check.prefs.previewText,
        },
      });
      if (error) return json(500, GENERIC, origin);
      return json(200, { ok: true }, origin);
    }
    if (action === 'subscribe') {
      const endpoint = (body['endpoint'] as string) || '';
      const keys = (body['keys'] as Record<string, unknown>) || {};
      const p256dh = String(keys['p256dh'] || '');
      const auth = String(keys['auth'] || '');
      if (!allowedPushEndpoint(endpoint) || !p256dh || !auth) return json(400, GENERIC, origin);
      if (p256dh.length > 512 || auth.length > 512) return json(400, GENERIC, origin);
      const { error } = await client.rpc('witness_push_add_subscription', {
        p_endpoint: endpoint,
        p_p256dh: p256dh,
        p_auth: auth,
      });
      if (error) return json(500, GENERIC, origin);
      return json(200, { ok: true }, origin);
    }
    if (action === 'unsubscribe') {
      const endpoint = String(body['endpoint'] || '');
      if (!endpoint || endpoint.length > 2000) return json(400, GENERIC, origin);
      const { error } = await client.rpc('witness_push_remove_subscription', { p_endpoint: endpoint });
      if (error) return json(500, GENERIC, origin);
      return json(200, { ok: true }, origin);
    }
    if (action === 'sync-quote') {
      const s = (body['snapshot'] as Record<string, unknown>) || {};
      const snapshot = {
        quoteKey: String(s['quoteKey'] || ''),
        text: String(s['text'] || ''),
        author: String(s['author'] || ''),
        sourceTitle: String(s['sourceTitle'] || ''),
        sourceKind: String(s['sourceKind'] || ''),
        sourceId: String(s['sourceId'] || ''),
        sourceRevision: s['sourceRevision'] == null ? null : Number(s['sourceRevision']),
      };
      if (
        !snapshot.quoteKey || snapshot.quoteKey.length > 200 ||
        !snapshot.text || snapshot.text.length > 2000 ||
        snapshot.author.length > 200 || snapshot.sourceTitle.length > 200 ||
        !['own', 'shared-fictional', 'published'].includes(snapshot.sourceKind) ||
        !snapshot.sourceId || snapshot.sourceId.length > 200 ||
        ((snapshot.sourceKind === 'shared-fictional' || snapshot.sourceKind === 'published') &&
          !Number.isInteger(snapshot.sourceRevision))
      ) return json(400, GENERIC, origin);
      // Ownership/author for 'published' is verified owner-side inside the
      // SQL function against the caller's own witness_quotes row; caller
      // input is never trusted, and failures stay generic (no values echoed).
      const { error } = await client.rpc('witness_push_sync_quote', { p_snapshot: snapshot });
      if (error) return json(500, GENERIC, origin);
      return json(200, { ok: true }, origin);
    }
    if (action === 'revoke-quote') {
      const quoteKey = String(body['quoteKey'] || '');
      if (!quoteKey || quoteKey.length > 200) return json(400, GENERIC, origin);
      const { error } = await client.rpc('witness_push_revoke_quote', { p_quote_key: quoteKey });
      if (error) return json(500, GENERIC, origin);
      return json(200, { ok: true }, origin);
    }
    if (action === 'test') {
      const endpoint = String(body['endpoint'] || '');
      if (!allowedPushEndpoint(endpoint)) return json(400, GENERIC, origin);
      const { data, error } = await client.rpc('witness_push_own_subscription', { p_endpoint: endpoint });
      if (error || !data) return json(404, GENERIC, origin);
      const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY') || '';
      const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY') || '';
      const subject = Deno.env.get('VAPID_SUBJECT') || '';
      if (!vapidPublic || !vapidPrivate || !subject) return json(503, GENERIC, origin);
      const today = new Date().toISOString().slice(0, 10);
      const payload = {
        id: `${today}:phrase`,
        kind: 'phrase',
        title: 'Witness test',
        body: 'Reminders work on this device.',
        url: './?push=saved',
        ts: Date.now(),
      };
      if (!validatePushPayload(payload).ok) return json(500, GENERIC, origin);
      const webpush = (await import('npm:web-push@3.6.7')).default;
      webpush.setVapidDetails(subject, vapidPublic, vapidPrivate);
      const sub = data as { endpoint: string; p256dh: string; auth: string };
      const send = webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 3600 },
      );
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000));
      try {
        await Promise.race([send, timeout]);
      } catch (err) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          await client.rpc('witness_push_remove_subscription', { p_endpoint: endpoint });
        }
        return json(500, GENERIC, origin);
      }
      return json(200, { ok: true }, origin);
    }
    return json(400, GENERIC, origin);
  } catch {
    return json(500, GENERIC, origin);
  }
});
