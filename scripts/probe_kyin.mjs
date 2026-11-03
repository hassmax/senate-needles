// One-off look at Indiana's results data files and Kentucky's statewide results page.
import { UA } from "./lib.mjs";
const short = (s, n) => s.replace(/\s+/g, " ").slice(0, n);
const get = async (u) => { const r = await fetch(u, { headers: { "User-Agent": UA } }); return [r.status, r.headers.get("content-type"), await r.text()]; };
// Indiana: which JSON files the site asks for
const base = "https://enr.indianavoters.in.gov/site/";
const [, , html] = await get(base + "index.html");
const scripts = [...html.matchAll(/src="(Scripts\/EnrAngular[^"]+)"/g)].map((m) => m[1]);
const names = new Set();
for (const s of scripts) {
  const [, , js] = await get(base + s);
  for (const m of js.matchAll(/fetch(?:Single|Multiple)Json\(\s*([^,]+),/g)) names.add(`${s.split("/").pop()}: ${short(m[1], 120)}`);
  for (const m of js.matchAll(/registerVersion\(([^)]*)\)/g)) names.add(`${s.split("/").pop()} version: ${short(m[1], 120)}`);
  for (const m of js.matchAll(/"([A-Za-z]+(?:Data|List|Info|Results|Version|Races|Offices)[A-Za-z]*)"/g)) names.add(`${s.split("/").pop()} str: ${m[1]}`);
}
console.log("IN fetches:\n " + [...names].join("\n "));
for (const f of ["version", "versionInfo", "electionVersion", "currentVersion"]) {
  for (const dir of ["data/", "clientData/"]) {
    const [st, ct, t] = await get(base + dir + f + ".json");
    if (st === 200) console.log(`IN ${dir}${f}.json ->`, ct, short(t, 600));
  }
}
// Kentucky statewide page
const [st, ct, ky] = await get("https://vrsws.sos.ky.gov/liveresults/Statewide");
console.log("\nKY Statewide", st, ct, ky.length);
for (const k of ["UNITED STATES SENATOR", "U.S. SENATOR", "Senator", "Precincts", "precinct", "Reporting"]) {
  const i = ky.indexOf(k);
  if (i >= 0) console.log(`near ${k}:`, short(ky.slice(Math.max(0, i - 400), i + 2400), 2800));
}
process.exit(0);
