// Prints the text of G. Elliott Morris's public Strength In Numbers posts (via Substack's post
// API), and any lines mentioning the races tracked here. For finding his forecast numbers.
import { UA } from "./lib.mjs";
const slugs = process.argv.slice(2);
const STATES = /Alaska|Florida|Iowa|Kansas|Maine|Michigan|Nebraska|Ohio|South Carolina|Texas|Senate/;
for (const slug of slugs) {
  for (const host of ["www.gelliottmorris.com", "blog.fiftyplusone.news"]) {
    try {
      const res = await fetch(`https://${host}/api/v1/posts/${slug}`, { headers: { "User-Agent": UA } });
      if (!res.ok) { console.log(`\n### ${host}/${slug}: HTTP ${res.status}`); continue; }
      const j = await res.json();
      const html = j.body_html || "";
      const text = html.replace(/<(br|p|li|h\d|tr|div)[^>]*>/gi, "\n").replace(/<td[^>]*>/gi, " | ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#8217;/g, "'").replace(/\n\s*\n+/g, "\n");
      console.log(`\n### ${host}/${slug} | ${j.title} | audience=${j.audience} | ${j.post_date} | ${text.length} chars`);
      const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((l) => /csv|json|forecast|github|data|sheets|datawrapper/i.test(l));
      if (links.length) console.log("links:", [...new Set(links)].join(" | "));
      const imgs = [...html.matchAll(/(?:src|data-src)="([^"]*datawrapper[^"]*)"/g)].map((m) => m[1]);
      if (imgs.length) console.log("datawrapper:", [...new Set(imgs)].join(" | "));
      console.log(text.split("\n").filter((l) => STATES.test(l) || /\d+(\.\d+)?%|\bin\s*\d+\b/.test(l)).slice(0, 120).join("\n").slice(0, 12000));
      break;
    } catch (e) { console.log(`\n### ${host}/${slug}: ${e.message}`); }
  }
}
for (const feed of ["https://www.gelliottmorris.com/feed"]) {
  try {
    const xml = await (await fetch(feed, { headers: { "User-Agent": UA } })).text();
    console.log("\n### feed items:", [...xml.matchAll(/<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>[\s\S]*?<link>([^<]+)<\/link>[\s\S]*?<pubDate>([^<]+)/g)].slice(0, 12).map((m) => `\n  ${m[3]} | ${m[1]} | ${m[2]}`).join(""));
  } catch (e) { console.log("feed", e.message); }
}
process.exit(0);
