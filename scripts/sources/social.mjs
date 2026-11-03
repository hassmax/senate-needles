// The live feed: posts from listed Bluesky accounts (news organizations and election analysts,
// mostly with their own web domain as their handle, which Bluesky verifies), Bluesky keyword
// searches (well-followed accounts only, marked "search"), and Google News headlines. Only a
// short excerpt and the link are shown. Race calls are read only from the call sources' own posts.
import { get, getJSON, log } from "../lib.mjs";

const FEED = "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed";
const SEARCH = "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts";
const PROFILES = "https://api.bsky.app/xrpc/app.bsky.actor.getProfiles";

// Search finds a lot of campaign messaging; keep posts that talk about the count or the result.
const RESULT_WORDS = /\b(results?|counted|count|reporting|precincts?|turnout|leads?|leading|ahead|trails?|call(s|ed)?|projects?|projected|wins?|won|concedes?|conceded|votes? in|margin|exit polls?|polls? clos|early vote|mail ballots?|absentee|county|counties|returns|race call|decision desk|AP)\b/i;
const ELECTION_WORDS = /\b(senate|senator|race call|projects?|projected|wins?|won|concedes?|conceded|votes? counted|turnout|precincts?|polls close|exit poll|ballots?|election)\b/i;

export const excerpt = (s, n = 240) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : t;
};

function postUrl(p) {
  return `https://bsky.app/profile/${p.author.handle}/post/${p.uri.split("/").pop()}`;
}

// Which race a piece of text is about (state name plus "Senate", or a candidate's full name).
export function raceOf(races, text) {
  const t = String(text || "");
  const hits = races.filter((r) =>
    (new RegExp(`\\b${r.state}\\b`, "i").test(t) && /senat/i.test(t)) ||
    t.includes(r.left.name) || t.includes(r.right.name) ||
    (new RegExp(`\\b${r.left.last}\\b`).test(t) && new RegExp(`\\b${r.right.last}\\b`).test(t)));
  return hits.length === 1 ? hits[0] : null;
}

// A race call in a call source's post: "<candidate> wins/defeats/is reelected ..." about a race.
export function detectCall(races, post, now = Date.now()) {
  const t = post.text || "";
  if (/\b(could|would|might|may|can|if|whether|chance|odds|likely to|expected to|projected to lead|leads?|leading|ahead)\b[^.]{0,30}\b(wins?|win)\b/i.test(t)) return null;
  if (/\?/.test(t.split(/[.!]/)[0])) return null;
  const race = raceOf(races, t);
  if (!race) return null;
  if (Date.parse(post.time) < Date.parse(race.polls_close) - 5 * 60000) return null;
  if (Date.parse(post.time) > now + 60000) return null;
  const won = (c) => new RegExp(`\\b${c.last}\\b[^.]{0,60}\\b(wins|won|win|is re-?elected|re-?elected|defeats|defeated|holds|flips|projected to win|will win|keeps)\\b`, "i").test(t);
  const l = won(race.left), r = won(race.right);
  if (l === r) return null;
  if (!/\b(AP|Associated Press|race call|projects|projected|Decision Desk|DDHQ|BREAKING|calls?)\b/i.test(t)) return null;
  return { race: race.id, winner: l ? "left" : "right" };
}

async function followerCounts(handles, known) {
  const todo = [...new Set(handles)].filter((h) => !(h in known));
  for (let i = 0; i < todo.length; i += 25) {
    try {
      const qs = todo.slice(i, i + 25).map((h) => "actors=" + encodeURIComponent(h)).join("&");
      const j = await getJSON(`${PROFILES}?${qs}`);
      for (const p of j.profiles || []) known[p.handle] = p.followersCount || 0;
    } catch (e) {
      log(`[bluesky] follower counts: ${e.message}`);
    }
    for (const h of todo.slice(i, i + 25)) if (!(h in known)) known[h] = 0;
  }
  return known;
}

export async function bluesky(cfg, races, health, cache) {
  const items = [];
  const accounts = cfg.accounts || [];
  const since = Date.now() - 18 * 3600e3;
  await Promise.all(accounts.map(async (acct) => {
    try {
      const j = await getJSON(`${FEED}?actor=${encodeURIComponent(acct.handle)}&limit=30&filter=posts_no_replies`);
      for (const f of j.feed || []) {
        const p = f.post;
        if (f.reason) continue; // reposts
        const text = (p.record && p.record.text) || "";
        const time = p.record && p.record.createdAt || p.indexedAt;
        if (Date.parse(time) < since) continue;
        const race = raceOf(races, text);
        if (!race && !(acct.all_election && ELECTION_WORDS.test(text))) continue;
        items.push({
          id: p.uri, kind: "post", via: "account", race: race ? race.id : null, time,
          author: acct.name || p.author.displayName || p.author.handle, handle: p.author.handle,
          text: excerpt(text), url: postUrl(p), callSource: !!acct.calls, callBy: acct.calls || null, fullText: text,
        });
      }
      health.push({ name: `bluesky @${acct.handle}`, ok: true });
    } catch (e) {
      log(`[bluesky] ${acct.handle}: ${e.message}`);
      health.push({ name: `bluesky @${acct.handle}`, ok: false, detail: e.message });
    }
  }));

  // Keyword searches.
  const listed = new Set(accounts.map((a) => a.handle));
  const found = [];
  const queries = [...(cfg.queries || []), ...races.flatMap((r) => (r.bsky_queries || []).map((q) => ({ q, race: r.id })))];
  await Promise.all(queries.map(async (entry) => {
    const q = typeof entry === "string" ? entry : entry.q;
    try {
      const j = await getJSON(`${SEARCH}?q=${encodeURIComponent(q)}&sort=latest&limit=25`, { timeout: 12000 });
      for (const p of j.posts || []) found.push({ p, race: entry.race || null });
    } catch (e) {
      log(`[bluesky] search "${q}": ${e.message}`);
      health.push({ name: `bluesky search "${q}"`, ok: false, detail: e.message });
    }
  }));
  cache.followers = cache.followers || {};
  await followerCounts(found.map((f) => f.p.author.handle).filter((h) => !listed.has(h)), cache.followers);
  const min = cfg.min_followers || 10000;
  const seenText = new Set();
  for (const { p, race: hint } of found) {
    if (listed.has(p.author.handle)) continue;
    if ((cache.followers[p.author.handle] || 0) < min) continue;
    const text = (p.record && p.record.text) || "";
    const key = text.toLowerCase().replace(/[^a-z]/g, "").slice(0, 80);
    if (seenText.has(key) || !RESULT_WORDS.test(text) || text.replace(/https?:\/\/\S+|\S+\.\S+\/\S*/g, "").trim().length < 40) continue;
    seenText.add(key);
    const time = p.record && p.record.createdAt || p.indexedAt;
    if (Date.parse(time) < since) continue;
    const race = raceOf(races, text);
    items.push({
      id: p.uri, kind: "post", via: "search", race: race ? race.id : hint, time,
      author: p.author.displayName || p.author.handle, handle: p.author.handle, text: excerpt(text), url: postUrl(p),
    });
  }
  return items;
}

function rssItems(xml) {
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const tag = (n) => {
      const x = m[1].match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`));
      return x ? x[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim() : "";
    };
    out.push({ title: tag("title"), link: tag("link"), date: tag("pubDate"), source: tag("source") });
  }
  return out;
}

export async function news(races, health) {
  const items = [];
  const since = Date.now() - 24 * 3600e3;
  await Promise.all(races.map(async (race) => {
    if (!race.news_query) return;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(race.news_query + " when:1d")}&hl=en-US&gl=US&ceid=US:en`;
    try {
      const xml = await get(url);
      for (const it of rssItems(xml).slice(0, 15)) {
        const time = new Date(it.date).toISOString();
        if (Date.parse(time) < since) continue;
        let title = it.title, outlet = it.source;
        if (outlet && title.endsWith(` - ${outlet}`)) title = title.slice(0, -(outlet.length + 3));
        items.push({ id: it.link, kind: "news", race: race.id, time, outlet: outlet || "News", text: excerpt(title, 200), url: it.link });
      }
      health.push({ name: `news ${race.id}`, ok: true });
    } catch (e) {
      log(`[news] ${race.id}: ${e.message}`);
      health.push({ name: `news ${race.id}`, ok: false, detail: e.message });
    }
  }));
  return items;
}

// Featured accounts (config/feed.json "featured"): every post and thread reply of theirs from the
// last 36 hours, not only ones naming a race, for the pinned panel and the race cards.
export async function featured(cfg, races, health) {
  const out = [];
  for (const acct of cfg || []) {
    try {
      const j = await getJSON(`${FEED}?actor=${encodeURIComponent(acct.handle)}&limit=50&filter=posts_and_author_threads`);
      const posts = [];
      for (const f of j.feed || []) {
        if (f.reason) continue; // reposts of other people's posts
        const p = f.post;
        const text = (p.record && p.record.text) || "";
        const time = (p.record && p.record.createdAt) || p.indexedAt;
        if (Date.now() - Date.parse(time) > 36 * 3600e3) continue;
        const race = raceOf(races, text);
        const quoted = p.embed && p.embed.record && (p.embed.record.value || (p.embed.record.record && p.embed.record.record.value));
        posts.push({
          id: p.uri, time, text: excerpt(text, 300), url: postUrl(p), race: race ? race.id : null,
          images: p.embed && p.embed.images ? p.embed.images.length : (p.embed && p.embed.media && p.embed.media.images ? p.embed.media.images.length : 0),
          quote: quoted && quoted.text ? excerpt(quoted.text, 140) : null,
        });
      }
      posts.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
      out.push({ handle: acct.handle, name: acct.name, about: acct.about || "", posts: posts.slice(0, 40) });
      health.push({ name: `featured @${acct.handle}`, ok: true });
    } catch (e) {
      log(`[featured] ${acct.handle}: ${e.message}`);
      health.push({ name: `featured @${acct.handle}`, ok: false, detail: e.message });
    }
  }
  return out;
}
