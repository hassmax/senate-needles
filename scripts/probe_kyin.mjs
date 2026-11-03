// One-off look at Indiana's results data files (which one holds the House districts).
import { UA } from "./lib.mjs";
const short = (s, n) => s.replace(/\s+/g, " ").slice(0, n);
const get = async (u) => { const r = await fetch(u, { headers: { "User-Agent": UA } }); return [r.status, r.headers.get("content-type"), await r.text()]; };
const base = "https://enr.indianavoters.in.gov/site/";
const [, , html] = await get(base + "index.html");
const main = [...html.matchAll(/src="(Scripts\/EnrAngular[^"]*enrMainController[^"]*)"/g)].map((m) => m[1])[0];
const [, , js] = await get(base + main);
for (const k of ["officeJsonFiles", "jurisdictionJsonFiles", "statewideElectionsR", "fetchMultipleJson", "fileName"]) {
  let i = js.indexOf(k), n = 0;
  while (i >= 0 && n < 3) { console.log(`near ${k}:`, short(js.slice(Math.max(0, i - 300), i + 700), 1000)); i = js.indexOf(k, i + 1); n++; }
}
const [, , v] = await get(base + "data/version.json");
const ver = JSON.parse(v).Root.Version.VERSION_CODE;
for (const f of ["settings", "statewideElectionsR", "statewideElectionsC"]) {
  for (const name of [`${f}_${ver}`, f]) {
    for (const dir of ["data/", "clientData/"]) {
      const [st, ct, t] = await get(base + dir + name + ".json");
      if (st === 200) { console.log(`\nIN ${dir}${name}.json ${t.length} bytes:`, short(t, 2500)); }
    }
  }
}
process.exit(0);
