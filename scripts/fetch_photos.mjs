// Finds a freely licensed photo of each candidate on Wikimedia Commons (through the English
// Wikipedia article's lead image), saves a small copy in site/assets/candidates/, and records the
// author and licence in site/assets/candidates/credits.json (shown on the page). Only public-domain
// and Creative Commons images are kept. Run by the "Candidate photos" workflow (this sandbox can't
// reach Wikipedia). A candidate's article can be named by hand with "wiki" in config/races.json.
import fs from "node:fs";
import path from "node:path";
const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const cfg = JSON.parse(fs.readFileSync(path.join(root, "config/races.json"), "utf8"));
const OUT = path.join(root, "site/assets/candidates");
const UA = "senate-needles/1.0 (+https://github.com/hassmax/senate-needles)";
const API = "https://en.wikipedia.org/w/api.php?format=json&formatversion=2&";
const get = async (q) => (await fetch(API + q, { headers: { "User-Agent": UA } })).json();
const strip = (h) => String(h || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const FREE = /public domain|^pd|cc0|cc[ -]by/i;
fs.mkdirSync(OUT, { recursive: true });
const credits = {};
for (const race of cfg.races) {
  for (const side of ["left", "right"]) {
    const c = race[side], key = `${race.id}-${side}`;
    try {
      let title = c.wiki;
      if (!title) {
        const s = await get(`action=query&list=search&srlimit=5&srsearch=${encodeURIComponent(`${c.name} ${race.state} politician`)}`);
        const hit = (s.query.search || []).find((h) => h.title.includes(c.last) && !/election|list of|district/i.test(h.title));
        if (!hit) { console.log(`${key} ${c.name}: no article found`); continue; }
        title = hit.title;
      }
      const pi = await get(`action=query&prop=pageimages|description&piprop=name&redirects=1&titles=${encodeURIComponent(title)}`);
      const page = pi.query.pages[0];
      if (!page.pageimage) { console.log(`${key} ${c.name}: article "${page.title}" has no lead image`); continue; }
      const ii = await get(`action=query&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=160&titles=${encodeURIComponent("File:" + page.pageimage)}`);
      const info = ii.query.pages[0].imageinfo && ii.query.pages[0].imageinfo[0];
      const md = (info && info.extmetadata) || {};
      const lic = strip(md.LicenseShortName && md.LicenseShortName.value);
      if (!info || !FREE.test(lic) || /non-?free|fair use/i.test(lic)) { console.log(`${key} ${c.name}: "${page.title}" image not freely licensed (${lic || "unknown"})`); continue; }
      const ext = (info.thumburl.match(/\.(jpe?g|png|webp)(?:$|\?)/i) || [, "jpg"])[1].toLowerCase().replace("jpeg", "jpg");
      const file = `${key}.${ext}`;
      const img = await fetch(info.thumburl, { headers: { "User-Agent": UA } });
      if (!img.ok) throw new Error(`image HTTP ${img.status}`);
      fs.writeFileSync(path.join(OUT, file), Buffer.from(await img.arrayBuffer()));
      credits[key] = { name: c.name, file, article: page.title, description: page.description || "", license: lic,
        author: strip(md.Artist && md.Artist.value).slice(0, 120) || "unknown", source: info.descriptionurl };
      console.log(`${key} ${c.name}: OK "${page.title}" (${page.description || ""}) | ${lic} | ${credits[key].author} | ${info.descriptionurl}`);
    } catch (e) { console.log(`${key} ${c.name}: FAILED ${e.message}`); }
  }
}
fs.writeFileSync(path.join(OUT, "credits.json"), JSON.stringify(credits, null, 2) + "\n");
