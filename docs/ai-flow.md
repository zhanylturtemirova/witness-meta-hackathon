# Interview → event → video plan

Witness uses local mocks by default. The local server can use live Meta models for interview questions, event drafts, scene illustrations, and voice transcription when deliberately enabled. Video storyboards stay mock-only.

## The conversation

The mock interviewer chooses a follow-up from the answers: people, places, details, uncertainty, and what the experience means. It avoids question intents already answered or skipped. After three answers and at least 50 words, it suggests reviewing an event; the narrator can keep talking.

Live questions use the same input contract and source validation. While a request runs, the composer shows a pending state and blocks double submits. A failed live request shows the error and offers Retry or Continue with mock; it never switches providers silently. Late results are ignored after edits, navigation, or a newer request, and retrying never adds the same answer twice. The subtitle under Witness names the origin of the shown question: live questions include the model, mock questions say so.

## The event

**A second look → Build an event from my answers** collects a title, summary, date, place, people, and themes. Missing dates and places stay blank. Approximate dates stay approximate. The mock summary uses the first answer; it is a draft to edit, not a full model summary.

Live drafts follow the same rules. Existing event edits stay in place until a valid replacement arrives; an answer or event change during generation discards the late result. The narrator edits and confirms the event. Answer IDs and revisions link it to the interview. A new or changed answer makes the event need review again. Rebuilding replaces event edits only after confirmation. Unsaved review edits are kept as drafts and restored after each re-render; Save answer applies them. The event tag names the origin of the current draft. Every draft is checked before it can be accepted: a separate verification step confirms each claim against the answers, with at most one repair and two drafts per attempt. An unresolved draft is shown separately with its issues and never replaces the saved event; only a verified draft can be saved, and its checked label stays only while the content and sources are unchanged. Narrator confirmation remains a separate, explicit step.

## The video proposal

A confirmed event with enough interview material opens **Preview the script**. Choose a fictional interviewer, setting, and tone, then create a storyboard. Scenes contain original interview questions, excerpts from actual answers, visual directions, and source links. Download the plan as JSON.

Storyboard planning uses local mocks. Changes to the event or answers mark earlier plans for review. Existing plans keep their original source snapshots until explicitly replaced.

After reviewing a current storyboard, add an image for each scene and choose **Create film**. The browser records a 1280 × 720 illustrated memory: full-frame images, slow camera movement, scene dissolves, and subtitles taken verbatim from the narrator's answers. **Preview motion** plays the composition before export. Images illustrate the story; they are not evidence of the event. Use **Generate scene with Meta** to create an illustration from an approved scene excerpt, with optional visual directions. Each generated image names its model; uploaded images are labelled separately.

An optional narration recording stays on the device. Without narration the film is silent; audio starts at the beginning and is not aligned automatically to individual subtitles. Host, setting, and mood remain storyboard directions, not rendered characters or scenery.

Export runs in real time, with a three-minute limit and a choice of 3, 5, or 8 seconds per subtitle. Export prefers a supported H.264/MP4 recording format for playback compatibility, with WebM as a fallback. The player includes a still-frame poster; if a WebM preview is blank in an embedded browser, open the downloaded file in a video player. Play the result and download it before leaving the page: uploaded images, audio, and media previews are temporary. Film export itself needs no API key and makes no external requests. Image generation is a separate, billable Meta API operation. Generated images can be downloaded individually before leaving the page.

## Invitations to remember

Witness offers a question at the start and after every three saved answers. These are optional invitations, separate from the current interview question: the narrator can explore one here, start a separate story, choose another, dismiss it, or disable suggestions. **Ask me something** opens the remaining questions on demand. Prompts already chosen are not repeated within that story. A profession is mentioned only if the narrator stated it (for example, “I became a teacher”).

Switching a question in the current conversation is blocked while an answer draft exists. Starting a separate story preserves that draft. The selected prompt is saved as the exact question on its eventual answer. Prompt selection uses local curated questions and makes no model call; subsequent live follow-ups receive the new question and answer as context. These are in-app suggestions, not background notifications.

## Live requests

`server/ai/meta.mjs` prepares Muse Spark 1.3 chat completion requests for interviewing and event extraction. Each task has a system prompt, a JSON output schema, and source validation. Keys belong on the server.

Live text is unlocked in code and additionally needs server environment: `META_AI_ENABLED=true` plus `MODEL_API_KEY`, so mocks stay the default. It does not enable transcription (`META_TRANSCRIPTION_ENABLED`) or video requests. Tests use injected fake transports only and make no live calls.

The browser checks `GET /api/ai-status` before automatic requests. A missing endpoint or mock status uses local mocks automatically. A failed `POST /api/ai/interview` or `/api/ai/event` requires an explicit Retry or Continue with mock choice.

Limits: up to 60 answers and 100,000 characters per request, 150 KB request bodies, one live AI request at a time, localhost-only API routes in local development, a 60-second per-request upstream timeout, and a 120-second overall deadline for verified event generation (the browser waits up to 130 seconds for event drafts). Billing, key, access, and rate-limit failures return readable errors; answers stay saved and are never retried automatically.

`npm run dev` serves the app with `/api/` on `127.0.0.1`. The static `dist/` Site has no backend and stays on mocks. A hosted live backend with its own secret store and limits is future work.

Request format: [Meta quickstart](https://dev.meta.ai/docs/quickstart), [structured output](https://dev.meta.ai/docs/structured-output).

## Meta scene images

`POST /api/ai/image` uses `muse-image-1.0` through Meta's `POST /v1/images/generations`, with `n=1`, PNG/base64 output, landscape aspect ratio, and web/image search and shell tools disabled. The server requires `META_AI_ENABLED=true` and `MODEL_API_KEY`; `META_IMAGE_ENABLED=false` disables image generation separately. No request runs just by opening the page.

The server checks event confirmation, source revisions, and that the scene quotes a source answer before sending only the selected scene excerpt and optional visual directions to Meta. Each click makes at most one upstream request, with a two-minute timeout and no automatic retry. Images share the AI request concurrency guard. Provider errors leave the current scene intact; navigation cancels the browser request and aborts the upstream connection, although provider processing or billing may still complete.

Results are checked for size and PNG format, then shown with their provider and model. Replacing an image clears film approval. Images are imagined reconstructions, not verified evidence of what happened. They remain in memory until downloaded, replaced, or the page is left; they are not written to the repository or local storage.

API contract: [Meta image-generation documentation](https://dev.meta.ai/docs/image-generation).
