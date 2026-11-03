// Runs one count reader once and prints a summary. For testing a reader against a real file,
// including a past election's. Usage: node scripts/try_reader.mjs <race id> [url] [left name] [right name]
import fs from "node:fs";
import { allCounts } from "./sources/states.mjs";
const [id, url, leftName, rightName] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(new URL("../config/races.json", import.meta.url)));
const race = structuredClone(cfg.races.find((r) => r.id === id));
if (url) race.counts.url = url;
if (leftName) race.left = { name: leftName, last: leftName.split(" ").pop(), party: "D" };
if (rightName) race.right = { name: rightName, last: rightName.split(" ").pop(), party: "R" };
const health = [];
const out = await allCounts([race], {}, {}, health);
const c = out[id];
console.log(id, JSON.stringify(health));
if (c && c.units) {
  const t = (c.units.length ? c.units : [c.statewide]).reduce((a, u) => ({ left: a.left + u.left, right: a.right + u.right, other: a.other + u.other }), { left: 0, right: 0, other: 0 });
  console.log(`  ok=${c.ok} units=${c.units.length} complete=${c.units.filter((u) => u.complete).length} totals=${JSON.stringify(t)} precincts=${JSON.stringify(c.precincts)} statewide=${JSON.stringify(c.statewide)}`);
  console.log("  first units:", JSON.stringify(c.units.slice(0, 3)));
} else console.log("  ", JSON.stringify(c));
process.exit(0);
