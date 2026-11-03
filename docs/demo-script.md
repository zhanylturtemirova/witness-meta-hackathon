# Demo script: three knocks through the wall

A guided run through Witness with one fictional narrator. Every name, place,
and event below is invented. Steps marked Implemented work today; steps marked
Pending describe agreed future behavior with acceptance checks for later.

The demo collection holds four stories: this walkthrough, **Dad's first
message**, and two supporting stories for variety, **"I checked the
forecast"** and **"Just stay on the line"**. The supporting stories are
browsable from the same place but are not part of this walkthrough.

## Setup

1. Run `npm run dev` and open `http://127.0.0.1:4173`.
2. On the home page choose **Browse demo stories →**, then **Start demo
   interview** on **Three knocks through the wall**
   (fixture `DC-01`).
3. Starting gives you the first question with no answers submitted. Speak or
   type the seeded lines below as your answers, one at a time, following
   section 1.
4. Alternatively, **Load completed example** submits all three entries at once
   and skips ahead to review. Use it when checking later steps without the
   voice walkthrough.
5. Starting or loading always creates a new conversation with fresh
   identities; existing stories are never overwritten. Demo conversations
   carry a visible **Fictional example** tag in the interface and in story
   exports. Nothing here changes model behavior: the demo is ordinary
   project data, and no code path recognises it.

Seeded entries (speak or type these as your answers):

1. “My sister moved to Toronto two years ago, I think. We call every Sunday
   evening.”
2. “We shared a wall between our rooms. Three knocks meant good night.”
3. “She knocks three times on the phone speaker before hanging up. I knock
   back on my desk.”

## 1. Voice answer and contextual follow-up [Implemented]

- On the interview page, press **Record an answer** and say entry 1, or
  upload a WAV of it. Press stop, listen, then transcribe (if enabled) or
  type the line and submit.
- **Check:** the next question refers to what was just said (the sister, the
  move, the Sunday calls) instead of repeating the opening question.
- Answer entries 2–3 by voice or text, one at a time. Follow-up questions
  are generated from what you actually said, so they may differ from the
  fixture's recorded questions; answer each asked question using the next
  seeded line as material.

## 2. Date correction [Implemented]

- In **Review**, open the first answer and change “two years ago, I think”
  to “three years ago — she moved in 2023.” Save the answer.
- **Check:** the answer shows revision 2; any event built earlier is marked
  stale and must be rebuilt before confirming.

## 3. Event review [Implemented]

- Choose **Build an event from my answers**, review the draft (title,
  summary, date, place, people), then **Confirm this event**.
- Choose **Find distinct events** and keep one draft into the collection.
- **Check:** unknown details stay blank or approximate; nothing invents a
  surname, a street, or an exact day. Home → **Your events** lists the
  entry.

## 4. Editable source-linked story [Implemented]

- Choose **Assemble a story draft**. Edit the knocks passage in your own
  words, then open its **Source** to see the answer it came from.
- Edit an answer in Review so a passage goes stale; back in the story,
  accept or reject the update proposal explicitly.
- Optionally choose **Suggest wording** on a passage and accept or reject
  the suggestion. If you edit the passage or its answer while the
  suggestion is pending, the suggestion is dropped rather than applied to
  changed words.
- **Check:** the story always shows its sources; proposals never replace
  text silently; original answers are unchanged by editor suggestions.

## 5. Weekly narrative [Implemented]

- From the story sidebar choose **Draft a weekly story →**. Pick the week
  containing the seeded entries (grouped by recording day in the shown
  timezone), keep the entries selected, and choose **Draft this week**.
- Review the draft: each paragraph with its source entries, uncertain dates
  preserved. Edit the wording if you like, then **Accept this story** —
  or **Discard** it. Nothing is saved without the narrator’s choice.
- **Check:** the kept story lists its week, timezone, and sources; editing
  a source entry afterwards marks it as changed without altering the kept
  text; originals and events are untouched.

## 6. Connect [Pending]

- Select the sisters' ritual event and open Connect.
- **Expected:** the narrator’s event sits at the origin with outward arcs to
  matching shared stories; a same-occasion match reads differently from a
  similar experience elsewhere and from non-matches. The shared-story cases
  live in `web/connect-fixtures.js`.

## Cleanup

Delete the demo story from the home page. Deleting removes its answers,
recordings, and scene images from this browser.
