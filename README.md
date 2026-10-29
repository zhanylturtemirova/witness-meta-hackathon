# Witness

A space to look back on your life, tell the stories that matter to you, and find people who have lived through something similar.

Some memories help us understand who we are. Others deserve to be heard beyond our closest circle. Witness is designed to help people explore both — without needing to be a writer or knowing how to tell their story from the start.

An AI interviewer follows the conversation, asks thoughtful questions, and helps turn scattered memories into stories that still sound like you. You choose what stays private and what you want to share.

## What Witness is for

- **Looking back:** revisit turning points, relationships, places, and everyday moments to build your own retrospective of your life.
- **Being heard:** shape an experience into a story you can share with family, friends, or a wider audience.
- **Finding each other:** discover people through experiences they choose to share — moving to a new country, starting over, or even being at the same concert.

A complete autobiography is one possible outcome. A single meaningful story can be enough.

## The first experience

Choose a memory or a period of your life. Answer a few questions, follow the details that matter, and skip anything you do not want to discuss. Review your answers, then turn them into an editable story with links back to what you said.

The first build focuses on this interview-to-story flow. Connect previews a globe of shared experiences using fictional stories. The wider vision includes real opt-in discovery, custom video interviews, a game through a life, and a mini-series shaped from the narrator’s memories.

## AI behind Witness

The plan is to use **Meta Muse Spark 1.3** for contextual interview questions, follow-ups, and story drafts based on the narrator's answers.

Later, **Muse Voice Transcribe** could turn spoken memories into text, and **Muse Image** could help explore the look of a virtual interviewer and interview setting. These are optional extensions to the text experience.

See [Models and their roles](docs/meta-models.md) for the details.

## Try it locally

You need Node.js 20.12 or later. There are no package dependencies to install.

```bash
npm run dev
```

Open `http://127.0.0.1:4173`. Use **Explore an example** for a fictional concert memory, or start a story of your own.

The browser demo includes an interview, saved answers, review, an editable story, passage-level sources, and Markdown export. It uses prepared questions with a few rule-based follow-ups and assembles the actual answers. The interview and story writing are still in demo mode. Voice recording, playback, WAV download, and a local-server adapter for Meta speech transcription are also available. Stories stay in this browser’s local storage. Recordings stay in memory until downloaded or discarded; they are not saved automatically.

```bash
npm test
npm run build
```

The build writes the static app to `dist/`.

## Connect

Open **Connect** from the sidebar to explore a globe of shared experiences. Choose an event from the fictional timeline to see matching stories light up and connect across the globe. Drag to rotate, locate a story on the map, or open a marker to read it.

The preview uses fictional profiles and explicit event categories. It needs no AI credits or map key. [How Connect works](docs/connect.md).

## Voice answers

Record up to two minutes in English, listen, then choose whether to transcribe. The recording is only sent to Meta when you click **Transcribe with Meta**. Check and edit the transcript before adding it to your answer.

Recording, playback, and audio download work without Meta credentials. Transcription needs a server API key, model access, and Meta billing. It is disabled until configured.

For local development, copy `.env.example` to `.env`, enter your own `MODEL_API_KEY`, and set `META_TRANSCRIPTION_ENABLED=true` after checking billing. Restart `npm run dev`. Keep `.env` untracked.

The Node server handles `/api/speech-status` and `/api/transcribe`. The private static Site supports local recording but does not run the Node transcription endpoint. A hosted server route and server secret are needed before enabling transcription there.

See [Voice answers](docs/voice-answers.md) for the implementation and limits.

## Explore

- [Future formats and the globe](docs/future-features.md)

- [Product vision](docs/background/product.md)
- [First build](docs/hackathon-scope.md)
- [Technical outline](docs/background/technical-outline.md)
- [Stories, privacy, and control](docs/background/data-and-consent.md)
