# Deployment readiness

Honest status of installing, updating, and hosting Witness. Items marked Now
describe the current code; items marked Needed are gaps to close.

## Installation

- Now: `npm run dev` builds `dist/` from `web/` and serves it with `/api/`
  on `http://127.0.0.1:4173`. `npm run build` produces the static `dist/`
  Site, which runs without a backend and stays on mocks. Requires Node 22+ (matching `engines` in package.json).
- Now: PWA manifest (`web/manifest.webmanifest`) and service worker
  (`web/sw.js`) are implemented and covered by offline tests: the installed
  shell opens offline and updates wait for an explicit activation message.
- Needed: no installer, auto-updater, or packaged app beyond the PWA.

## Offline drafts

- Now: answers, drafts, edits, and metadata persist in localStorage key
  `witness.stories.v1`; recordings and scene images persist in IndexedDB
  database `witness-media-v1`. A **Download backup** action exports the
  localStorage data as JSON. The backup does not include recording audio
  bytes or scene image bytes, which live only in IndexedDB. Static
  responses carry `Cache-Control: no-store`, so reloads always fetch fresh
  code when the server runs.
- Now: the app shell loads offline once installed (service worker cache,
  tested); offline drafts additionally survive in a browser that already has
  the page open.

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

## Storage limitations

- Now: story text can be backed up to a signed-in account (`witness_projects`
  rows, owner-scoped by row-level security); recordings, scene images, and
  exported films live only in the browser's IndexedDB — there is no cloud
  media storage yet, and the server never writes uploads to disk. Clearing
  browser data removes media; the UI says so and offers backup downloads.
  Storage being local does not mean nothing is ever sent anywhere: when live
  AI features are used, the selected material for each request is sent to
  Meta for processing — interview answers for questions, events, grouping,
  and wording; audio for transcription; approved scene excerpts for images;
  public excerpts for semantic discovery. Nothing is sent automatically;
  each request follows a narrator action, and mock mode sends nothing.
- Now: browser storage can be evicted under space pressure, and private
  windows may discard it on close. The app surfaces storage failures instead
  of silently losing media, but it cannot recover evicted bytes.
- Needed: cloud media storage (Supabase Storage is not wired); backup
  restore (export exists, import does not).

## Hosted Node backend

- Now: `PUBLIC_ORIGIN` switches the server to hosted mode (local mode keeps
  localhost defaults and mocks). The server binds `HOST`/`PORT`, serves a
  lightweight `/health` probe, and gates `/api/` to the configured public
  host without trusting forwarded headers. Every paid Meta endpoint
  requires a server-verified Supabase session; per-user hourly limits,
  bounded concurrency, request deadlines, and a shared generation cap
  protect the key, and verification/repair calls count too. Hosted mode
  never serves mocks: missing keys or sessions produce short errors while
  user work stays saved. Secrets live in server-side environment only;
  nothing logs stories, recordings, tokens, keys, or populated values.
- Needed before public traffic: provider spend alerts, mobile-browser
  verification, backup restore, and cloud media storage. Never log answer
  text, audio, API keys, or populated environment values.
