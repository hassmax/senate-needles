# Senate needles: notes for Claude Code

Election-night needles for 10 close 2026 Senate races. Owner: a law student, not a developer; explain changes plainly. Keep it honest about uncertainty, simple (vanilla JS, no build step, no dependencies) and fast.

- `scripts/fetch.mjs` (Node 22, no packages) reads official counts (`scripts/sources/states.mjs`), Kalshi/Polymarket (`markets.mjs`), Bluesky and Google News (`social.mjs`); writes `out/live.json`, `out/history.json`; state lives on the `data` branch.
- `site/model.js` is the estimate, shared by the page and the collector; tests in `tests/`.
- Markets: each needle blends in the Kalshi/Polymarket average at `market_weight` (0.4, owner's choice on election night, `needle()` in model.js); the K/P ticks still show them separately. Never feed market prices into the national shift (`nationalShift`). Race calls only from a call source's own post or a hand call in `config/races.json`.
- Show only short excerpts and links for posts and headlines.
- This sandbox can't reach most sources; test them with the "Check sources" workflow.
- G. Elliott Morris's analysis is factored into the needles, not shown separately (owner's choice): `forecast` in races.json (his final forecast, entered by hand) is 50% of each starting point (`priorOf`, with DDHQ 30% and polls 20%); win probabilities he states on Bluesky are parsed (`statedChance`) and blended in (`blendLive`). Don't add a panel or card lines for his posts.
- Don't read fiftyplusone.news automatically: its terms forbid automated harvesting and publishing its data. Enter numbers by hand, with a source note.
- Results elsewhere: `needles()` in model.js learns a national shift from other states' official counts (`evidenceOf`, `nationalShift`, leave-one-out) and moves each race's starting point (`adjustPrior`). Page and collector both call `needles()`; never feed market prices into it.
- Early clues: `bellwethers` in races.json (Axios's list plus Kentucky's Senate race and Indiana's 1st) are read by `allBellwethers` (Florida from the Senate file, Virginia's Enhanced Voting API, Kentucky's live page every 3 min, Indiana's ENR JSON) and fed to `needles()` as evidence (`bellwetherEvidence`). Not shown on the page (owner's choice); keep them in the model.
- Decision Desk HQ: read only from its Bluesky posts (`scripts/sources/ddhq.mjs`), never its website (terms forbid scraping, manual or automated). Its last posted race forecasts are in each race's `ddhq` (30% of the starting point, `forecast_weights`); its "Race Update" posts stand in for counts in states we can't read; its stated control chance is shown at the top beside Kalshi and Polymarket; it is a call source.
- Senate control (`senateControl` in model.js): the needles' own chances plus `senate.others`, summed over shared national misses (so it includes the market blend); shown at the top with a trend line (`history.control`).
