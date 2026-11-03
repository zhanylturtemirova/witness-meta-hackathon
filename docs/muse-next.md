# Witness: the next implementation stages

Work in this Witness repository. Read AGENTS.md, the current diff, docs/redesign-plan.md and docs/visual-direction.md. Preserve the existing in-progress work. Do not reset, replace or rewrite unrelated changes.

Design sketches (four tabs: My space, Connect, Editing, Adaptations) describe the intended layout and flow; they are proposals, not implemented features.

The direction below is the basis for implementation. This brief overrides the older planning-only wording. Implement one stage per turn, with checks and a clear result before moving to the next stage. Start Stage 1 now; do not merely produce another plan. Subsequent stages are the agreed roadmap, not a requirement to finish the whole product in one run.

## Product clarification that applies across stages

Read [Journal and Connect](journal-and-connect.md). Witness is an ongoing prompted journal as well as an interviewer for older memories. It should combine selected day/week/month entries into one editable, sourced story while keeping specific events in an independent collection. Recording date and event date are different.

Connect is a core product direction. Its sidebar lists the person's events. Selecting one creates an origin marker and outward lines to matching shared stories. Distinguish the same specific occasion (date/place/identity evidence) from similar experiences across different dates and countries (for example, first jobs on comparable housing projects). Show why each match was made; do not match on a broad category alone. This clarified selected-origin behaviour supersedes the earlier single-arc sketch. Use fictional matches until real sharing and backend permissions exist.

Preserve the Stage 2 work already underway. This clarification updates the direction; it does not authorise resetting that work, introducing every later feature at once, or enabling paid calls. Stage 2 establishes the journal/event navigation and review UX; Stage 3 implements period narratives and event/matching contracts; Stage 4 implements the globe interaction and fictional matching fixtures. Real multi-user discovery and closed-app notifications remain separate infrastructure work.

## Stage 1: reliable capture

First verify and fix these previously observed issues if they are still present:
- An old recording's transcript can be appended to a different current interview question. Bind recording, transcript and asynchronous work to stable project/question/answer identities. Offer an explicit way to revisit the original question; never silently attach to the wrong answer.
- Stopping a recording clears the active recording before worklet flush and IndexedDB saving finish. Navigation or a new upload can race with that work and lose or misassign audio. Keep a clear stopping/saving state or preserve immutable ownership through completion. Cover uploads, discard and stale callbacks too.
- Restoring a generated scene image does not restore its download link.

Preserve source versions, uncertainty, edited drafts, existing audio and images. Test actual IndexedDB reload/navigation in the browser, not just the Node memory fallback.

Question read-aloud has already been added in web/question-speech.js. Preserve it: opt-in, installed English device voices only, voice/speed selection, repeat/stop, no speech before a click after reload, cancellation before microphone capture and recorded-audio playback, no stale question during a pending request. It is device speech synthesis, not a Meta voice model. Keep voice and text equally available.

## Stage 2: a private place to return to

Replace the generic marketing home and interview shell using the My space and Editing sketches as direction. English copy only. Remove slogans such as Your life is a story, decorative stars, vague inspirational copy and model names from everyday controls; retain accurate provenance in details.

Show one concrete optional question, Record / Write instead, Another question, Not now, and Continue my last conversation. Preserve unfinished answers. Add a practical memory library, exact resume position, readable memories, original audio, and source-linked proposed edits with accept/reject. A person can start with a small scene; never require a whole autobiography. Keep private content private. Verify desktop, narrow widths, keyboard access and empty/error/saving states.

## Stage 3: working Muse roles

Use the existing server-side Meta Model API adapter and documented model IDs. Roles can share Muse Spark with separate prompts and contracts:
- Interviewer: one short contextual, non-leading question; respects skip, refusal, topic changes and sensitive boundaries; remembers open threads.
- Archivist: extracts events with source IDs/versions and explicit uncertainty; no invented dates, places, emotions or quotes.
- Editor: proposes readable passages that preserve the narrator's meaning and voice, with source links and accept/reject; never overwrites original answers.
- Verifier: checks claims against source answers, separates model checks from narrator approval, and preserves the existing bounded verification budget/deadline. No endless repair loop or verified label on timeout.
- Art director: creates a source-grounded storyboard and descriptive visual treatment only from approved material. Image generation remains per approved scene, with source-change invalidation.

Inspect which roles are already implemented; extend rather than duplicate them. Wire the roles into the actual voice/text → follow-up → event review → editable story → approved illustrated adaptation flow. Avoid running all roles on every keystroke. Keep real vs mock behaviour explicit without cluttering the normal UI. Add a small fictional evaluation set covering vague dates, contradictions, corrections, refusal, changed topic, short answers and preserving distinctive wording. Report baseline behaviour and remaining failures. Prompt configuration and evaluation are not weight training; do not claim models were trained.

## Stage 4: Connect as Earth seen from space

Render a photoreal textured Earth (textured sphere with clouds, atmosphere, and day/night shading) using day and night Earth textures. Preserve licence and NASA texture credits (Blue Marble / Black Marble sources). Do not use a dot-globe treatment or a reduced-resolution texture.

Adapt it to this app without importing the unrelated landing page. Use atmosphere, day/night shading and restrained clouds. The sidebar contains the person's own events. Selecting one establishes its event location as the origin, lights up matching shared events, then grows outgoing arcs in a short staggered sequence. Settled arcs remain faintly visible; focus highlights one line and story. Do not connect all other people to each other. Keep up to two readable excerpts, cluster dense markers, and keep all results available in the list. End the entry sequence; offer pause/replay, reduced motion, keyboard access and a WebGL fallback. Same-event matching needs compatible identifying details/date/place; similar experiences can match across countries and years with a concrete explanation. Arcs express the connection, not a journey. Use fictional counterpart stories until real sharing, access control and consent exist. Never expose private interviews as background quotes. Follow docs/journal-and-connect.md for examples and acceptance scenarios.

## Later stages: keep these visible in the roadmap

Saved passages and optional reminders: separate question/quote opt-ins, quiet hours and pause/off, no guilt or streaks. Start with saved passages and an honest in-app reminder inbox. Real closed-app push requires service-worker/backend infrastructure, permission and device testing; a timer is not push.

Illustrated adaptations: a 20–45 second approved scene, coherent characters, original narration, captions and deliberate paper-cut, ink or miniature visual treatments. Muse Image generates images; layered code animation makes a motion comic. Do not call it a fully generated moving-video model. A later 2D game starts with one room and one meaningful interaction. Publisher/editor profiles, story submissions and rights offers are separate later work with explicit narrator control; never expose a private archive or silently grant rights.

## Working and verification rules

Use Meta Muse for all model-powered product features. Ordinary interface, storage, device TTS, 3D rendering and video assembly are application code. No additional AI provider or undisclosed stock/OpenAI-image fallback.

Use fictional test content. Never print keys, populated environment values or private stories. Do not change .env, enable network flags, deploy, push, enrol notifications, train weights or perform new paid API tests as part of this task. Existing model adapters should remain configurable; use fake transports for automated tests. If a live check is needed, first report the exact fictional scenario, maximum calls and timeout for separate approval.

Use an existing browser for UI checks. If browser automation is unavailable, report that limitation; do not spend the session downloading browsers or weakening permission settings.

At each stage report: what now works for the person using Witness, changed files, checks actually run, what uses live Meta vs mocks/device features, and unresolved limitations. Stop after the current stage so the result can be reviewed.
