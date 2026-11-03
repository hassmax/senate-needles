// One-off look at Decision Desk HQ's Bluesky posts (its forecast and race-call posts), read through
// Bluesky's public API. DDHQ's own website is not read: its terms forbid scraping. Nothing is written.
import { UA } from "./lib.mjs";
let cursor = "", n = 0;
for (let page = 0; page < 4; page++) {
  const r = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=decisiondeskhq.bsky.social&limit=100&filter=posts_no_replies${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`, { headers: { "User-Agent": UA } });
  const j = await r.json();
  for (const f of j.feed || []) {
    const p = f.post, t = (p.record && p.record.text) || "";
    n++;
    if (/%|forecast|project|call/i.test(t)) console.log(`${p.indexedAt} https://bsky.app/profile/decisiondeskhq.bsky.social/post/${p.uri.split("/").pop()}\n   ${t.replace(/\s+/g, " ")}`);
  }
  cursor = j.cursor;
  if (!cursor) break;
}
console.log("posts read:", n);
process.exit(0);
