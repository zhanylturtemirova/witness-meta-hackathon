# Working app plan

The active build sequence for Witness toward a working multi-user product.
Earlier documents ([hackathon scope](hackathon-scope.md), [journal and Connect](journal-and-connect.md),
[future features](future-features.md), [deployment](deployment.md)) remain context;
this file is the current sequence and its acceptance gates.

The intended complete journey: start as a guest or register first, with guidance
toward one concrete question by voice or text; interview → source-grounded review →
story and events → approved animated cartoon adaptation; Connect draws arcs from the
person's chosen event city to genuinely similar published stories; like a story,
save an exact phrase, revisit saved phrases; optional push opt-ins with quiet hours.

Already working locally (no account, no server): guest interview with voice or text,
`Help me start` choices, source-grounded review, editable story with passage-level
sources and export, life events with confirmation, storyboards and illustrated films
from approved scenes, Connect globe over fictional stories, on-device likes and
saved phrases under `Saved`. Mock AI by default; live Meta interview/event/image
requests only with explicit local server configuration.

## Build sequence

1. **Guest foundation (done).** Guest flow works fully without login. Guest work is
   keyed to the browser; nothing leaves the device.
2. **Saved phrases and likes (done, local).** Versioned `localStorage` keys
   (`witness.saved.v1`, `witness.liked.v1`), separate from the stories schema.
   Exact wording only, with author/source attribution; deleting a private own story
   purges its saved quotations. Explicitly on-device: no totals, no accounts.
3. **Supabase project setup (next, needs project configuration).** Create the project,
   apply the schema with row-level security, configure storage buckets, then wire
   the app. Nothing in the app talks to Supabase until this lands.
4. **Accounts with guest migration.** Email sign-up/sign-in via Supabase Auth;
   creating an account after the first story preserves guest work by importing it
   under the new user id. Account isolation: every private row carries `owner_id`
   and RLS denies all cross-user reads. Acceptance: guest stories appear unchanged
   after registration; a second account cannot read them.
5. **Approved publishing, distinct from the private diary.** Publishing is an
   explicit per-story action: a private story becomes a published row (a copy with
   its own id and version), never a flag flip on the diary. Unpublishing removes
   the copy; the diary is untouched. Acceptance: private answers are never
   readable through published endpoints.
6. **City-level matching with source and version references.** Connect arcs start
   at the person's chosen event city and match genuinely similar published stories:
   same occasion (shared occasion id) stays distinct from similar experience
   (topic/evidence overlap). Matches cite story id, version, and match evidence.
   Acceptance: changing a published story's version updates or withdraws its
   matches; occasion and similarity labels never mix.
7. **Media: private versus published storage.** Private recordings and scene images
   stay in user-scoped private buckets; publishing copies only the approved media into
   public-read buckets. Acceptance: private bucket URLs are signed and
   readable only by that user; published media serves without credentials.
8. **Likes and quotes on the backend.** Likes become per-user rows (one per
   user/story); quotes carry author, source story id, version, and exact text.
   Counts shown are real counts from these rows. Local on-device likes migrate
   once, then the server is the source of truth. Acceptance: unlike removes the
   row; deleted published stories remove their likes/quotes.
9. **Meta per-user API budgets.** Interview, event, image, and transcription calls
   stay server-side behind the existing adapters, with a per-user call budget and
   the local mock fallback. Acceptance: an exhausted budget degrades to mocks
   with a visible note; keys never ship to the browser.
10. **Push infrastructure with device verification.** Optional separate opt-ins for
    saved-phrase reminders and invitation questions, with quiet hours, timezone,
    and off switch. Server scheduler plus service-worker push — never tab timers
    presented as closed-app notifications. Devices verify via stored subscriptions;
    unsubscribed or revoked devices stop receiving. Acceptance: no permission
    dialog appears before the user asks; disabling stops all pushes.
    Status: schema, both Edge functions, the sender helper, behavior tests,
    and the administrator setup guide (`docs/push-setup.md`) is in the repo, but
    delivery is unconfigured — the push migration is NOT applied and no
    secrets exist, so live push is untested and the app reports unconfigured.
11. **Deployment.** Static app plus server and scheduled jobs deploy together;
    environment, DNS, and SMTP land with the release (see blockers).

## First blockers and configuration

The Supabase Free project already exists in eu-west-1
(https://fzsvvnkeybgtjqxbbqmk.supabase.co). To unblock accounts the project maintainer
provides the project URL and publishable key for browser access with RLS; no
service-role key and no owned domain are needed for Supabase Auth. Sign-in is
Google OAuth (free, no SMTP needed): the Google client ID/secret are configured
in the Supabase provider dashboard, never in the app. The witness_projects
migration has been applied and strict rollback-only DB RLS checks returned
PASS; no real app login has been tested yet, and no paid upgrades happen in
this increment.

Honest limits, from official pricing and docs:

- Supabase Free: 50k monthly active users, 500 MB database, 1 GB file storage,
  2 active projects; projects pause after 1 week idle. Enough to build and pilot;
  media-heavy or idle-sensitive production outgrows it.
- Sign-in uses Google OAuth, included in Supabase Free with no SMTP: the project maintainer
  enables the Google provider with the callback
  `https://fzsvvnkeybgtjqxbbqmk.supabase.co/auth/v1/callback` and allows the app
  redirect (`http://127.0.0.1:4173/` locally, plus the hosted URL later).
  Email-OTP forms are retired from the UI.
- Clerk Hobby (50k monthly reportable users) remains the alternative, but it
  still needs a separate database and media store, and production requires an
  owned DNS domain.
- Default recommendation: Supabase, on the Free plan, with no paid upgrades yet.

## References

- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [Google sign-in with Supabase](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Clerk pricing](https://clerk.com/pricing)
- [Clerk production deployment](https://clerk.com/docs/guides/development/deployment/production)
- [Meta models](https://dev.meta.ai/docs/models)

Existing product constraints still apply: Meta/Muse adapters only, no weight
training; Muse Image returns images, not motion video, and the cartoon film is
described honestly with scene approval and source binding retained; no paid
generation calls without explicit authorisation.

## Supabase configuration

An owned domain is a Clerk production requirement, not a prerequisite for Supabase Auth. Connection details live in the First blockers section above.
