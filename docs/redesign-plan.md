# Witness — product and design plan

Product direction and implementation reference. Optional device read-aloud is part of the direction, and docs/muse-next.md defines the currently authorised implementation scope. All product copy stays English. The interactive sketches are proposals, not implemented features.

## Product decision

Witness is an ongoing voice-first journal and interviewer. It helps people capture today, revisit the past, and find others through shared experiences. Optional questions start small conversations; entries can become an editable day, week or month story while specific events stay in their own collection. A whole autobiography can emerge gradually; it is never an onboarding assignment. The main loop is: invitation or self-started entry → voice or text → a relevant follow-up → sourced events and a period story → optional sharing and discovery. [Journal and Connect](journal-and-connect.md) defines this behaviour and takes precedence over an archive-only interpretation.

Use a quiet, practical private workspace and a cinematic shared world. These are complementary places, not a black space theme across the whole app. Avoid generic inspirational headlines, starbursts, giant serif marketing slogans, synthetic empathy, fake urgency, streaks, and model names in everyday controls. Keep model provenance accessible in scene details and settings.

## Home and information architecture

Primary navigation: My space, Connect, Saved, Settings. My space contains a conversation and a memory library, not a marketing landing page. Separate the title and location of a story from the date it was recorded.

Home shows one specific optional question and Record / Write. Examples: 'What did breakfast look like when you were little?', 'Who first made your work feel possible?', 'What do you remember about your first day in that city?' Don't assume a childhood was happy, a person had parents present, or a profession unless stated. Offer Another question, Not now, Continue my last conversation. Never replace an unfinished answer with a new prompt.

Below: unfinished conversations with exact resume point, saved memories, and one deliberately chosen reading recommendation. No counters implying an incomplete life. Optional sensory prompts (sound, food, a place, a photograph) help people start with one scene. A 90-second answer can be enough; longer sessions remain possible. Let people preserve an original voice recording without agreeing to a rewrite or publication.

Reading view uses a restrained serif and wide margins, optional original-audio playback, highlights, and a visible audience choice. Home and capture use a neutral sans-serif and concrete verbs. Proposed labels: Record an answer, Write instead, Continue this conversation, Review this memory, Save privately, Choose who can read it. Remove 'Your life is a story', 'A little space to look back', 'Every life, a story', decorative stars and vague 'Bring it together'.

## Connect: Earth from space, then a human story

Verified reuse candidate:
- A photoreal textured-Earth renderer (textured sphere with clouds, atmosphere, and day/night shading) with day/night Earth textures
- Three.js 0.180.0; the project README identifies NASA Blue Marble and Black Marble texture sources.
- This is the photoreal textured Earth with clouds, atmosphere and day/night shading. user-insights/src/components/world-globe.tsx is a different dot globe and is not the requested visual.

Extract the Earth renderer and its texture loading, not the whole landing page, scroll choreography or unrelated cards. Preserve the code's MIT notice; verify and retain texture source credits before redistribution. The scene is deterministic rendering, not an AI content generator.

Connect starts from the narrator's event list in a side panel, not a generic topic picker. Selecting an event establishes its location as the origin. Matching shared events light up across the Earth; outgoing arcs grow from that origin to the matches in a short staggered sequence. Settled arcs remain faintly visible, with one line and story highlighted on focus. This replaces the earlier single-connection sketch: the intended view is a selected-origin set of connections, not an all-to-all mesh. Keep at most two readable excerpts, no continually replaying wall of quotes, and generous dark space. Cluster or progressively reveal dense results without dropping the remaining matches from the list. Pause/replay, reduced motion, keyboard access, a WebGL fallback and a mobile budget are required.

A connection represents a relationship between experiences, not a journey. Distinguish 'same event' (compatible named occasion, date and place) from 'similar experience' (for example, first jobs building cottages in different countries and years). The latter must compare relevant supplied details rather than require identical dates or places or match only a broad category. Show the supporting excerpts and why each result matches. Keep only narrator-approved public excerpts eligible. Bookmarked private stories, private interviews and precise locations never become background decoration. Use fictional fixtures until real sharing and consent exist. Coarse location means a deliberately selected city/region, not inferred GPS or exact home coordinates.

## Voice experience and retention

Push-to-talk first: record → stop → saving → transcript ready → review → use. During stopping, decoding and saving, prevent question/project changes or tie every pending result to an immutable project/question ID. Fix the current stop/navigation race and prevent an old recording's transcript from being added to a different question. Keep discard explicit. Persist recordings, edited transcripts, source links and paid scene images; visibly handle quota and reload failures. Restore image download links too. Avoid duplicate answer submission.

Muse Voice Transcribe provides speech-to-text. Optional question read-aloud now uses installed English browser/device voices, with opt-in, voice and speed selection, repeat and stop. Speech stops before opening the microphone, during recorded-audio playback and on navigation; it stays silent after reload until a new click. Preserve web/question-speech.js when redesigning. This is device speech synthesis, not Muse speech generation. No TTS API request is made by Witness. The currently checked Meta catalogue does not expose moving-video generation; do not promise it through Muse Image.

## Muse roles: define and evaluate before training weights

One text model can serve several roles through separate instructions and state; separate roles do not require separate trained models. Start on the existing Meta Model API, without introducing another inference provider.

Interviewer (Muse Spark): one short question, grounded in the last answer and conversation goal. Avoid repeating known facts, leading questions, invented emotions and diagnosis. Let the narrator decline, change topic or stop. Ask permission before dwelling on sensitive material. Save what is still open so a later question resumes the thread instead of starting over.

Archivist (Muse Spark): extract events, people and approximate dates into structured records with answer IDs/revisions. Unknown remains unknown. Reuse the bounded verification loop; never conflate AI verification with the person's approval.

Editor (Muse Spark): transform approved material into a readable scene without inventing connective facts. Show original/proposed text, sources and uncertain details. Offer faithful transcript, lightly edited scene, or a chosen narrative voice. The narrator can accept, edit or reject each proposed change. Preserve an original version permanently until explicit deletion. Any factual edit invalidates previous verification; late responses must not overwrite newer edits. A dramatic tone is not permission to invent events.

Art director (Muse Spark): turn approved excerpts into structured scene briefs, setting unknown appearance/details as imagined. Illustrator (Muse Image): generate approved images with a consistent palette and reusable approved character sheet; narrator identity/likeness is separate permission. Source-text truth and image aesthetics have different checks. No automatic picture generation merely by opening a page.

Evaluation plan, suggested initial sizes (not a claim these data exist): 30–50 fictional conversation cases including refusal, uncertainty, ordinary life, contradiction and topic change; 100+ reviewed question/answer examples; 50 source-linked editor examples. Keep a held-out set of stories, not near-duplicate fragments of training stories. Score question relevance, repetition, unsupported presuppositions, faithful uncertainty, invented facts, editing quality, source correctness, latency and cost. Aim for zero invented factual claims and zero lost originals in the evaluation set. Preference judgements require human review; source IDs alone are not semantic verification.

Fine-tuning is a later experiment for a measurable persistent failure after prompts, examples, retrieval and orchestration are tested. Muse Spark prompts are not a fine-tuning job. If later chosen, investigate supported Muse Glimmer / Spark Open training and deployment, dataset consent and costs, then train a narrow role with SFT and compare to the baseline. No personal memories enter training by default. DPO can be considered after genuinely reviewed preference pairs exist; RL is not a first step for subjective autobiographical quality.

## Reminders and rediscovery

Two independent opt-ins: conversation invitations and saved passages. Let the person choose frequency, days, quiet hours, timezone, pause and off. Proposed defaults after opt-in: no more than one question daily; passages no more than twice weekly. No notification permission dialog on first launch. Explain the value, show a sample, then request permission following a click. In-app inbox works without browser permission.

A passage may come from the person's own saved text or another author's public, eligible story they deliberately saved. Never use random private stories. Preserve exact wording and attribution, version/availability checks and a direct link. Offer a generic lock-screen message instead of exposing personal text. Respect deletions, revoked sharing and notification opt-outs.

Closed-app push requires a service worker, a protected backend scheduler, subscriptions, deduplication and platform support. A setTimeout in an open tab is not push. Unsupported or denied notification permission must leave a usable inbox. Do not claim reliable scheduled push until tested with the app closed on the intended devices.

## Illustrated film and a 2D memory scene

Shift art direction from synthetic historical photos to deliberately illustrated adaptations. Style presets: paper-cut miniatures, symmetrical pastel interiors, dark ink fairytale, pencil travel diary, warm hand-drawn animation. Describe each treatment through palette, texture, composition and lighting, with original characters and scenery.

First storyboard only 20–45 seconds: 3–5 approved beats, coherent character design, original narration, captions and sound only when supplied/approved. Label the result 'Illustrated adaptation'. Ordinary pans/dissolves over images are a motion comic, not fully animated video. More expressive movement can use separate foreground/background layers, parallax, gentle puppet motion and timed actions, built with deterministic animation and approved Muse-generated assets. Rendering can remain code; it is not itself an AI model.

A true video-generating model is an unresolved provider capability under the Muse-only requirement. Never promise it through Muse Image or SAM. Prototype a motion comic first and judge it before spending on more generations.

Game extension: adapt one memory into one 2D room, one meaningful interaction and a 2–3 minute playthrough. Muse Spark drafts a source-grounded scene graph; Muse Image supplies approved backgrounds/sprites; a normal game runtime plays it. Distinguish fictional branches from what actually happened. No whole-life procedural game or game model training in the first release. Do not create points or win/lose scores for a person's life.

## Sharing, editors and revenue

Start with private stories, an explicit shareable version, selected audience and separate source-audio visibility. Family sharing or a private book export can be useful without a marketplace. Public reading requires accounts, access control, moderation/reporting and deletion handling before real users are introduced.

Keep the core capture/reflection flow free as a product goal. Candidate revenue experiments: paid book assembly/export, optional human editing purchased by the narrator, and later publisher-request/licensing fees. Treat willingness to pay as a hypothesis to test; no revenue forecasts or automatic royalty promises.

Publisher/editor roles are a later separate workspace. A person can submit chosen excerpts or respond to a publisher's request; no blanket access to private archives. Reading access, editing, promotional use, training use and adaptation rights are separate permissions. Proposed commercial flow: preview → request → exact scope/format/term/payment proposal → agreement reviewed/accepted by the narrator → controlled handover → traceable payment. Do not promise that a completed rights sale is freely revocable. Contracts, payments, disputes and applicable law need their own design and professional review before transactions launch. Never train on a story merely because it was published or sold.

## Implementation phases and acceptance

0. Use the approved staged scope in muse-next.md. Preserve existing work; don't push, deploy, change settings, train models, enable notifications or make paid generation requests as a side effect of planning.
1. Reliability: fix the three review findings (stop/save navigation race; wrong-question transcript reuse; missing image download after restore), persistence failure paths and stale asynchronous callbacks. Prove reload/navigation with real IndexedDB in browser tests; Node fallback-only tests are insufficient.
2. Private experience: concrete home question, clear voice/text flow, memory library, exact resume position, readable scene with original audio. No live authoring copy written as generic marketing. Test on narrow/mobile widths.
3. Interview and editor roles: fictional eval set, baseline, source-linked proposed edits, narrator review. No paid end-to-end test until the project maintainer approves a bounded call plan.
4. Connect: isolate/reuse the verified Earth module, fictional demo, one finite arc sequence, up to two readable excerpts, coarse location and motion controls; no inference of a connection merely because two people have coordinates.
5. Rediscovery: saved passages and an in-app reminder inbox, then separately approved real push infrastructure and device testing.
6. Media experiment: compare one short motion-comic treatment with one layered illustration treatment; show an approved storyboard before paid image generation. Keep original narration. Judge if the result feels personal before expanding.
7. One 2D memory-room prototype; stop if it adds no value to remembering or sharing.
8. Real sharing, creator/editor profiles and a separately approved commercial-rights pilot. Do not let this delay a usable private product.

For every phase, report changed files, checks, real vs mocked integrations, known limitations and request counts. Do not mix a prototype with implemented product claims. The phase is complete only when a person can perform the intended human task, not just when unit tests pass.

## Implementation brief

Follow [the staged Muse task](muse-next.md). It defines the implementation scope and checkpoints and takes precedence over the original planning-only instructions. The interactive sketches illustrate the direction; do not copy their low-resolution preview texture as a production asset.

## Verified references

- Meta model catalogue: https://dev.meta.ai/docs/models
- Meta speech: https://dev.meta.ai/docs/speech-to-text
- Fireworks SFT capability (optional future investigation, not a provider change now): https://docs.fireworks.ai/fine-tuning/fine-tuning-models
- Browser Push API: https://developer.mozilla.org/en-US/docs/Web/API/Push_API
- Earth renderer and texture provenance: local master-dev-workshop/landing-page-example/README.md and LICENSE.
