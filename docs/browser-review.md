# Browser rehearsal

Use a separate local origin and fictional data for rehearsal. Keep existing personal browser stories untouched. A static copy with simulated API responses can exercise the interface without spending model credits; it must visibly identify itself as a simulation.

## A short demo

1. Start a conversation about a first job on a small house-building site. Record or upload a short English WAV. Listen, transcribe, check the text, then add it to the answer.
2. Keep an uncertain date (“around 2019”). Answer a follow-up about the foreman teaching you to read a level and one small detail you remember.
3. Review the answers. Find distinct events, keep the proposed event, then **Review event →**. Inspect its sources, correct the title/location if needed, and confirm it.
4. Assemble a story. Ask for a wording suggestion, review it, then accept or keep your wording. Open a source to show that the original answer remains separate.
5. Draft a weekly story from the selected entries. Check its paragraph sources and accept it. The entries and event collection remain separate.
6. Open Connect. Choose the confirmed event: Leeds is the origin, and construction-related fictional stories in Ireland, Poland and Leeds appear. The bakery story is excluded. An approximate date and broad resemblance do not establish the same occasion.
7. If one confirmed event covers the conversation, open Film and create its storyboard. Scene illustration still requires approval and a separate image-generation action. Do not present the local storyboard or illustrated film as moving-video generation by Muse.
8. Reload and reopen the audio/story. After offline setup, stop the isolated static server and reopen the app to check its cached shell and saved library. Restart, prepare a new build, and use **Reload to update** to verify that saved answers remain.

## What the browser check established

A synthetic fictional spoken WAV was loaded through the real upload handler, saved in IndexedDB and restored. Simulated transcription was reviewed and added to the first answer. The browser continued the interview, kept an approximate date, grouped an event, accepted the narrator's confirmation, opened it in Connect, accepted an editor proposal, inspected its original source, and saved a sourced weekly story. A 390px iframe was used for responsive layout checks; it is not an actual phone installation test.

The rehearsal exposed two broken handoffs: editor bindings received answer objects instead of source references, and collection events lacked a confirmation path. Those now have regression coverage. A stale-tab save guard also prevents an older browser snapshot from replacing data already saved by another tab. Whole-conversation collection confirmation also records the source confirmation required by the storyboard contract.

This browser rehearsal uses simulated API output. Separate live evaluation results are documented in [Agent evaluation](agent-evaluation.md). It does not prove Meta speech recognition accuracy or real microphone input. Use a real microphone and a separately authorised, bounded live test before claiming those.
