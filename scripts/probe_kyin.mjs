// One-off look at Indiana's office list and the U.S. House office file.
import { UA } from "./lib.mjs";
const short = (s, n) => s.replace(/\s+/g, " ").slice(0, n);
const getJ = async (u) => { const r = await fetch(u, { headers: { "User-Agent": UA } }); const t = await r.text(); return [r.status, t]; };
const base = "https://enr.indianavoters.in.gov/site/data/";
const [, st] = await getJ(base + "settings.json");
const vt = JSON.parse(st).Root.VersionType;
const [s1, list] = await getJ(base + `statewideElectionsC_${vt}.json`);
console.log("office list", s1, list.length, short(list, 3000));
let ids = [];
try {
  const j = JSON.parse(list); const root = j.Root || j;
  const L = [].concat(root.List || []);
  for (const o of L) for (const it of [].concat((o.Items && o.Items.Item) || [])) ids.push([it.OFFICECATEGORYID, JSON.stringify(it).slice(0, 200)]);
} catch (e) { console.log("parse", e.message); }
console.log("categories:", ids.map((x) => x[1]).join("\n "));
for (const [id] of ids.filter((x) => /Representative|Congress|U\.?S\.? House|United States/i.test(x[1])).slice(0, 2)) {
  const [s2, t] = await getJ(base + `OffCatC_${id}_${vt}.json`);
  console.log(`\nOffCatC_${id}_${vt}.json`, s2, t.length, short(t, 4000));
}
process.exit(0);
