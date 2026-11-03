// Builds site/data/baseline/<ST>.json from the 2024 presidential results by county (Alaska: by state
// house district), from github.com/tonmcg/US_County_Level_Election_Results_08-24 (compiled from
// official returns). Each unit: fips, name, d (Harris), r (Trump), total (all candidates).
// Usage: node scripts/make_baseline.mjs path/to/2024_US_County_Level_Presidential_Results.csv
import fs from "node:fs";
const STATES = { AK: "Alaska", IA: "Iowa", KS: "Kansas", ME: "Maine", OH: "Ohio", TX: "Texas", MI: "Michigan",
  NE: "Nebraska", FL: "Florida", SC: "South Carolina" };
const rows = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
for (const [st, name] of Object.entries(STATES)) {
  const units = rows.filter((r) => r[0] === name).map((r) => ({
    fips: r[1], name: r[2], d: +r[4], r: +r[3], total: +r[5],
  }));
  const sum = (k) => units.reduce((a, u) => a + u[k], 0);
  const out = { state: st, source: "2024 presidential results by county (tonmcg/US_County_Level_Election_Results_08-24)",
    d: sum("d"), r: sum("r"), total: sum("total"), units };
  fs.writeFileSync(`site/data/baseline/${st}.json`, JSON.stringify(out));
  console.log(st, units.length, "units", "margin D-R", ((out.d - out.r) / out.total * 100).toFixed(1));
}
