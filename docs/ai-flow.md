# Interview → event → video plan

Witness uses local mocks for all three steps. No Meta requests are sent, and no API key or payment method is needed to try them.

## The conversation

The mock interviewer chooses a follow-up from the answers: people, places, details, uncertainty, and what the experience means. It avoids question intents already answered or skipped. After three answers and at least 50 words, it suggests reviewing an event; the narrator can keep talking.

## The event

**A second look → Build an event from my answers** collects a title, summary, date, place, people, and themes. Missing dates and places stay blank. Approximate dates stay approximate. The mock summary uses the first answer; it is a draft to edit, not a full model summary.

The narrator edits and confirms the event. Answer IDs and revisions link it to the interview. A new or changed answer makes the event need review again. Rebuilding replaces event edits only after confirmation.

## The video proposal

A confirmed event with enough interview material opens **Plan a video interview**. Choose a fictional interviewer, setting, and tone, then create a storyboard. Scenes contain original interview questions, excerpts from actual answers, visual directions, and source links. Download the plan as JSON.

This is a storyboard, not video generation. Changes to the event or answers mark earlier plans for review. Existing plans keep their original source snapshots until explicitly replaced.

## Meta adapter

`server/ai/meta.mjs` prepares Muse Spark 1.3 chat completion requests for interviewing, event extraction, and video planning. Each task has a system prompt, a JSON output schema, and source validation. Keys belong on the server.

The adapter has a code-level `META_NETWORK_ENABLED=false` guard. An environment variable or API key cannot turn it on. Speech transcription is also paused. Tests inject fake transports only; they make no real model calls.

The browser's `web/ai-client.js` uses the local mock provider directly, including on the hosted static Site. The Node server also exposes mock-only endpoints:

- `GET /api/ai-status`
- `POST /api/ai/interview`
- `POST /api/ai/event`
- `POST /api/ai/video`

Preparing requests is not a live Meta integration. Before live use, deliberately unlock the server adapter, connect the client to server routes, configure a server-only key, verify model access and billing, and add user-visible request status and error recovery. The static Site needs a hosted server route before it can make live calls. No automatic paid fallback is configured.

Request format: [Meta quickstart](https://dev.meta.ai/docs/quickstart), [structured output](https://dev.meta.ai/docs/structured-output).
