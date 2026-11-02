# Checking the Muse agents

The evaluation runner uses the same role registry, Meta adapter, structured
contracts and bounded verifier as Witness. It does not introduce another AI
provider. All evaluation interviews are fictional.

## Offline rehearsal

```bash
npm run eval:agents
```

This exercises eight development interviews through the interviewer, archivist,
event drafting and verified editor flow. Four held-out interviews remain outside
the default run. It uses local mocks, makes no network requests and does not load
API credentials. Outputs go to the ignored `exports/agent-evaluation.json`.

Read the generated questions, event drafts and wording proposals next to each
case's expected facts, unknowns and prohibited inventions. A successful mock run
shows that the evaluation workflow works; it does not measure Muse's quality.

## First live check

The prepared first case is `FW-01`: the first summer working for a small
house-building company, with an uncertain year, a foreman and a garden fence.
Review these outcomes:

- Interviewer: one relevant follow-up, without inventing a company or town.
- Archivist: source-linked groups that distinguish an occasion from a detail.
- Event draft: preserve the uncertain year and leave the missing town unknown.
- Editor: retain the narrator's phrases and meaning, proposing rather than
  replacing their answer.
- Verifier: inspect both event and wording drafts against the supplied answers.

The normal path uses six upstream calls: one interview, one grouping, two event
draft/check calls and two editor/check calls. Repairs share the same call budget;
if it runs out, the report marks the case incomplete instead of claiming success.

After the owner approves this bounded live run:

```bash
npm run eval:agents -- --live --allow-paid-api --case FW-01 --max-calls 6 --timeout-ms 180000 --output exports/agent-evaluation-live.json
```

Live mode requires all three explicit arguments: `--live`, `--allow-paid-api`
and `--max-calls`, plus one fictional case ID. Only live mode loads the existing
server `.env`. The runner never prints keys or headers. It counts actual outgoing
requests, aborts at the shared deadline and makes no HTTP retries. This is a
separate explicit evaluation, not a change to the app's live configuration.

The report stores the model verdict and leaves human review required. Check
question usefulness, repetition, assumptions, source fidelity and preserved
uncertainty yourself. Do not report a semantic accuracy percentage from schema
checks or the model's own verification alone.

## Voice check

Use a short English WAV recording of the fictional first-job passage from
[the demo script](demo-script.md). Upload it through the interview screen,
listen, transcribe with Muse Voice Transcribe and review the text before adding
it. Follow with the Muse interview and event review flow.

Audio upload, local playback and persistence can be rehearsed without credits.
Actual transcription requires its own approved live call. A silent WAV fixture
tests storage only; it does not test speech recognition. Device read-aloud is
separate from Muse transcription. A physical microphone and a real phone still
need a person to test recording, permission prompts and background behaviour.

## First live observations

The `FW-01` run used Muse Spark 1.3, six real requests and 84.7 seconds.
The source interview was fictional. The run stopped at its call cap; no
additional calls were made to complete the editor step.

| Step | Observed result |
| --- | --- |
| Interviewer | Asked about finishing the fence and cited the relevant answers. The wording assumed that it affected a later action. |
| Archivist | Grouped all four answers into one work experience with valid references. Its label presented the tentative year as definite. |
| Event and verifier | The event passed on the second candidate. The final text retained the uncertainty, left the place unknown and preserved Ray and the work details. The report does not retain the first rejected candidate, so its exact issue cannot be reconstructed. |
| Editor and verifier | Not executed: the event repair consumed the remaining call budget. |

The interviewer instructions now explicitly avoid presupposing consequences.
The archivist instructions now preserve uncertainty in labels as well as full
drafts. Those changes passed offline checks but have not been retested live.
This is one source comparison by the coding assistant, not a human evaluation
or a broad accuracy result. The raw report remains under ignored `exports/`.

## Live voice and editor check

A separate bounded run used three real requests in 13.9 seconds: Muse Voice
Transcribe → Muse Spark editor → Muse Spark verifier. It used a synthetic
English WAV containing a fictional first-job memory, through the existing
speech handler and text adapter. No app configuration or user stories changed.

The transcript retained “around 2019” and uncertainty about the starting month.
It contained a repeated “company” and doubled final punctuation. The editor
removed those artifacts while retaining the work details and uncertainty, with
an exact source ID and revision. The verifier accepted the first proposal with
no issues. No repair or additional request was made.

This checks one synthetic recording and one editor proposal; it does not
establish microphone capture, performance on other accents, a transcription
accuracy score, or broad editorial quality. The verifier verdict is a model
assessment. The raw fictional report remains in ignored
`exports/live-voice-editor-2026-11-02.json`.
