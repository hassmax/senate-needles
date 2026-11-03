// Writes made-up demo data (site/data/demo-live.json, demo-history.json) for checking the page
// with ?demo. Counts are each county's 2024 result shifted by a made-up swing. Not real results.
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync("config/races.json", "utf8"));
const now = Date.now();
const swing = { OH: 0.13, FL: 0.06, SC: 0.17, TX: 0.15, MI: 0.07, KS: 0.16, IA: 0.12, NE: 0.2, AK: 0.16 };
const frac = { OH: 0.72, FL: 0.93, SC: 0.55, TX: 0.38, MI: 0.2, KS: 0.08, IA: 0, NE: 0, AK: 0 };
const live = { generated: new Date(now).toISOString(), build: null, races: {}, control: { kalshi: { d: 0.66, r: 0.35 } }, feed: [], health: [{ name: "demo", ok: true }] };
const history = {};
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (const r of cfg.races) {
  const base = JSON.parse(fs.readFileSync(`site/data/baseline/${r.id}.json`, "utf8"));
  const f = frac[r.id] || 0;
  let counts = null;
  if (f > 0) {
    const units = base.units.map((u) => {
      const done = rnd() < f;
      const n = u.total * 0.75 * (done ? 0.99 : rnd() * f);
      const m = (u.d - u.r) / u.total + swing[r.id] + (rnd() - 0.5) * 0.04;
      const o = n * 0.03;
      return { name: u.name, left: Math.round((n - o) / 2 + (m * n) / 2), right: Math.round((n - o) / 2 - (m * n) / 2), other: Math.round(o), complete: done };
    });
    const votes = units.reduce((a, u) => a + u.left + u.right + u.other, 0);
    counts = { ok: true, source: `${r.state} (demo)`, units, votes, updated: new Date(now - 90e3).toISOString(), precincts: [Math.round(f * 2000), 2000] };
  }
  const k = { OH: 0.71, FL: 0.2, SC: 0.48, TX: 0.62, MI: 0.83, ME: 0.58, KS: 0.41, IA: 0.38, NE: 0.47, AK: 0.69 }[r.id];
  live.races[r.id] = {
    counts,
    markets: { kalshi: { left: k, right: 1 - k + 0.01, url: "https://kalshi.com" }, polymarket: { left: k + 0.03, right: 1 - k - 0.02, url: "https://polymarket.com" } },
    call: r.id === "FL" ? { by: "AP", winner: "right", url: "https://bsky.app", time: new Date(now - 20 * 60e3).toISOString() } : null,
  };
  const h = [];
  let p = 0.5 + r.prior.margin / 15;
  for (let i = 0; i < 90; i++) { p = Math.min(0.99, Math.max(0.01, p + (rnd() - 0.5) * 0.05)); h.push([Math.floor(now / 1000) - (90 - i) * 120, p, 0, 0]); }
  history[r.id] = h;
  live.feed.push(
    { id: `n${r.id}`, kind: "news", race: r.id, time: new Date(now - rnd() * 3600e3).toISOString(), outlet: "Example News", text: `Demo headline about the ${r.state} Senate race`, url: "https://news.google.com" },
    { id: `p${r.id}`, kind: "post", via: rnd() < 0.5 ? "search" : "account", race: r.id, time: new Date(now - rnd() * 3600e3).toISOString(), author: "Demo Analyst", handle: "example.com", text: `Demo post: early returns in ${r.state} look different from 2024 in the suburbs.`, url: "https://bsky.app" },
  );
}
live.feed.push({ id: "callFL", kind: "post", via: "account", race: "FL", call: true, time: new Date(now - 20 * 60e3).toISOString(), author: "The Associated Press", handle: "apnews.com", text: "BREAKING (demo): Republican Ashley Moody wins election to U.S. Senate in Florida.", url: "https://bsky.app" });
live.feed.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
fs.writeFileSync("site/data/demo-live.json", JSON.stringify(live));
fs.writeFileSync("site/data/demo-history.json", JSON.stringify(history));
console.log("demo written");
