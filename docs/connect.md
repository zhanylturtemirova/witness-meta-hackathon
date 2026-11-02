# Connect

Choose a confirmed event from your collection to find related fictional stories. The event's city is the origin on Earth. Your event stays on your device; choosing it does not publish it or send it to a model.

The sidebar switches between your confirmed events and five example events. Use **Review event →** in the collection to edit details, inspect source answers and confirm an extracted event. Drafts and events with changed source answers stay out of Connect until reviewed. A confirmed event covering the entire conversation can also drive its film plan. Dates such as “around 2019” remain unchanged. An event without a recognised city can still be read and compared, but has no invented map origin. The small city gazetteer is in `web/connect-events.js`; it is not a worldwide geocoder.

## Earth and stories

The textured Earth uses day and night imagery, a restrained atmosphere, and outward great-circle connections. Drag or use arrow keys to rotate, zoom with the buttons, or locate a story from its card. A connection sequence finishes after about four seconds; pause, replay, or turn motion off. Reduced-motion preferences are respected. Rendering pauses outside the viewport and when the page is hidden.

Two excerpts from fictional shared stories sit beside the Earth. Your private interview text is not used as background decoration. Nearby map buttons are separated so both can be opened. All results remain readable in the list, including stories on the far side of Earth and when WebGL is unavailable.

## Matching preview

The preview contains fourteen shared fictional stories and one unshared example. Curated topics support concert, moving, and first-project examples. Construction matches additionally require evidence of small-house work, site tasks, and learning a trade on both sides. A first job in a bakery does not match just because both are first jobs.

**Same occasion** requires an explicit shared fictional occasion identifier plus matching date and place. Other related results say **Similar experience**. Each card includes its reason and the two excerpts used for comparison. This is local preview logic, not a semantic Muse matching service.

Real-user publishing, matching, accounts, and messaging still need a server and explicit sharing controls. The [journal and Connect plan](journal-and-connect.md) describes that direction.

## Attribution

The renderer adapts the user's Master Dev Workshop Earth treatment. Three.js is vendored locally with its MIT licence; no external script or map request is needed. NASA day/night imagery and workshop attribution are in [the Earth assets README](../web/assets/earth/README.md).
