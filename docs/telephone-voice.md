# Telephone voice

An optional vintage listening effect for playable audio: interview recording
playback, story recording playback, and narration in an explicitly selected
film export.

## Effect

`web/telephone.js` implements one shared specification (`TELEPHONE_SPEC`):

- High-pass at 300 Hz and low-pass at 3400 Hz (12 dB/octave each).
- Gentle compression (threshold −20 dB, ratio 3:1).
- Very subtle saturation (normalised tanh, drive 1.5).
- Fixed makeup gain with a safety limiter so peaks never clip.

No hiss, crackling, ringing, or added sounds: the chain only filters and
gently shapes the existing signal. Two implementations share the spec: native
Web Audio nodes for live playback/export, and a dependency-free reference DSP
(`applyTelephoneEffect`) that the test suite runs against generated fixtures.

## Rules

- Natural is the default everywhere. Telephone changes playback only, or is
  baked into one film export when its checkbox is ticked.
- Original recordings, transcripts, and downloads are never modified.
- Microphone capture is never processed. Transcription always uses the
  original recording.
- If the browser cannot build the effect, playback stays natural and the
  export status says so honestly.

## Limitation: spoken questions

Question read-aloud uses installed device voices through `speechSynthesis`,
which exposes no audio signal to route through Web Audio filters. Telephone
voice therefore cannot apply to live spoken questions, and no pitch, rate, or
voice change is presented as the effect.

A future audio-producing question voice would plug in here: a server route
returning WAV (for example `POST /api/speak`, text in, audio out) played
through the same telephone chain and the same Natural/Telephone control. No
Meta text-to-speech capability is documented at dev.meta.ai (the Model API
serves text, image, and speech-to-text only), so this integration is not
implemented and no other provider is added without approval.
