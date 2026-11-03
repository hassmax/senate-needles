// Prints FiftyPlusOne's Senate forecast rows for the tracked races, the fields they carry, and the
// site's terms text, from the public page data.
import fs from "node:fs";
import { getJSON } from "./lib.mjs";
import { FPO_URL, unpack, forecastRaces, fiftyplusone } from "./sources/fiftyplusone.mjs";
const races = JSON.parse(fs.readFileSync(new URL("../config/races.json", import.meta.url))).races;
const json = await getJSON(`${FPO_URL}/__data.json`);
const rows = forecastRaces(json);
console.log("forecast rows:", rows.length, "fields:", Object.keys(rows[0] || {}).join(","));
for (const r of rows.filter((x) => races.some((y) => y.state === x.name || y.id === String(x.state).toUpperCase())))
  console.log(JSON.stringify(r).slice(0, 700));
const root = unpack(json.nodes[0].data);
const terms = root && root.websiteText && root.websiteText.terms;
console.log("\nTERMS:", JSON.stringify(terms).slice(0, 4000));
const keys = new Set();
const walk = (x, d = 0) => { if (!x || typeof x !== "object" || d > 8) return; for (const [k, v] of Object.entries(x)) { if (/margin|mean|median|updated|timestamp|date|run|sims|seats|control/i.test(k)) keys.add(k); walk(v, d + 1); } };
for (const n of json.nodes || []) if (n && n.data) walk(unpack(n.data));
console.log("\nkeys like margin/updated:", [...keys].join(", "));
console.log("\nparsed:", JSON.stringify(await fiftyplusone(races)));
process.exit(0);
