# Supabase Auth with Google sign-in (live-tested locally)

Guest-first flow is unchanged: interview, review, story, Connect, saved
phrases, and likes all work with no account and no network. Account is an
optional step, offered after the first finished story via “Save to my
account”. No signup wall stands before recording. Opening Account never
starts a sign-in on its own; the Google redirect begins only from the
explicit “Continue with Google” button.

## What this increment does

- Account dialog with a Google-only sign-in button
  (`data-action="account-google"`) using the official
  `@supabase/supabase-js` SDK (`signInWithOAuth` with provider `google`,
  PKCE flow, no extra scopes), vendored to `web/vendor/supabase.js` at
  build time and loaded only on explicit Account action. Guest Home never
  loads it.
- OAuth return handling: only a URL carrying `?code=` or a Supabase
  `access_token`/`error` fragment loads the SDK on boot, which exchanges
  and consumes it, cleans the address bar, and reopens Account. Every other
  load stays fully local.
- Text-only cloud copies in `witness_projects` (see
  `supabase/migrations/20261102_witness_projects.sql`), saved and imported
  only on explicit action with revision compare-and-swap. Recordings and
  images always stay on this device.
- The local shelf is labelled “On this device” and never merges cloud
  data. Signing out (or switching accounts) clears cloud lists and cancels
  pending cloud requests.
- Legacy email-OTP helpers remain in `web/auth.js` with tests but are no
  longer shown in the product UI; no SMTP is needed.

## Owner setup (done for local checks)

1. Google OAuth client (Web application) created, with the Supabase
   callback URL added as an authorised redirect URI.
2. The Google provider is ENABLED in the Supabase dashboard, with the
   Google client ID and client secret in the provider settings.
3. Site URL and allowed redirect are both `http://127.0.0.1:4173/` for
   local checks, plus the real hosted URL later.
4. The browser ships ONLY the publishable Supabase key
   (`web/supabase-config.js`). The Google client secret lives in the
   Supabase provider settings — never in the app or Git. A local
   untracked env file may hold a copy, but the frontend never reads it.

Social OAuth is included in the Supabase Free plan: no paid upgrades, no
paid resources, and no owned domain are needed for Google sign-in.

See the official guide:
[Google sign-in with Supabase](https://supabase.com/docs/guides/auth/social-login/auth-google).

## Honest status gates

- The `witness_projects` migration has been applied, and strict
  rollback-only DB RLS checks returned PASS.
- Live browser QA confirmed: real Google sign-in, private save of the
  fictional “The night we missed the last train” at revision 1, cloud
  list refresh, and `openCloudProject` retrieval of the saved copy.
  Import on the same device correctly refuses an already-present ID as
  a duplicate; duplicate semantics are intentionally unchanged.
- Not yet tested: import on a fresh device.
- Unit tests use SDK fakes and do not prove production delivery; the
  owner re-tests live behaviour after any provider or URL change.
