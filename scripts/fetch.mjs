// One update: reads every source, writes out/live.json (what the page shows) and out/history.json
// (each needle over the night), and keeps working state in state/. Run by the Update workflow,
// back to back all night. Usage: node scripts/fetch.mjs [--state state] [--out out]
import fs from "node:fs";
import path from "node:path";
import { allCounts, allBellwethers } from "./sources/states.mjs";
import { allMarkets, kalshiControl, polymarketControl } from "./sources/markets.mjs";
import { ddhq, ddhqCount, ddhqClue, clueRaces } from "./sources/ddhq.mjs";
import { bluesky, news, detectCall, featured, liveEstimates } from "./sources/social.mjs";
import { needles } from "../site/model.js";
import { log } from "./lib.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const STATE = arg("--state", "state"), OUT = arg("--out", "out");
const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };

const config = readJSON(path.join(root, "config/races.json"));
const feedCfg = readJSON(path.join(root, "config/feed.json"), {});
const races = config.races;
const prev = readJSON(path.join(STATE, "live.json"), {});
const history = readJSON(path.join(STATE, "history.json"), {});
const cache = readJSON(path.join(STATE, "cache.json"), {});
const started = Date.now();
const health = [];

cache.markets = cache.markets || {};
cache.counts = cache.counts || {};
cache.social = cache.social || {};

const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} took over ${ms / 1000}s`)), ms))]);
const safe = async (label, fn, fallback) => {
  try { return await withTimeout(fn(), 50000, label); } catch (e) { log(`[${label}] ${e.message}`); health.push({ name: label, ok: false, detail: e.message }); return fallback; }
};

const since = config.history_since ? Date.parse(config.history_since) / 1000 : 0;
const [counts, markets, control, polyControl, dd, posts, headlines, stars] = await Promise.all([
  safe("counts", () => allCounts(races, prev.races, cache.counts, health), {}),
  safe("markets", () => allMarkets(races, cache.markets, health), {}),
  safe("control", () => kalshiControl(), prev.control && prev.control.kalshi),
  safe("control polymarket", () => polymarketControl(), prev.control && prev.control.polymarket),
  safe("ddhq", () => ddhq(feedCfg.ddhq, [...races, ...clueRaces((config.bellwethers || {}).list)], prev.ddhq, since * 1000, health), prev.ddhq || { counts: {} }),
  safe("bluesky", () => bluesky(feedCfg.bluesky || {}, races, health, cache.social), []),
  safe("news", () => news(races, health), []),
  safe("featured", () => featured(feedCfg.featured, races, health), prev.featured || []),
]);

// Early-clue House districts (after the Senate counts, so Florida's file is already in hand).
cache.clues = cache.clues || {};
const clues = await safe("clues", () => allBellwethers((config.bellwethers || {}).list, prev.clues, health, cache.clues), prev.clues || {});
// A statewide clue whose own site refuses us (Kentucky's) uses Decision Desk HQ's latest update.
for (const b of clueRaces((config.bellwethers || {}).list)) {
  const du = dd && dd.counts && dd.counts[b.id];
  if (du && !(clues[b.id] && clues[b.id].ok && clues[b.id].via !== "ddhq")) clues[b.id] = ddhqClue(du);
}

// Race calls: from a call source's own post (config/feed.json "calls"), or set by hand in races.json.
const calls = {};
for (const r of races) {
  const old = prev.races && prev.races[r.id] && prev.races[r.id].call;
  if (r.call) calls[r.id] = { by: r.call.by || "Called", winner: r.call.winner, url: r.call.url || null, time: r.call.time || null, manual: true };
  else if (old) calls[r.id] = old;
}
for (const p of posts) {
  if (!p.callSource) continue;
  const c = detectCall(races, { text: p.fullText, time: p.time });
  if (!c || calls[c.race]) continue;
  calls[c.race] = { by: p.callBy, winner: c.winner, url: p.url, time: p.time, text: p.text };
  p.call = true;
  log(`[call] ${c.race}: ${p.callBy} -> ${c.winner} (${p.url})`);
}

// Feed: newest first, one copy of each item, the last 18 hours.
const seen = new Set();
const feed = [...posts, ...headlines, ...((prev.feed || []).filter((i) => Date.now() - Date.parse(i.time) < 18 * 3600e3))]
  .filter((i) => i.id && i.text && i.text.replace(/\S+\.\S+\/\S*/g, "").trim().length >= 20 && !seen.has(i.id) && seen.add(i.id))
  .map(({ fullText, callSource, callBy, ...i }) => i)
  .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
  .slice(0, 400);
for (const i of feed) if (Object.values(calls).some((c) => c.url === i.url)) i.call = true;

// G. Elliott Morris's posts are not published here; only win probabilities he states for a race
// are kept, to be blended into that race's needle (site/model.js blendLive).
const analyst = { ...(prev.analyst || {}), ...liveEstimates(races, stars) };
for (const k of Object.keys(analyst)) if (Date.now() - Date.parse(analyst[k].time) > 4 * 3600e3) delete analyst[k];
for (const [k, v] of Object.entries(analyst)) log(`[analyst] ${k}: ${v.by} ${Math.round(v.p_left * 100)}% for the first-listed candidate (${v.url})`);
// Senate control odds shown at the top: the two markets and Decision Desk HQ's latest stated
// chance (its final forecast, config/races.json senate.ddhq_final, until it posts another).
const ddFinal = config.senate && config.senate.ddhq_final;
const ddControl = (dd && dd.control) || (ddFinal ? { d: ddFinal.p_d, r: 1 - ddFinal.p_d, time: ddFinal.as_of, url: ddFinal.url, by: "Decision Desk HQ" } : null);
const out = { generated: new Date().toISOString(), build: process.env.BUILD_SHA || null, races: {}, control: { kalshi: control || null, polymarket: polyControl || null, ddhq: ddControl }, ddhq: dd, analyst, clues, feed, health };
for (const r of races) {
  const m = markets[r.id] || {};
  const pm = (prev.races && prev.races[r.id] && prev.races[r.id].markets) || {};
  // States whose own results can't be read use Decision Desk HQ's latest posted update instead.
  let cnt = counts[r.id] || null;
  const du = dd && dd.counts && dd.counts[r.id];
  if (du && !(cnt && cnt.ok)) cnt = ddhqCount(du);
  out.races[r.id] = {
    counts: cnt,
    markets: { kalshi: m.kalshi || pm.kalshi || null, polymarket: m.polymarket || pm.polymarket || null },
    call: calls[r.id] || null,
  };
}

// History: what the needle shows (site/model.js needle), once a minute at most.
const now = Math.floor(Date.now() / 1000);
const baselines = Object.fromEntries(races.map((r) => [r.id, readJSON(path.join(root, `site/data/baseline/${r.id}.json`))]));
const N = needles(races, baselines, out.races, analyst, config, Date.now(), clues);
if (N.national.used.length) log(`[national] counts so far run ${(N.national.shift * 100).toFixed(1)} pts from expectations (positive = Democrats), from ${N.national.used.join(", ")}`);
for (const r of races) {
  const e = N.byRace[r.id].est;
  const h = (history[r.id] = (history[r.id] || []).filter((x) => x[0] >= since));
  const last = h[h.length - 1];
  const point = [now, +e.p.toFixed(4), +(e.margin * 100).toFixed(2), +(e.reported || 0).toFixed(3)];
  if (!last || now - last[0] >= 60 || Math.abs(last[1] - point[1]) > 0.002) h.push(point);
  if (h.length > 3000) h.splice(0, h.length - 3000);
}
if (N.control) {
  const h = (history.control = (history.control || []).filter((x) => x[0] >= since));
  const last = h[h.length - 1], c = N.control;
  const point = [now, +c.d.toFixed(4), +c.r.toFixed(4), +c.seats_d.toFixed(2)];
  if (!last || now - last[0] >= 60 || Math.abs(last[1] - point[1]) > 0.002) h.push(point);
  if (h.length > 3000) h.splice(0, h.length - 3000);
  log(`[control] Democrats ${(c.d * 100).toFixed(1)}%, Republicans ${(c.r * 100).toFixed(1)}%, balance ${(c.balance * 100).toFixed(1)}%, ${c.seats_d.toFixed(1)} Democratic seats expected`);
}

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(STATE, { recursive: true });
fs.writeFileSync(path.join(OUT, "live.json"), JSON.stringify(out));
fs.writeFileSync(path.join(OUT, "history.json"), JSON.stringify(history));
fs.writeFileSync(path.join(STATE, "live.json"), JSON.stringify(out));
fs.writeFileSync(path.join(STATE, "history.json"), JSON.stringify(history));
fs.writeFileSync(path.join(STATE, "cache.json"), JSON.stringify(cache));
const ok = health.filter((h) => h.ok).length;
log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s: ${ok}/${health.length} sources ok, ${feed.length} feed items, calls: ${Object.keys(calls).join(",") || "none"}`);
for (const h of health.filter((x) => !x.ok)) log(`  not ok: ${h.name}: ${h.detail}`);
process.exit(0); // don't wait for slow requests that were given up on
