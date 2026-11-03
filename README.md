# Senate needles

Live election-night needles for the closest 2026 Senate races: Alaska, Florida (special), Iowa,
Kansas, Maine, Michigan, Nebraska, Ohio (special), South Carolina and Texas. It runs entirely on
free services: GitHub Actions collects the data and GitHub Pages serves the page.

## What the page shows

- **Poll-closing banner** (top): the next poll closing, a countdown and what to watch, from
  `poll_schedule` in `config/races.json` (edit there).
- **Senate control** (top): a needle and this site's own chance of each party winning a majority, with a trend
  line over the night. It adds up the 10 needles (the model's own chances, never market odds) and
  the 25 other seats up this year (`senate.others` in `config/races.json`: Decision Desk HQ's
  numbers where it posted them, otherwise assumed safe or likely), allowing for polling misses that
  run the same way everywhere. Republicans keep control at 50 seats (the vice president breaks
  ties); Democrats need 51; if Osborn (independent, Nebraska) wins and the Senate is 50–49, he holds
  the balance. Beside it, for comparison: Kalshi, Polymarket, and Decision Desk HQ's stated chance (also ticks on the needle: K, P, DDHQ).
- **The needle**: this site's own rough estimate of each candidate's chance to win. Before votes are
  counted, it sits on a starting point that blends G. Elliott Morris's final forecast (50%),
  Decision Desk HQ's last posted forecast (30%) and the final polling average (20%), all entered
  by hand in `config/races.json` with their source posts. When Morris posts a win probability for a
  race on Bluesky tonight, the collector reads it and blends it into that needle (half weight when
  posted, halving each hour and as the count comes in). His posts aren't shown separately. As
  counties report, it compares each county's count with how that county voted for president in
  2024 and projects the votes still out (see `site/model.js`). It is not a professional forecast.
- **Results elsewhere**: polling misses are correlated across states, so about 45% of each race's
  polling error is treated as national (`NATIONAL_SHARE` in `site/model.js`). As counts come in,
  each counted state's departure from its starting point moves every other race's starting point
  by the shared part (each state is adjusted using the other states only). The overview bar shows
  the national reading; each card says how far it moved. Market prices are never used for this.
- **Early clues** (used, not shown): seven races that report early, from Axios's list (Florida's
  14th and 25th, Virginia's 1st, 2nd and 5th) plus Kentucky's Senate race and Indiana's 1st
  District, feed the same national reading. Each has an `expected` result in `config/races.json`;
  a district counts for less than a statewide race and only once some of it has reported.
  Florida's come from the same file as its Senate race; Virginia's from the Department of
  Elections' results API; Kentucky's from the State Board's live page (read every 3 minutes; it refuses GitHub's servers, so Decision Desk HQ's Kentucky updates stand in);
  Indiana's from the state's election-night JSON.
- **Ticks on the dial**: K (Kalshi) and P (Polymarket) betting prices, and a hollow mark for the
  starting point. They are shown beside the estimate, never mixed into it.
- **Where the counts come from**: Ohio (the Secretary of State's NIST XML feed), Florida (the
  Division of Elections' results extract), Alaska (the precinct CSV, added up by house district) and
  Nebraska (statewide totals CSV) are read from official files. Texas and Michigan refuse requests
  from GitHub's servers; South Carolina, Iowa and Kansas use Clarity, whose browser check automated
  readers can't pass; Maine posts no live count. For those six (and for any state whose feed stops
  answering), the count is Decision Desk HQ's latest "Race Update" post on Bluesky: statewide
  totals and its estimate of the share counted. If there is no such post yet after polls close,
  the needle shows the market average, labelled "market odds".
- **Decision Desk HQ** is read only from its Bluesky account (`scripts/sources/ddhq.mjs`), never
  from its website, whose terms forbid scraping.
- **Dave Wasserman** (Cook Political Report) is read from his Bluesky posts every update: his
  "I've seen enough" calls appear as race calls, and any win chance he states is blended into the
  needle like Morris's. X (Twitter) is not read: its terms forbid automated scraping and it
  requires a login.
- **Race calls** appear only when the AP's, Decision Desk HQ's or Dave Wasserman's own post says so, or when you set
  one by hand (below).
- **Candidate photos**: freely licensed photos from Wikimedia Commons (public domain or Creative
  Commons), credited at the bottom of the page. To refresh them: Actions → "Candidate photos" →
  Run workflow with "commit" ticked (`scripts/fetch_photos.mjs`). A wrong match can be fixed by
  naming the candidate's Wikipedia article with `"wiki"` in `config/races.json`.
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
