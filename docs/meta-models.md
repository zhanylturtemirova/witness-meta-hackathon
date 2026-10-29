# Models and their roles

The text experience is designed around one main model. Other models are options for specific extensions, rather than requirements for every interview.

| Model | Role in Witness | Scope |
| --- | --- | --- |
| **Muse Spark 1.3** (`muse-spark-1.3`) | Ask contextual questions, follow up on details, suggest points to clarify, and draft stories from reviewed answers | Planned core model |
| **Muse Wonder** (`muse-wonder-1.0`) | Explore whether a separate review step can better catch unsupported details in a draft | Optional experiment |
| **Muse Voice Transcribe** (`muse-voice-transcribe-1.0`) | Turn spoken memories into text for the narrator to review | Future voice input |
| **Muse Image** (`muse-image-1.0`) | Explore visual concepts for a fictional interviewer and interview setting | Future visual exploration |

[Muse Code](https://dev.meta.ai/docs/muse-code) is also an optional development assistant. It is separate from the AI that interviews the narrator.

## Interview and story generation

Muse Spark would receive the relevant answers with stable IDs and version numbers. It would suggest a next question or a detail worth clarifying, then draft passages linked to the answers they draw from.

The application should check that those source IDs exist and let the narrator open each source beside the draft. A valid link alone does not prove that the passage is faithful to the answer; the narrator still needs to review it.

The model should preserve phrases such as “around that time” or “I don't remember exactly.” It should not fill gaps with invented events, names, or quotes.

## What the application handles

Saving and versioning answers, editing, source links, access controls, and export belong in application code. When an answer changes, related passages should be marked for review. Failed requests should leave the original material intact.

API calls should run on the server. Standard mode is the intended choice for personal stories; provider data handling needs review before real interviews. Development and demos use fictional stories.

## Voice, visuals, and discovery

Muse Voice Transcribe returns text, not synthetic speech. Muse Image produces images, not a finished video interview. Video generation and voice synthesis need a separate technical choice.

For future story discovery, model and search choices remain open. Matching should use only stories or topics people explicitly choose to share, not their private interviews.

## What to check

Try fictional stories with vague dates, conflicting details, and corrected answers. Check whether follow-ups are useful, drafts preserve the narrator's meaning, and source links remain correct after edits. Compare models only when there is a specific quality problem to solve.

Model capabilities and identifiers: [Meta model documentation](https://dev.meta.ai/docs/models).

For video interviews, a game, a mini-series, and a globe of shared experiences, see [Future features](future-features.md). The current browser demo makes no model calls.
