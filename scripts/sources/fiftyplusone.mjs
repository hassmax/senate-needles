// G. Elliott Morris's Senate forecast, from FiftyPlusOne's public forecast page
// (fiftyplusone.news/forecast/senate). The page's data is SvelteKit's packed format: a flat list
// where objects hold positions of their values in the same list. `unpack` rebuilds it.
import { getJSON } from "../lib.mjs";

export const FPO_URL = "https://fiftyplusone.news/forecast/senate";

export function unpack(data, i = 0, seen = new Map()) {
  if (typeof i !== "number") return i;
  if (i === -1) return undefined;
  if (i < 0) return null;
  if (seen.has(i)) return seen.get(i);
  const v = data[i];
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) {
    if (typeof v[0] === "string" && ["Date", "Set", "Map", "BigInt", "RegExp"].includes(v[0])) return v[0] === "Date" ? v[1] : null;
    const out = [];
    seen.set(i, out);
    for (const k of v) out.push(unpack(data, k, seen));
    return out;
  }
  const out = {};
  seen.set(i, out);
  for (const [k, idx] of Object.entries(v)) out[k] = unpack(data, idx, seen);
  return out;
}

// Every object in the page data that looks like a Senate race forecast (has dem_chance and a state).
export function forecastRaces(json) {
  const found = [];
  const walk = (x, depth = 0) => {
    if (!x || typeof x !== "object" || depth > 12) return;
    if (!Array.isArray(x) && "dem_chance" in x && "state" in x) { found.push(x); return; }
    for (const v of Array.isArray(x) ? x : Object.values(x)) walk(v, depth + 1);
  };
  for (const node of json.nodes || []) if (node && node.data) walk(unpack(node.data));
  return found;
}

export async function fiftyplusone(races) {
  const json = await getJSON(`${FPO_URL}/__data.json`, { timeout: 20000 });
  const rows = forecastRaces(json);
  const out = {};
  for (const race of races) {
    const row = rows.find((r) => String(r.state).toUpperCase() === race.id || String(r.name || "").toLowerCase() === race.state.toLowerCase());
    if (!row) continue;
    const pct = (x) => (x == null ? null : x > 1 ? x / 100 : x);
    const d = pct(row.dem_chance), r = pct(row.rep_chance), ind = pct(row.ind_chance);
    const left = race.left.party === "I" ? ind : d;
    if (left == null || r == null) continue;
    out[race.id] = { p_left: left / ((left + r) || 1), raw: { dem: d, rep: r, ind }, rating: row.rating || null };
  }
  return out;
}
