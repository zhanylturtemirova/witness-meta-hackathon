# Technical outline

The core flow is: save an answer, ask a follow-up, review the material, draft a story, edit, and export.

## Core records

| Record | Purpose |
| --- | --- |
| StoryProject | A memory, theme, or period the narrator wants to explore |
| InterviewSession | A conversation that can be resumed |
| Question | A question and its connection to earlier answers |
| AnswerRevision | A version of the narrator's answer |
| LifeEvent | An optional event with an exact or approximate date, linked to answers |
| StoryRevision | A draft or reviewed story with passage-level source links |
| SharingChoice | Which story version or topics a person chooses to share, and with whom |
| Export | An output based on a selected story version |

These records describe the workflow, not a requirement for separate services.

## Source links and edits

Keep stable answer IDs and revisions. Generated passages refer to the answer versions used to create them. Validate those references before showing a draft.

Changing an answer should flag affected passages for review. It should not silently replace a story the narrator has already approved.

## Reliability

Save answers independently of model requests. A retry should not duplicate them. Keep API keys on the server and avoid logging the full text of personal stories. Check access when reading, editing, or exporting a project.

## Sharing and discovery

A future discovery layer should use an explicit shared-story record, separate from the private interview. It needs the selected story version, visible topics, visibility settings, and contact preferences. Search and matching methods remain open.

## Voice and video

Voice input adds a recording and a reviewable transcript. Video would need a scene plan, media assets, and render jobs linked to approved story versions. Rendering should support progress, cancellation, and retries without duplicate charges.

## Choices ahead

Choose the platform, storage, interface language, and export format around the first interview-to-story flow. Add setup instructions when there is an implementation to run.
