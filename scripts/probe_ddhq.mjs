// One-off look at Decision Desk HQ's public pages (forecast, a race page, terms, robots.txt),
// its Bluesky accounts, and Polymarket's Senate-control market. Nothing is written.
import { UA } from "./lib.mjs";
const short = (s, n) => s.replace(/\s+/g, " ").slice(0, n);
async function look(u, words = []) {
  try {
    const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "*/*" }, signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    console.log(`\n=== ${u}\nstatus ${r.status} type ${r.headers.get("content-type")} bytes ${t.length}`);
    return t;
  } catch (e) { console.log(`\n=== ${u}\nFAILED ${e.message}`); return ""; }
}
function around(t, re, n = 6, w = 260) {
  let k = 0;
  for (const m of t.matchAll(re)) { if (k++ >= n) break; console.log(`  …${short(t.slice(Math.max(0, m.index - w), m.index + w), 2 * w + 40)}…`); }
}
const robots = await look("https://votes.decisiondeskhq.com/robots.txt");
console.log(short(robots, 1500));
for (const u of ["https://votes.decisiondeskhq.com/forecast/2026/senate", "https://votes.decisiondeskhq.com/races/2026-11-03/iowa-us-senate-general-election/forecast", "https://votes.decisiondeskhq.com/races/2026-11-03/iowa-us-senate-general-election"]) {
  const t = await look(u);
  if (!t) continue;
  console.log("scripts:", [...t.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]).slice(0, 15).join(" | "));
  console.log("links with terms/legal:", [...new Set([...t.matchAll(/href=["']([^"']*(?:terms|legal|privacy|license)[^"']*)["']/gi)].map((m) => m[1]))].join(" | "));
  console.log("api-ish urls:", [...new Set([...t.matchAll(/https?:\/\/[^"'\s<>\\]*(?:api|json|graphql|cdn)[^"'\s<>\\]*/gi)].map((m) => m[0]))].slice(0, 25).join(" | "));
  const nd = t.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  console.log("__NEXT_DATA__:", nd ? nd[1].length : "none", "| self.__next_f:", (t.match(/self\.__next_f\.push/g) || []).length);
  const body = nd ? nd[1] : t;
  around(body, /prob|win_?chance|chance/gi, 10, 220);
  around(body, /Ohio|Texas|Nebraska/g, 4, 260);
}
for (const u of ["https://votes.decisiondeskhq.com/terms", "https://votes.decisiondeskhq.com/terms-of-service", "https://votes-docs.decisiondeskhq.com/terms-of-use", "https://votes-docs.decisiondeskhq.com/terms-of-service", "https://ddhq.io/terms", "https://ddhq.io/terms-of-service", "https://decisiondeskhq.com/terms-of-service"]) {
  const t = await look(u);
  if (t) around(t.replace(/<[^>]+>/g, " "), /scrap|automat|crawl|robot|spider|harvest|reproduc|commercial use|republish|redistribut/gi, 8, 300);
}
const bs = await look("https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles?actors=decisiondeskhq.com&actors=ddhq.io&actors=decisiondeskhq.bsky.social&actors=ddhq.bsky.social&actors=decisiondesk.bsky.social");
try { for (const p of JSON.parse(bs).profiles || []) console.log("  profile", p.handle, "|", p.displayName, "| followers", p.followersCount, "| posts", p.postsCount); } catch { console.log(short(bs, 400)); }
const sr = await look("https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors?q=Decision%20Desk%20HQ&limit=8");
try { for (const p of JSON.parse(sr).actors || []) console.log("  actor", p.handle, "|", p.displayName); } catch { console.log(short(sr, 400)); }
for (const q of ["Senate control 2026", "Which party will win the Senate in 2026"]) {
  const t = await look(`https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(q)}&limit_per_type=8`);
  try { for (const ev of JSON.parse(t).events || []) { console.log("  poly", ev.slug, "|", ev.title, "| closed", ev.closed, "| vol", Math.round(ev.volume || 0)); for (const m of (ev.markets || []).slice(0, 4)) console.log("     ", m.groupItemTitle || m.question, m.outcomePrices, m.closed); } } catch { console.log(short(t, 300)); }
}
process.exit(0);
