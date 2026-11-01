# Connect

A globe for finding familiar experiences in other people's stories.

Choose an event in the example timeline. Matching shared stories appear as points connected to that event by curved lines. Open a point or a story card to read more. Use the locate button on a card to bring its city into view.

## Intended experience

The side panel contains the person's own events: a first concert, first day at school, first job, or another scene extracted from their journal. Selecting one event makes its location the origin. Matching shared experiences light up elsewhere, with curved lines growing outward from that origin to each match. Selecting a point opens the corresponding story and the reason it matches.

**Same event** needs compatible identifying details, date and place. **Similar experience** can connect people across countries and years: two first jobs building cottages may be related even when the employers, dates and cities differ. A broad category such as Work is not enough on its own. Stories in the same city remain separate results; missing locations must not be invented.

The complete journal flow, matching examples, map behaviour and acceptance scenarios are in [Journal and Connect](journal-and-connect.md). This describes the intended direction; the implemented category-based fictional preview below has not yet been replaced with real-user matching.

## The preview

- Four example life events and ten shared fictional stories.
- A globe you can drag, rotate with arrow keys or buttons, zoom, and reset.
- Matching based on explicit event categories, with a reason shown on each card.
- An empty state for an event with no matches.
- The selected event survives a page reload.
- Nearby markers are offset with small leader lines so both remain clickable.
- All stories are available in the card list, including ones on the far side of the globe.

The timeline is fictional, not extracted from the narrator's private interviews. Profiles are examples; no accounts, messaging, or real-user discovery are connected. Similar experiences do not mean people attended the same specific occasion.

## Map data

Land dots are derived from [Natural Earth 1:110m land](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson). Natural Earth data is [public domain](https://www.naturalearthdata.com/about/terms-of-use/). The generated points are bundled in `web/land-points.js`; the globe does not need a map API key or live map requests.

## Later

Let narrators choose a story version, topic, and broad location to share. They should be able to correct extracted events and remove a story from discovery. Real matching and contact preferences need a server-backed implementation. Meta could help propose event topics for review; the current category matching makes no model calls.
