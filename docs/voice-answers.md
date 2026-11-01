# Voice answers

The interview composer offers recording alongside typing. Voice input is English-only for now.

## Hear the questions

Enable **Read questions aloud** below the current question. Choose an installed English voice and a speed, use **Read again** to repeat the question, or **Stop** to silence it. Once enabled in this session, new questions are read as they arrive. Reloading the page requires a new click to start speech, even if the preference was saved.

Read-aloud stops before opening the microphone, during recorded-audio playback, when leaving the interview, or when hiding the tab. Waiting questions are not read, and redrawing the screen does not repeat a question. The controls stay unavailable while recording or transcribing. Text input and recording still work when the browser has no installed English voice.

This is browser/device speech synthesis, separate from Muse. Only voices reported as local by the browser are offered; Witness makes no TTS API request and stores only the enabled preference, voice identifier and speed. Meta still supplies live interview questions and transcription when configured. See the [browser speech API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis).

## Flow

1. Choose **Record an answer** and allow microphone access.
2. Stop when ready, or let the two-minute limit stop the recording.
3. Listen, download the WAV, or discard it.
4. When Meta is configured, choose **Transcribe with Meta**.
5. Review and edit the transcript, then choose **Add to my answer**.
6. Continue the interview as with a typed answer.

Transcription appends to existing text; it does not submit the answer automatically. Finished recordings are saved with the story automatically. Each recording stays bound to the project and question that were open when it started, using a stable question ID rather than its wording, so repeated questions cannot misattach a transcript or open the wrong answer. If the interview has moved on, adding its transcript needs an explicit second click for that destination, with an option to open the original answer in review instead. An API failure keeps the recording, transcript edits, and typed draft available for retry.

## Recording

Web Audio captures mono samples in an AudioWorklet. The browser converts them to 24 kHz, 16-bit PCM WAV. A compatible WAV file can also be uploaded. Audio bytes are kept in browser media storage with the story, with recording metadata in local storage; nothing is uploaded automatically. Recordings and transcript edits survive navigation and reload, and are removed only with Discard or story deletion. If media storage is unavailable, the interview says so and recordings last until reload.

Microphone capture requires HTTPS or localhost and browser permission. Browser/device recording still needs a manual microphone check.

## Meta connection

The local Node server calls `POST https://api.meta.ai/v1/asr/transcribe` with a multipart `request` JSON part and an `audio` WAV part. Settings are `PUSH_TO_TALK`, `muse-voice-transcribe-1.0`, `WAV`, and `languageBias: ["English"]`.

The key comes from the server environment, never from the browser. Requests are disabled unless `META_TRANSCRIPTION_ENABLED=true` and `MODEL_API_KEY` are present. If `/api/speech-status` reports `configured: false`, one of those two settings is missing; set both in the server `.env` and restart. Configuration does not prove billing or model access; those must be checked in Meta. A successful transcript names its model in the interview; a local-only recording is labelled as not yet sent.

The local server limits uploads to 6 MB, validates WAV structure and duration, rejects cross-origin browser requests, and processes one transcription at a time. It does not save or log the audio. It returns a readable error for billing, key, model access, and rate-limit failures. Failed calls are not retried automatically.

The current private hosted Site is static. It supports recording and playback, but transcription stays disabled there until a protected hosted server endpoint and secret are added. Do not publish an unrestricted transcription endpoint using a shared API key.

[Meta speech-to-text documentation](https://dev.meta.ai/docs/speech-to-text)
