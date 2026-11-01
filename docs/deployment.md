# Deployment readiness

Honest status of installing, updating, and hosting Witness. Items marked Now
describe the current code; items marked Needed are gaps to close.

## Installation

- Now: `npm run dev` builds `dist/` from `web/` and serves it with `/api/`
  on `http://127.0.0.1:4173`. `npm run build` produces the static `dist/`
  Site, which runs without a backend and stays on mocks. Requires Node 20+.
- Needed: no installer, auto-updater, or packaged app. No PWA manifest or
  service worker, so there is no install prompt and no offline page beyond
  what the browser caches.

## Offline drafts

- Now: answers, drafts, edits, and metadata persist in localStorage key
  `witness.stories.v1`; recordings and scene images persist in IndexedDB
  database `witness-media-v1`. A **Download backup** action exports the
  localStorage data as JSON. The backup does not include recording audio
  bytes or scene image bytes, which live only in IndexedDB. Static
  responses carry `Cache-Control: no-store`, so reloads always fetch fresh
  code when the server runs.
- Needed: no service worker, so the app shell itself does not load offline.
  Offline drafts survive only in a browser that already has the page open.

## Safe updates

- Now: the versioned storage key (`witness.stories.v1`) and additive
  loaders mean new fields load alongside old saves; unknown or corrupt
  saves fall back to an empty state with a visible warning instead of
  crashing.
- Needed: no migration framework between key versions and no backup
  restore (export exists, import does not). Any future key bump must ship
  an explicit migration plus a restore path, tested against a real saved
  export.

## Mobile audio

- Now: recording uses `getUserMedia` plus an AudioWorklet WAV encoder, and
  uploads accept WAV files as a fallback. Nothing in the code is
  desktop-only.
- Needed: mobile browsers are unverified. Microphone capture requires a
  secure context (HTTPS or localhost); iOS Safari backgrounding, sample
  rate handling, and upload size limits still need real-device checks
  before any mobile claim.

## Local-only storage limitations

- Stored stories, recordings, and images live only in the browser: there is
  no account, no sync, and no server copy. Clearing browser data removes
  them; the UI says so and offers backup downloads. Storage being local
  does not mean nothing is ever sent anywhere: when live AI features are
  enabled on the local server, the selected material for each request is
  sent to Meta for processing — interview answers for questions, events,
  grouping, and wording; audio for transcription; approved scene excerpts
  for images. Nothing is sent automatically; each request follows a
  narrator action, and mock mode sends nothing.
- Browser storage can be evicted under space pressure, and private windows
  may discard it on close. The app surfaces storage failures instead of
  silently losing media, but it cannot recover evicted bytes.

## Hosted Node backend

`scripts/serve.mjs` plus `server/` is the starting point, not a finished
hosted backend.

- Now: secrets load from server-side environment (`.env` is gitignored and
  never shipped); `/api/` routes accept localhost only; one live AI request
  runs at a time with per-request timeouts and an overall verification
  deadline; transcription, images, and text each have separate enable flags;
  billing, key, and rate-limit failures return readable errors without
  automatic retries.
- Needed before hosting: replace the localhost gate with real origins and
  authentication; scope the concurrency guard and budgets per user or key;
  add TLS termination, request logging without prompts or transcripts,
  health checks, and provider spend caps with alerts. Never log answer
  text, audio, API keys, or populated environment values.
