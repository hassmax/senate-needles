// Prediction-market prices: Kalshi (public market data, no login) and Polymarket (Gamma API).
// Each returns {left, right} prices between 0 and 1 for the two main candidates, the page link,
// and when it was read. Prices are shown beside the needle, never mixed into the estimate.
import { getJSON, sideOf, log } from "../lib.mjs";

const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const GAMMA = "https://gamma-api.polymarket.com";

const mid = (bid, ask, last) => {
  const b = Number(bid), a = Number(ask), l = Number(last);
  if (b > 0 && a > 0 && a >= b && a - b <= 0.2) return (a + b) / 2;
  if (l > 0) return l;
  if (b > 0 && a > 0) return (a + b) / 2;
  return null;
};

function kalshiPrice(m) {
  // Newer responses carry dollar strings ("0.6400"); older ones cents (64).
  if (m.yes_bid_dollars != null || m.last_price_dollars != null) {
    return mid(m.yes_bid_dollars, m.yes_ask_dollars, m.last_price_dollars);
  }
  const c = mid(m.yes_bid, m.yes_ask, m.last_price);
  return c == null ? null : c / 100;
}

export async function kalshiEvent(ticker) {
  const j = await getJSON(`${KALSHI}/events/${encodeURIComponent(ticker)}?with_nested_markets=true`);
  const ev = j.event || {};
  const markets = j.markets && j.markets.length ? j.markets : ev.markets || [];
  return { ev, markets };
}

export async function kalshi(race, cache) {
  const tickers = race.markets && race.markets.kalshi ? [race.markets.kalshi]
    : cache.kalshi ? [cache.kalshi] : [`SENATE${race.id}-26`, `SENATE${race.id}S-26`];
  let lastErr;
  for (const t of tickers) {
    try {
      const { ev, markets } = await kalshiEvent(t);
      if (!markets.length) continue;
      const out = { left: null, right: null };
      for (const m of markets) {
        const label = [m.yes_sub_title, m.subtitle, m.title, m.ticker && m.ticker.split("-").pop()].filter(Boolean).join(" ");
        let side = sideOf(race, { name: label, party: (m.yes_sub_title || m.ticker.split("-").pop() || "") });
        if (side === "other") side = sideOf(race, { party: m.ticker.split("-").pop() });
        const p = kalshiPrice(m);
        if (side !== "other" && p != null) out[side] = p;
      }
      if (out.left == null && out.right == null) continue;
      cache.kalshi = t;
      const series = (ev.series_ticker || t.split("-")[0]).toLowerCase();
      return { ...out, url: `https://kalshi.com/markets/${series}`, ticker: t, fetched: new Date().toISOString() };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("no Kalshi market found");
}

export async function kalshiControl() {
  const { markets } = await kalshiEvent("CONTROLS-2026");
  const out = { d: null, r: null, url: "https://kalshi.com/markets/controls" };
  for (const m of markets) {
    const label = `${m.yes_sub_title || ""} ${m.ticker}`.toLowerCase();
    const p = kalshiPrice(m);
    if (/democrat|-d\b/.test(label)) out.d = p;
    else if (/republican|-r\b/.test(label)) out.r = p;
  }
  return out;
}

function polyPrice(m) {
  let prices = m.outcomePrices;
  try { if (typeof prices === "string") prices = JSON.parse(prices); } catch { prices = null; }
  return mid(m.bestBid, m.bestAsk, m.lastTradePrice) ?? (prices ? Number(prices[0]) : null);
}

function polyEventMatches(race, ev) {
  const t = `${ev.title || ""} ${ev.slug || ""}`.toLowerCase();
  const st = race.state.toLowerCase();
  if (!t.includes(st) || !/senate/.test(t)) return false;
  if (/primary|nominee|runoff/.test(t)) return false;
  if (race.state === "Kansas" && t.includes("arkansas")) return false;
  if (race.state === "Virginia" && t.includes("west virginia")) return false;
  return !ev.closed;
}

export async function polymarket(race, cache) {
  let ev = null;
  const slug = (race.markets && race.markets.polymarket) || cache.polymarket;
  if (slug) {
    const j = await getJSON(`${GAMMA}/events?slug=${encodeURIComponent(slug)}`);
    ev = Array.isArray(j) ? j[0] : null;
  }
  if (!ev) {
    const j = await getJSON(`${GAMMA}/public-search?q=${encodeURIComponent(`${race.state} Senate election`)}&limit_per_type=10`);
    const cands = (j.events || []).filter((e) => polyEventMatches(race, e));
    cands.sort((a, b) => (b.volume || 0) - (a.volume || 0));
    ev = cands[0] || null;
    if (ev && !ev.markets) {
      const k = await getJSON(`${GAMMA}/events?slug=${encodeURIComponent(ev.slug)}`);
      ev = Array.isArray(k) ? k[0] : ev;
    }
  }
  if (!ev) throw new Error("no Polymarket market found");
  const out = { left: null, right: null };
  for (const m of ev.markets || []) {
    if (m.closed) continue;
    const label = `${m.groupItemTitle || ""} ${m.question || ""}`;
    const side = sideOf(race, { name: label, party: (m.groupItemTitle || "").trim() }) !== "other"
      ? sideOf(race, { name: label, party: (m.groupItemTitle || "").trim() })
      : /democrat/i.test(label) ? sideOf(race, { party: "D" }) : /republican/i.test(label) ? sideOf(race, { party: "R" }) : "other";
    const p = polyPrice(m);
    if (side !== "other" && p != null) out[side] = p;
  }
  if (out.left == null && out.right == null) throw new Error(`Polymarket event ${ev.slug} has no matching candidates`);
  cache.polymarket = ev.slug;
  return { ...out, url: `https://polymarket.com/event/${ev.slug}`, slug: ev.slug, fetched: new Date().toISOString() };
}

export async function allMarkets(races, cache, health) {
  const out = {};
  await Promise.all(races.map(async (race) => {
    const c = (cache[race.id] = cache[race.id] || {});
    out[race.id] = {};
    for (const [name, fn] of [["kalshi", kalshi], ["polymarket", polymarket]]) {
      try {
        out[race.id][name] = await fn(race, c);
      } catch (e) {
        log(`[markets] ${race.id} ${name}: ${e.message}`);
        health.push({ name: `${name} ${race.id}`, ok: false, detail: e.message });
        continue;
      }
      health.push({ name: `${name} ${race.id}`, ok: true });
    }
  }));
  return out;
}
