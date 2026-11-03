# Senate needles: notes for Claude Code

Election-night needles for 10 close 2026 Senate races. Owner: a law student, not a developer; explain changes plainly. Keep it honest about uncertainty, simple (vanilla JS, no build step, no dependencies) and fast.

- `scripts/fetch.mjs` (Node 22, no packages) reads official counts (`scripts/sources/states.mjs`), Kalshi/Polymarket (`markets.mjs`), Bluesky and Google News (`social.mjs`); writes `out/live.json`, `out/history.json`; state lives on the `data` branch.
- `site/model.js` is the estimate, shared by the page and the collector; tests in `tests/`.
- Markets are shown beside the needle, never mixed into the estimate. Race calls only from a call source's own post or a hand call in `config/races.json`.
- Show only short excerpts and links for posts and headlines.
- This sandbox can't reach most sources; test them with the "Check sources" workflow.
- G. Elliott Morris's analysis is factored into the needles, not shown separately (owner's choice): `forecast` in races.json (his final forecast, entered by hand) blends 70/30 with the polling average into each starting point (`priorOf`); win probabilities he states on Bluesky are parsed (`statedChance`) and blended in (`blendLive`). Don't add a panel or card lines for his posts.
- Don't read fiftyplusone.news automatically: its terms forbid automated harvesting and publishing its data. Enter numbers by hand, with a source note.
