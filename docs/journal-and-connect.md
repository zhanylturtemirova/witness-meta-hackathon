# Journal, stories and Connect

Witness is a voice-first journal and interviewer that helps people understand their life over time and find others through experiences they choose to share. People can record something that happened today, return to an older memory, or follow a question they would not have thought to ask themselves. A photo archive is not required.

This is the intended product behaviour. Period stories and real-user discovery are not implemented merely because they are described here. The current Connect preview still uses fictional fixtures.

## An ongoing conversation

The person can begin a conversation at any time, by voice or text. Witness can also offer an optional question at an agreed time, or when the person next opens the app. Questions should be specific, easy to decline and grounded in what the person has actually shared. Examples:

- “What stayed with you from today?”
- “You mentioned starting a new job. Was there a moment this week you would like to keep?”
- “Did anything today remind you of school?”
- “Would you like to return to the concert you started telling me about?”

Follow one answer with a relevant question instead of turning every entry into a questionnaire. Preserve unfinished threads and allow a quick entry with no follow-up. Offer another question, not now, and pause invitations. Questions are invitations, not assignments or measures of whether someone has lived enough.

Prompt frequency and reminder delivery are separate preferences. Real notifications while the app is closed require the infrastructure described in [the redesign plan](redesign-plan.md#reminders-and-rediscovery); an on-screen prompt is not scheduled push.

## Two outputs from the same material

### A story for a day, week or month

Witness should be able to draft one readable story from the selected period's entries, rather than concatenate a list of summaries. The person chooses the period and can review, edit or reject the draft. Optional scheduled drafting can be considered after this flow works and the person has opted in to its timing and API use.

Keep the original entries, recordings and transcripts. Every passage points back to the exact source entry or answer versions. New entries or corrections make affected period drafts due for review; they do not silently overwrite an edited story. Link related scenes without inventing dialogue, a causal explanation, a lesson learned, an emotional resolution or a happy ending.

Distinguish when an entry was recorded from when its events happened. A childhood memory recorded today belongs to today's journal activity, but its event remains in childhood. A weekly story may say the person revisited that memory this week; it must not claim the childhood event happened this week. Mark approximate and unknown dates as such. The selected timezone defines day/week/month boundaries.

### An event collection

Extract specific events separately from the period story: a first concert, first day at school, first job, a move, an ordinary meal or a conversation. A single entry may contain several events; several entries may add detail to the same event. Propose merges for review instead of silently creating duplicates or collapsing distinct occasions with similar wording.

Each event needs an identity independent of its title, its source references, its event date or date range and certainty, the relevant place, and the description the person approves. Work events may also contain the narrator's role, industry, activities and kinds of projects, when explicitly stated. Never infer missing personal facts to improve a match.

Events appear in an editable list, with useful groups such as Work, School, Concerts and Moving. Groups are browsing aids; they are not sufficient evidence that two experiences match. The person can correct an event, keep it private, or choose an excerpt and broad location for discovery. Sharing a period story does not automatically share all underlying events, entries or audio.

## Connect: start from one of my events

On desktop, the left side lists **my events**, drawn from the event collection. The globe occupies the main area. Reading opens in a side panel or card without losing the selected event. On a small screen, use a collapsible event picker and a readable match list alongside an optional globe view.

Example list:

- My first concert in my hometown
- My first day at school
- My first job — building cottages
- Moving to another country

Select **My first job — building cottages**. Its event location becomes the origin marker; this is where the experience happened, not necessarily where the narrator lives today. Matching shared events light up elsewhere. Lines grow outward from this origin to each match. This is a set of connections from the selected event, not a network connecting every other person to everyone else.

### Two different kinds of match

**Same event:** evidence suggests both narrators attended the same specific occasion. Use an event name or other identifying details, date/range and place together. Two first concerts in the same city are not automatically the same concert; look for the performer, festival or venue and compatible dates. Uncertain evidence produces a possible match, not a confirmed statement that people were together. A date contradiction prevents a same-event label unless someone corrects it.

**Similar experience:** the experiences are meaningfully related even when years and countries differ. A first job at a cottage-building company can connect with someone whose first job involved building small houses abroad. Compare the life stage, kind of work, industry, activities and project types, using only supplied details. Exact date and location overlap are not required. Merely having had a first job, or both mentioning work, is too broad a reason for a strong match.

Date and location therefore have different roles in the two match types. Show the distinction as **Same event** / **Similar experience**, with the latter as the useful default for worldwide discovery.

Each result explains the connection in plain language, supported by an excerpt from each event. For example: “Both describe a first job building small houses. Your event: Bishkek; this story: Porto. Different years.” Do not invent a similarity score or claim a calibrated confidence percentage without evidence.

Two accounts describing an event in the same city still remain separate results. Offset or cluster markers for readability without inventing new geographical locations. Events without a usable shared location remain discoverable in the list; do not fabricate coordinates to place them on the globe.

### Globe behaviour

Reuse the textured Earth, atmosphere and day/night rendering identified in the redesign plan. Introduce the origin first, then reveal matching markers and draw outgoing arcs in a short, staggered sequence. Settled connections remain faintly visible; hover or keyboard focus highlights one line and the corresponding story. Small travelling points or arrowheads indicate the relationship being revealed, not a person's journey.

Avoid an all-to-all mesh, a continually replaying animation and a wall of quotations. When there are many results, show a manageable selection, cluster dense locations and offer more results through the list. This controls drawing density rather than discarding matches. Provide pause/replay, reduced motion, keyboard access and a non-WebGL list. The origin can be the same for several experiences, but changing the selected event recomputes its matches.

Select a marker or result to read that person's shared story and the reason it matches. Close the reading panel to return to the same event and globe position. Contacting the author is separate, later functionality; reading a story does not imply an account is accepting messages.

### Discovery boundaries

Only approved shared excerpts enter the discoverable pool. A private selected event may be used as a query with the person's explicit action, but it is not published by selecting it. A backend implementation must honour its processing consent and access controls. Other readers never receive the full private journal, recordings or unpublished period stories.

Match event experiences, not personality, ethnicity, presumed trauma or other inferred personal attributes. A match is an invitation to read, not a claim that two people feel the same way. Removing an event from discovery removes its marker, excerpt and connection for other readers. Keep real accounts, real sharing and contact behind their own implementation and review.

## Meta roles and application responsibilities

- **Interviewer / Muse Spark:** proposes invitations and contextual follow-ups, remembers open threads and respects refusals.
- **Archivist / Muse Spark:** extracts reviewable events and their factual attributes with source IDs, date uncertainty and possible duplicate links.
- **Editor / Muse Spark:** proposes a day/week/month narrative or a single-event story, with passages tied to source versions.
- **Verifier / the existing bounded flow:** checks support and uncertainty. Its result stays distinct from the narrator's confirmation.
- **Matching / Meta text inference:** can compare candidate shared events and propose an evidence-based reason and match type. The exact retrieval method and thresholds still need evaluation; no embedding service or model is assumed to be connected.

Application code owns scheduling, consent, identities, date filters, source versions, sharing permissions, persistence and globe rendering. The same text model can serve several roles. These are prompt and workflow responsibilities, not a claim that separately trained models already exist.

## Next implementation scope

Continue the current staged work in [the Muse brief](muse-next.md). Make the journal and event collection part of the home/editor direction; add period drafting and event extraction to the model stage. Connect remains a core product direction and its globe stage should implement the selected-origin behaviour with explicit fictional fixtures first. Real multi-user discovery follows accounts, sharing permissions and backend matching.

Useful acceptance scenarios:

1. One voice entry produces a reviewable transcript and two separate, sourced event candidates; neither is shared automatically.
2. A weekly draft combines several entries while preserving a distinctive phrase and an approximate date. An edited source makes the affected draft stale.
3. A childhood story recorded this week keeps its historical event date.
4. Two stories from the same named concert/date/place are offered as a same-event candidate. Two different concerts in the same city are not.
5. First jobs on comparable housing projects in different years and countries can match as similar experiences. An unrelated first job is not promoted merely for sharing the category.
6. Selecting one event produces lines from its origin to matches; selecting another replaces that set. Reading and closing a story preserves the selection.
7. A private story never appears in another reader's results. Removing a shared event makes it unavailable for future results.
8. No matches, missing places, many matches, overlapping cities and reduced motion all leave a usable list.
