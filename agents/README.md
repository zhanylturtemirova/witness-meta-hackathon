# Witness agents

These are the role configurations used by the Meta API adapter. Each file defines
the model and instructions for a role. They share Muse Spark; they are not
separately trained models or background processes.

| Role | Configuration | What it does |
| --- | --- | --- |
| Interviewer | [interviewer.mjs](interviewer.mjs) | Asks one contextual question and respects corrections, skips and refusals. |
| Archivist | [archivist.mjs](archivist.mjs) | Groups answers into distinct events, then drafts each event with its sources and uncertainty. |
| Editor | [editor.mjs](editor.mjs) | Suggests wording for a passage. The narrator accepts or rejects it. |
| Verifier | [verifier.mjs](verifier.mjs) | Checks event drafts and proposed wording against the source answers. |

[index.mjs](index.mjs) maps API tasks to these roles.
[The Meta adapter](../server/ai/meta.mjs) reads the selected configuration when
building a request. Changing a role's instructions here changes the server's
next requests after restart; there is no second copy of these prompts in the adapter.

## How the roles work together

An answer goes to the interviewer for a follow-up. In review, the archivist can
group answers and draft events; the verifier checks each draft within the
existing attempt and time limits. In the story, the editor proposes wording and
the verifier checks it before the narrator decides whether to use it.

The application controls when each role runs. Source validation, storage,
approval, cancellation and request budgets are application responsibilities:

- [API routes](../server/ai/routes.mjs) select the server operation.
- [Contracts](../web/ai-contracts.js) define and validate structured results.
- [Verification loop](../web/event-verify.js) bounds drafting and checking.
- [Archivist workflow](../web/archivist.js) coordinates event groups.
- [Role evaluation cases](../tests/eval-roles.test.js) exercise local mocks.
- [Interview fixtures](../web/demo-fixtures.js) supply fictional test material.

## Enforced limits

Application code owns every budget; these files supply instructions only.

- Verified drafting (event, editor): at most 2 candidates and 2 verifier
  calls per operation, inside a 120-second overall deadline that also
  aborts hung calls. An aborted request cancels the run end to end: the
  server forwards its signal into every live text task, no further model
  call starts, and late results are discarded, never accepted.
  ([event-verify.js](../web/event-verify.js); live runs execute on the
  server in [routes.mjs](../server/ai/routes.mjs)).
- Archivist extraction: at most 4 groups and 17 calls per run (1 grouping
  plus up to 4 drafts of at most 2 generations and 2 verifier calls each),
  inside one shared 120-second deadline covering grouping, drafting,
  verification, and repairs, including in-flight calls. Each transport
  receives the remaining time and a cancellation signal; no new call
  starts after cancellation, source changes, or budget exhaustion, and
  partial runs report completed/total counts.
  ([archivist.js](../web/archivist.js)).
- Single model calls: 60 seconds upstream
  ([meta.mjs](../server/ai/meta.mjs)); the browser caps interview and
  grouping requests at 65 seconds by default and verified loops at the
  remaining shared time ([ai-client.js](../web/ai-client.js)).
- One live AI request at a time on the server, localhost-only routes, and
  no automatic retries of billing, key, permission, or rate-limit
  failures. ([routes.mjs](../server/ai/routes.mjs)).

## Running and improving them

Run Witness from the project root with `npm run dev`. The existing server
configuration determines whether requests use Meta or mocks. No role runs just
because its file exists. `npm run muse` opens the coding assistant; it does not
start a separate interviewer session.

Improve a role by changing its instructions, checking fictional examples and
reviewing its mistakes. Mock tests check application behaviour; real model
quality needs a separate bounded live evaluation. These configurations do not
claim that weights have been trained or that quality has been validated live.

The editor also drafts weekly stories from selected entries, with the same
bounded verification and narrator review. Monthly story generation, discovery
matching and a live art-director workflow remain later work. Video storyboard planning still uses local mocks;
the existing Muse Image integration generates approved scene illustrations.

The root [AGENTS.md](../AGENTS.md) contains development instructions for coding
assistants. This directory contains the product's runtime role configurations.

Use [the evaluation runner](../docs/agent-evaluation.md) to check fictional
interviews through these roles. Offline rehearsal and live model quality are
reported separately.
