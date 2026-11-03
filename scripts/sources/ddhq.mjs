// Decision Desk HQ, read only from its own public Bluesky posts (decisiondeskhq.bsky.social) through
// Bluesky's public API. DDHQ's website is never read: its terms forbid scraping or harvesting it.
// Two kinds of post are used here:
//  - vote updates: "DDHQ Race Update (est. 34% in): Texas US Senate James Talarico (D): 1,234 (51.2%)
//    Ken Paxton (R): ..." -> statewide totals and DDHQ's estimate of the share counted, used for states
//    whose own results sites can't be read;
//  - its stated chance of Senate control ("Democrats have a 64% probability of winning a majority").
// Its race calls ("Decision Desk HQ projects ...") are read with the other call sources (config/feed.json).
import { getJSON, sideOf, num } from "../lib.mjs";

const FEED = "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed";

export function parseRaceUpdate(races, text) {
  const m = String(text || "").match(/DDHQ Race Update \(est\.\s*(\d+(?:\.\d+)?)%\s*in\)\s*:\s*([\s\S]*)/i);
  if (!m) return null;
  const body = m[2].split(/Follow more results/i)[0];
  if (/primary|runoff|caucus/i.test(body.split(/\(\s*[A-Z]{1,3}\s*\)\s*:/)[0])) return null;
  const race = races.find((r) => new RegExp(`^\\s*${r.state} US Senate\\b`, "i").test(body));
  if (!race) return null;
  let left = 0, right = 0, other = 0, n = 0;
  for (const c of body.matchAll(/([A-Z][^:()]*?)\s*\(\s*([A-Z]{1,3})\s*\)\s*:\s*([\d,]+)\s*\(/g)) {
    const name = c[1].replace(new RegExp(`^.*US Senate(?: (?:General|Special(?: Election)?|Election))*\\s*`, "i"), "").trim();
    const party = c[2], votes = num(c[3]);
    let side = sideOf(race, { name, party });
    // Same last name, different party (Alaska has two Sullivans): the party decides.
    const want = side === "left" ? race.left.party : side === "right" ? race.right.party : null;
    if (want && /^[DR]$/.test(party) && /^[DR]$/.test(want) && party !== want) side = "other";
    if (want && /^[DR]$/.test(party) && want === "I") side = "other";
    if (side === "left") left += votes; else if (side === "right") right += votes; else other += votes;
    n++;
  }
  if (!n || left + right === 0 && other === 0) return null;
  return { race: race.id, left, right, other, pct_in: +m[1] };
}

// "In the Senate, Democrats have a 64% probability of winning a majority" -> 0.64 (Democrats).
export function statedControl(text) {
  for (const s of String(text || "").split(/(?<=[.!?\n])\s+/)) {
    if (!/\bSenate\b/.test(s) || /\bHouse\b|governor|gubernatorial/i.test(s)) continue;
    if (!/(probability|chance|odds|shot)/i.test(s) || !/(majority|control|win(ning)? the Senate|flip(ping)? the Senate)/i.test(s)) continue;
    const m = s.match(/\b(Democrats?|Republicans?|GOP)\b[^.%]{0,50}?(\d{1,2}(?:\.\d+)?)\s?%/i);
    if (!m) continue;
    const p = +m[2] / 100;
    return /^Dem/i.test(m[1]) ? p : 1 - p;
  }
  return null;
}

// Statewide early clues (config bellwethers with "ddhq_state", e.g. Kentucky's Senate race) can be
// read from the same posts: they are matched like races.
export const clueRaces = (list) => (list || []).filter((b) => b.ddhq_state).map((b) => ({ ...b, state: b.ddhq_state }));

export async function ddhq(cfg, races, prev, since, health) {
  const handle = (cfg && cfg.handle) || "decisiondeskhq.bsky.social";
  const counts = { ...((prev && prev.counts) || {}) };
  let control = (prev && prev.control) || null;
  try {
    const j = await getJSON(`${FEED}?actor=${encodeURIComponent(handle)}&limit=100&filter=posts_no_replies`);
    const feed = (j.feed || []).filter((f) => !f.reason).map((f) => f.post);
    feed.sort((a, b) => Date.parse(a.indexedAt) - Date.parse(b.indexedAt));
    for (const p of feed) {
      const text = (p.record && p.record.text) || "";
      const time = (p.record && p.record.createdAt) || p.indexedAt;
      const url = `https://bsky.app/profile/${handle}/post/${p.uri.split("/").pop()}`;
      const u = parseRaceUpdate(races, text);
      if (u && Date.parse(time) >= since && (!counts[u.race] || Date.parse(counts[u.race].time) <= Date.parse(time))) {
        counts[u.race] = { left: u.left, right: u.right, other: u.other, pct_in: u.pct_in, time, url };
      }
      const c = statedControl(text);
      if (c != null && Date.now() - Date.parse(time) < 48 * 3600e3 && (!control || Date.parse(control.time) <= Date.parse(time))) {
        control = { d: c, r: 1 - c, time, url, by: "Decision Desk HQ" };
      }
    }
    health.push({ name: "ddhq posts", ok: true, detail: `${feed.length} posts; updates for ${Object.keys(counts).join(",") || "none"}` });
  } catch (e) {
    health.push({ name: "ddhq posts", ok: false, detail: e.message });
  }
  return { counts, control };
}

// A DDHQ update in the shape of an official statewide count (site/model.js estimate).
// A DDHQ update as an early-clue count (its estimate of the share counted stands in for precincts).
export const ddhqClue = (u) => ({ ok: u.left + u.right + u.other > 0, left: u.left, right: u.right, other: u.other, precincts: [u.pct_in, 100],
  unitsAre: "expected vote (DDHQ estimate)", via: "ddhq", url: u.url, updated: u.time, votes: u.left + u.right + u.other });

export function ddhqCount(u) {
  const votes = u.left + u.right + u.other;
  return {
    ok: votes > 0, source: "Decision Desk HQ", via: "ddhq", url: u.url, units: [],
    statewide: { name: "__state", left: u.left, right: u.right, other: u.other, complete: u.pct_in >= 99.5 },
    votes, pct_in: u.pct_in, expected_votes: u.pct_in >= 1 ? votes / (u.pct_in / 100) : null,
    updated: u.time, fetched: new Date().toISOString(), error: votes > 0 ? null : "no votes counted yet",
  };
}
