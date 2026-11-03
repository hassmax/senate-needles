# Senate needles

Live election-night needles for the closest 2026 Senate races: Alaska, Florida (special), Iowa,
Kansas, Maine, Michigan, Nebraska, Ohio (special), South Carolina and Texas. It runs entirely on
free services: GitHub Actions collects the data and GitHub Pages serves the page.

## What the page shows

- **The needle**: this site's own rough estimate of each candidate's chance to win. Before votes are
  counted, it sits on the final polling average. As counties report, it compares each county's
  count with how that county voted for president in 2024 and projects the votes still out (see
  `site/model.js`). It is not a professional forecast.
- **Ticks on the dial**: K (Kalshi) and P (Polymarket) betting prices, and a hollow mark for the
  polling average. They are shown beside the estimate, never mixed into it.
- **Where there's no official live count** (Maine, or any state whose feed stops answering after
  its polls close), the needle shows the market average and says so.
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
