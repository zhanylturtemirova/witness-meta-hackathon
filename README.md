# Witness

A space to preserve your memories, turn them into stories and films, and find people who have lived through something similar.

An AI interviewer follows the conversation, asks thoughtful questions, and helps turn scattered memories into stories that still sound like you — without needing to be a writer or knowing how to tell your story from the start. You choose what stays private and what you want to share.

## The idea

Memories fade unless they are kept. Witness exists to preserve personal memories and life events, and to bring together people connected by similar experiences — whether they shared one occasion or simply recognise themselves in each other across time and distance.

Everyone deserves to be heard. Behind the app is a simple belief: every person's story matters and deserves to be captured. And lived experience is global — discovering that others felt what you felt reminds us how much we share.

## What Witness is for

- **Keeping memories:** record turning points, relationships, places, and everyday moments in an ongoing journal, so they are not lost.
- **Being heard:** shape an experience into a story — or an illustrated film made from your own words — to share with family, friends, or a wider audience.
- **Finding each other:** discover people through experiences they choose to share — moving to a new country, starting over, or even being at the same concert.

A complete autobiography is one possible outcome. A single meaningful story can be enough.

Witness is also designed as an ongoing journal: optional questions help people record everyday life. Selected entries from a conversation can become an editable weekly story, with sources for each paragraph. Daily/monthly stories and real-user matching remain planned. Specific events stay in their own collection. Connect is intended to start from one of those events and reveal related stories across the globe, whether people attended the same occasion or had a similar experience in another place and time. [Journal and Connect](docs/journal-and-connect.md) describes the flow.

## The first experience

Choose a memory or a period of your life. Answer a few questions, follow the details that matter, and skip anything you do not want to discuss. Witness offers an optional new reflection prompt every three answers: déjà vu, a happy memory, finding your calling, and other threads. Use **Ask me something** whenever you need a starting point. Explore it in the current conversation or begin a separate story. Review your answers, then turn them into an editable story with links back to what you said.

The first build focuses on this interview-to-story flow. Connect previews a globe of shared experiences using fictional stories. The wider vision includes real opt-in discovery, custom video interviews, a game through a life, and a mini-series shaped from the narrator’s memories.

## AI behind Witness

| Model | What it does in Witness |
| --- | --- |
| **Muse Spark 1.3** (`muse-spark-1.3`) | Asks contextual interview questions, structures answers into life events, and plans illustrated-film storyboards |
| **Muse Voice Transcribe** (`muse-voice-transcribe-1.0`) | Turns recorded answers into editable text for the narrator to review |
| **Muse Image** (`muse-image-1.0`) | Illustrates approved scenes for the memory film, one image at a time |
| **Muse Wonder** (`muse-wonder-1.0`) | Optional experiment: a separate review step to catch unsupported details |

The app uses local mocks by default and makes no model calls until live requests are deliberately enabled on the local server. See [Models and their roles](docs/meta-models.md) for the details.

The interviewer, archivist, editor and verifier are configured in [agents/](agents/README.md). The server uses these role files directly; they share Muse Spark with separate instructions.

Run `npm run eval:agents` to rehearse the roles on fictional interviews without network calls. [Agent evaluation](docs/agent-evaluation.md) explains the report, human review and a separately enabled live check with a call budget.

## Memory films

An approved story can become an illustrated film: each scene gets a Muse Image illustration (or your own picture), and the app exports a downloadable video with gentle camera movement, transitions, and subtitles in your own words, plus optional recorded narration. Every image names the model that created it.

## On your phone

Witness installs as an app (PWA) and keeps working offline: saved stories stay readable, and writing and recording stay available without a connection. [Installation and offline behaviour](docs/pwa.md).

Optional reminders can nudge you back to the conversation — a saved phrase resurfacing, or a new question inviting you to start or continue reflecting. Reminders need a signed-in account and server setup, and stay off unless you enable them. [Push setup](docs/push-setup.md).

## Saved lines

Phrases worth keeping don't have to stay buried in stories. Save exact words from your own stories or from stories shared with you; liked stories are kept too. Everything saved stays on your device unless you explicitly choose otherwise.

## Try it locally

You need Node.js 22 or later (package.json `engines` requires >=22.0.0). Run `npm install` first: the build vendors the official Supabase Auth SDK into a local bundle (loaded only on explicit Account action).

```bash
npm run dev
```

Open `http://127.0.0.1:4173`. Answer the question for today, continue an unfinished conversation, or try a fictional example.

My space opens on a quiet desk scene with one optional question (**Record a moment** / **Write instead**, **Another question**, **Not now**) and a single shelf holding every story with its exact resume place, event confirmation status, and original recordings. Fictional examples are labelled; a quiet entry point tries one. Provenance details (local preview vs live Meta model) live under “About” disclosures.

The demo includes a contextual interview, editable life events, confirmation, video storyboard planning, illustrated memory films, and stories with passage-level sources and Markdown export. Mocks are the default and make no model calls; live interview/event requests are disabled by default. Stories, recordings, and scene images stay saved in this browser until discarded.

Try **fictional example → Review → Build an event from my answers → Confirm this event → Preview the script**. Choose the interviewer, setting, and tone, then create a storyboard. Review it, approve each scene excerpt, add an image for each scene and optional narration, and choose **Create film** to export a video with slow camera movement, dissolves, and subtitles. Choose **Generate scene with Meta** for each approved scene, or upload your own image. Each click requests one image using the configured Meta account, and each result names its model. Generated images stay saved with the story. [How the AI flow works](docs/ai-flow.md).

When a source answer changes after a story is shaped, the affected passage offers the update as an explicit proposal: **Use updated answer** or **Keep my wording**. Nothing is replaced without the narrator’s choice.

```bash
npm test
npm run build
```

The build writes the static app and offline shell to `dist/`. Witness can be installed as a PWA; saved stories and local writing/recording remain available offline after setup. Meta tools need a connection. [Installation and offline behaviour](docs/pwa.md).

## Connect

Open **Connect** from the sidebar to explore a globe of shared experiences. Choose one of your confirmed events or a fictional example to see related stories connect across a textured Earth. Drag to rotate, locate a story on the map, or open a marker to read it.

Your event stays private; the community profiles are fictional. Preview matching uses explicit topics and evidence. It needs no AI credits or map key. [How Connect works](docs/connect.md).

## Voice answers

Record up to two minutes in English, listen, and download the audio. Recording and playback work without credentials. Live interview and event requests need `MODEL_API_KEY` plus `META_AI_ENABLED=true` in the server `.env`; anything else stays on mocks. Image generation uses the same live server configuration; set `META_IMAGE_ENABLED=false` to disable it separately. Transcription needs `MODEL_API_KEY` plus `META_TRANSCRIPTION_ENABLED=true`, and names its model on success.

The static Site supports local recording but needs a hosted server route before live transcription can be enabled there.

See [Voice answers](docs/voice-answers.md) for the implementation and limits.

## Explore

- [Future formats and the globe](docs/future-features.md)

- [Product vision](docs/background/product.md)
- [First build](docs/hackathon-scope.md)
- [Technical outline](docs/background/technical-outline.md)
- [Stories, privacy, and control](docs/background/data-and-consent.md)

## Work with Muse Code

With Muse Code installed, put your Meta API key in the untracked `.env` as `MODEL_API_KEY`, then run:

```bash
npm run muse
```

The launcher opens Muse Code in this project and passes the key through the process environment as `META_API_KEY`. It does not print or store another copy of the key. Muse Code requests use Meta billing; starting it does not enable live model calls in the Witness app.
