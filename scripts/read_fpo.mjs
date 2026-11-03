// Looks at FiftyPlusOne's public Senate forecast page (G. Elliott Morris's model) for the data it
// loads: embedded page data, script files, and JSON/CSV addresses mentioning the forecast.
import { UA } from "./lib.mjs";
const pages = ["https://fiftyplusone.news/forecast/senate", "https://www.fiftyplusone.news/forecast/senate"];
const short = (s, n) => s.replace(/\s+/g, " ").slice(0, n);
for (const url of pages) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
    const html = await res.text();
    console.log(`\n### ${url} -> ${res.status} ${res.url} ${html.length} bytes ${res.headers.get("content-type")}`);
    const next = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (next) console.log("NEXT_DATA:", short(next[1], 3000));
    console.log("HTML:", short(html, 3200));
    const scripts = [...html.matchAll(/(?:<script[^>]+src|<link[^>]+href)=["']([^"']+\.(?:js|mjs)[^"']*)["']/g)].map((m) => new URL(m[1], res.url).href);
    console.log("scripts:", scripts.join(" | "));
    const urls = new Set([...html.matchAll(/["'(]((?:https?:)?\/\/[^"')\s]+\.(?:json|csv)[^"')\s]*|\/[^"')\s]+\.(?:json|csv)[^"')\s]*)/g)].map((m) => m[1]));
    console.log("data urls in page:", [...urls].join(" | "));
    for (const k of ["Maine", "Ohio", "Talarico", "Peltola"]) {
      const i = html.indexOf(k);
      if (i >= 0) console.log(`near ${k}:`, short(html.slice(Math.max(0, i - 300), i + 600), 900));
    }
    for (const src of scripts.slice(0, 15)) {
      try {
        const js = await (await fetch(src, { headers: { "User-Agent": UA } })).text();
        const found = new Set([...js.matchAll(/["'`]((?:https?:\/\/[^"'`\s]+)?\/[^"'`\s]*?(?:\.json|\.csv|\/api\/)[^"'`\s]*)["'`]/g)].map((m) => m[1]));
        if (found.size) console.log(`in ${src.slice(0, 90)}:`, [...found].slice(0, 25).join(" | "));
      } catch (e) { console.log("script", src, e.message); }
    }
    break;
  } catch (e) { console.log(url, e.message); }
}
process.exit(0);
