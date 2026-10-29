# Voice requests are paused

All live Meta calls are currently locked in code while Witness uses local mocks. The configuration instructions below describe the retained adapter; an API key and environment flag alone cannot enable it. Recording, playback, and audio download remain available. See [AI flow](ai-flow.md).

# Voice answers

The interview composer offers recording alongside typing. Voice input is English-only for now.

## Flow

1. Choose **Record an answer** and allow microphone access.
2. Stop when ready, or let the two-minute limit stop the recording.
3. Listen, download the WAV, or discard it.
4. When Meta is configured, choose **Transcribe with Meta**.
5. Review and edit the transcript, then choose **Add to my answer**.
6. Continue the interview as with a typed answer.

Transcription appends to existing text; it does not submit the answer automatically. An API failure keeps the recording available for retry or download. Starting another recording requires saving or discarding the current one first.

## Recording

Web Audio captures mono samples in an AudioWorklet. The browser converts them to 24 kHz, 16-bit PCM WAV. A compatible WAV file can also be uploaded. Audio stays in browser memory; it is not stored in local storage or automatically uploaded. Download it before leaving if you want to keep it. Navigating away from the interview discards unsaved audio.

Microphone capture requires HTTPS or localhost and browser permission. Browser/device recording still needs a manual microphone check; no real audio was sent during development verification.

## Meta connection

The local Node server calls `POST https://api.meta.ai/v1/asr/transcribe` with a multipart `request` JSON part and an `audio` WAV part. Settings are `PUSH_TO_TALK`, `muse-voice-transcribe-1.0`, `WAV`, and `languageBias: ["English"]`.

The key comes from the server environment, never from the browser. Requests are disabled unless `META_TRANSCRIPTION_ENABLED=true` and `MODEL_API_KEY` is present. Configuration does not prove billing or model access; those must be checked in Meta. The API adapter has been tested with simulated responses, not a paid model call.

The local server limits uploads to 6 MB, validates WAV structure and duration, rejects cross-origin browser requests, and processes one transcription at a time. It does not save or log the audio. It returns a readable error for billing, key, model access, and rate-limit failures. Failed calls are not retried automatically.

The current private hosted Site is static. It supports recording and playback, but transcription stays disabled there until a protected hosted server endpoint and secret are added. Do not publish an unrestricted transcription endpoint using a shared API key.

[Meta speech-to-text documentation](https://dev.meta.ai/docs/speech-to-text)
