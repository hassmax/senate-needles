# Senate needles

Live election-night needles for the closest 2026 Senate races: Alaska, Florida (special), Iowa,
Kansas, Maine, Michigan, Nebraska, Ohio (special), South Carolina and Texas. It runs entirely on
free services: GitHub Actions collects the data and GitHub Pages serves the page.

## What the page shows

- **The needle**: this site's own rough estimate of each candidate's chance to win. Before votes are
  counted, it sits on a starting point that blends the final polling average (30%) with G. Elliott
  Morris's final forecast (70%, entered by hand in `config/races.json`). When Morris posts a win
  probability for a race on Bluesky tonight, the collector reads it and blends it into that needle
  (half weight when posted, halving each hour and as the count comes in). His posts aren't shown
  separately. As counties report, it compares each county's
  count with how that county voted for president in 2024 and projects the votes still out (see
  `site/model.js`). It is not a professional forecast.
- **Results elsewhere**: polling misses are correlated across states, so about 45% of each race's
  polling error is treated as national (`NATIONAL_SHARE` in `site/model.js`). As official counts come
  in, each counted state's departure from its starting point moves every other race's starting
  point by the shared part (each state is adjusted using the other states only). The overview bar
  shows the national reading; each card says how far it moved. Market prices are never used for this.
- **Early clues**: five House races that report early and fast, from Axios's list (Florida's 14th
  and 25th, Virginia's 1st, 2nd and 5th), feed the same national reading. Each has an `expected`
  result in `config/races.json` (2024 presidential margin + forecast national swing + incumbency);
  a district counts for less than a statewide race and only once some of it has reported. Florida's
  come from the same file as its Senate race; Virginia's from the Department of Elections' results API.
- **Ticks on the dial**: K (Kalshi) and P (Polymarket) betting prices, and a hollow mark for the
  polling average. They are shown beside the estimate, never mixed into it.
- **Which states have live counts**: Ohio (the Secretary of State's NIST XML feed), Florida
  (the Division of Elections' results extract), Alaska (the precinct CSV, added up by house
  district) and Nebraska (statewide totals CSV). Texas and Michigan refuse requests from GitHub's
  servers. South Carolina, Iowa and Kansas use Clarity, whose browser check automated readers
  can't pass. Maine posts no live count. These six show the market average instead, labelled "market odds", as does a
  counted state whose feed stops answering after its polls close.
- **Race calls** appear only when the AP's own post says so, or when you set one by hand (below).
- **Live feed**: posts from news organizations and analysts on Bluesky, Bluesky keyword searches
  (well-followed accounts only, marked "search"), and Google News headlines. Each item is a short
  excerpt with a link.

## How it updates

- `Update` workflow: reads every source (`scripts/fetch.mjs`), saves working state to the `data`
  branch, and publishes the page. Each run takes about a minute.
- `Election night` workflow: starts `Update` runs back to back, so the data is about one to two
  minutes old. The page itself checks for new data every 20 seconds.
- `Check sources` workflow: prints what each source returns, for troubleshooting.

## Changing things during the night

Edit `config/races.json` on GitHub (pencil icon, then "Commit changes"). The next update uses it.

- **Call a race by hand**: add `"call": {"winner": "left", "by": "AP", "url": "https://..."}` to the
  race (`left` is the first-listed candidate, `right` the second).
- **Change a polling average**: edit that race's `prior.margin` (left minus right, in points).
- **Feed accounts**: `config/feed.json`.

To stop everything after the election: Actions tab → "Election night" → "..." → Disable workflow
(and the same for "Update").

## Testing

    node --test tests/*.test.mjs
    node scripts/make_demo.mjs && cp config/races.json site/data/config.json
    python3 -m http.server --directory site 8000   # open http://localhost:8000/?demo

`?demo` shows made-up numbers for checking the layout; they are not real results.
