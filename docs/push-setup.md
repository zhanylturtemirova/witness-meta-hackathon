# Push setup (administrator steps)

Optional Web Push is **unconfigured** until every step below lands. The app
reports "unconfigured" and never prompts until then. Nothing here is done
yet: the migration has NOT been applied and no secrets exist.

## 1. Apply the schema

In the Supabase SQL editor (or `supabase db push`), apply once:

- `supabase/migrations/20261104_push.sql`

First-install script, not idempotent: re-running fails on "already exists"
for the policies, which means the objects are already there. Verify with a
rollback-only check that the four `witness_push_*` tables exist and carry no
direct grants.

## 2. Deploy the functions

- `supabase/functions/witness-push` (`verify_jwt = true` in
  `supabase/config.toml`) — user configuration and subscriptions; every
  request carries the caller's JWT, verified with `auth.getUser()`.
- `supabase/functions/witness-push-send` (`verify_jwt = false` for this
  function only) — cron caller; authentication is the server-only
  `PUSH_SCHEDULER_SECRET` on the `apikey` header. User JWTs never match.

## 3. Set secrets (server side only, never in the app)

`witness-push` needs: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT` (a `mailto:` contact), `PUSH_ALLOWED_ORIGINS`.
`witness-push-send` needs those plus `PUSH_SCHEDULER_SECRET`.
No keys are generated yet; the project maintainer creates them at setup time (VAPID pair
via the `web-push` CLI, scheduler secret as a fresh random value) and stores
them as function secrets. VAPID keys are per project, not per user.

## 4. Vault + schedule

Requires the `pg_cron` and `pg_net` extensions. Store two Vault secrets:

- `push_project_url` — the project URL (`https://....supabase.co`)
- `push_scheduler_secret` — the same `PUSH_SCHEDULER_SECRET` value

Then run `supabase/push-cron.sql`. It fails closed: missing secrets raise
before any schedule changes, so a failed setup never disturbs a working job.
The job posts every 15 minutes; send logic (due time, quiet hours, daily cap
of 2 per user, one claim row per user/day/kind) lives server-side.

## 5. HTTPS and iOS notes

- Push subscriptions require a secure context: serve over HTTPS (localhost
  counts for local testing only).
- iOS: Web Push needs iOS 16.4+, the app installed to the home screen as a
  PWA, and permission granted inside the installed app — Safari tab pushes
  do not arrive. The enable button still fails closed with an explanation
  where unsupported.

## 6. Live test gate

Only after 1–5: sign in on a real device, open Settings, prepare (sign-in +
backend config verified), then use the explicit Enable gesture and send the
test push. Entering the new secret credentials is required before any live
push test; do not fake an enabled state.
