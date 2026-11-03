// Reads FiftyPlusOne's public Senate forecast (G. Elliott Morris's model) from the page data its
// SvelteKit site serves at <page>/__data.json, and prints anything about the tracked races.
import { UA } from "./lib.mjs";
const short = (s, n) => s.replace(/\s+/g, " ").slice(0, n);
for (const url of ["https://fiftyplusone.news/forecast/senate/__data.json", "https://fiftyplusone.news/forecast/senate/__data.json?x-sveltekit-invalidated=01"]) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    const t = await res.text();
    console.log(`\n### ${url} -> ${res.status} ${res.headers.get("content-type")} ${t.length} bytes`);
    console.log("head:", short(t, 2500));
    for (const k of ["Maine", "Ohio", "Texas", "Alaska", "Iowa", "Kansas", "Nebraska", "Michigan", "Florida", "South Carolina", "Talarico", "Peltola"]) {
      let i = t.indexOf(k), n = 0;
      while (i >= 0 && n < 2) { console.log(`near ${k}:`, short(t.slice(Math.max(0, i - 250), i + 450), 700)); i = t.indexOf(k, i + 1); n++; }
    }
    if (res.ok) break;
  } catch (e) { console.log(url, e.message); }
}
process.exit(0);
