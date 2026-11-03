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

## Semantic discovery (Real stories mode)

Real mode adds optional **Search with Muse** beside the local topic preview. Date/city filters narrow public stories on the device first, with no model call. One explicit click sends only the search text plus up to 40 public excerpts (summary and selected passages, 2000 characters each) to `POST /api/ai/discovery` for a single bounded Muse ranking; private answers never leave the device. Rankings map back onto the actual public rows, and withdrawn or revised rows drop out. Same-occasion badges still come only from matching occasion codes, never from the model.

Config gates (honest, no fake fallback): the server needs `META_AI_ENABLED=true` plus `MODEL_API_KEY`, otherwise search reads as unavailable and the local preview keeps working. Publishing with date wording needs migration `supabase/migrations/20261105_discovery.sql` applied once; without it, publishing refuses instead of storing a copy without the narrator's wording.

While a search is pending, the globe turns slowly and readable excerpts from the bound public candidates appear beside its visible edge — each quote is one card on a single layer above the canvas: it starts at the projected limb, travels outward into a readable rest, holds, then drifts further out and dissolves while the next crossfades in. Positions come from the live projected globe centre and radius, alternate limbs, and track zoom and resize. A quote shows only while its story's published location faces the camera; while it shows, its origin point glows softly on Earth with a tether that follows the moving card, and each card names its origin city. Both highlight and tether fade with the quote, and far-side points hide. These highlights mark candidate locations, never confirmed matches — ranked similarity connections appear only after validated results arrive. At most two quotes show on desktop and one on a phone. This is a waiting visualisation, not a live view of what the model is reading — the ranking request exposes no per-story progress. Reduced-motion settings and the motion toggle keep the scene still, and the animation stops in every terminal state (results, empty, error, cancellation). On narrow screens the globe sits between the event list and the filter form, so it stays reachable without scrolling through the whole form.

Without live AI (mock mode), the panel offers **Preview the searching animation**: a clearly labelled 12-second simulation that cycles the same bound excerpts with no model call and no results. It exists so the motion can be reviewed without spending credits; it never paints a ranking.

## Attribution

The renderer adapts the user's Master Dev Workshop Earth treatment. Three.js is vendored locally with its MIT licence; no external script or map request is needed. NASA day/night imagery and workshop attribution are in [the Earth assets README](../web/assets/earth/README.md).
