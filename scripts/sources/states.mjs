// Official election-night counts, one reader per kind of state results site. Each returns
// {source, url, updated, units: [{name, fips?, left, right, other, complete}], precincts: [in, total]}.
// A reader that fails leaves the race on its last good count (marked with the error).
import { get, getJSON, unzip, parseDelimited, num, sideOf, log } from "../lib.mjs";

const SENATE_RE = /united states senat|u\.?\s?s\.?\s+senat|us senat|senator,? u\.?s|^senat(e|or)$/i;

// ---------- Florida: the Division of Elections' tab-separated election-night file ----------
async function florida(race, cfg) {
  const url = cfg.url || "https://fldoselectionfiles.elections.myflorida.com/enightfilespublic/20261103_ElecResultsFL.txt";
  const rows = parseDelimited(await get(url), "\t");
  const units = new Map();
  let pIn = 0, pAll = 0;
  const seenCounty = new Set();
  for (const r of rows) {
    const office = r.OfficeDesc || r.RaceName || "";
    if (!SENATE_RE.test(office)) continue;
    const county = r.CountyName || r.CountyCode;
    const name = [r.CanNameFirst, r.CanNameLast].filter(Boolean).join(" ");
    const side = sideOf(race, { name, party: r.PartyCode || r.PartyName });
    const u = units.get(county) || { name: county, left: 0, right: 0, other: 0, complete: false };
    u[side] += num(r.CanVotes);
    const tp = num(r.Precincts), rp = num(r.PrecinctsReporting);
    u.complete = tp > 0 && rp >= tp;
    if (!seenCounty.has(county)) { seenCounty.add(county); pIn += rp; pAll += tp; }
    units.set(county, u);
  }
  if (!units.size) throw new Error("no Senate rows in the Florida file yet");
  return { source: "Florida Division of Elections", url: "https://results.elections.myflorida.com/", units: [...units.values()], precincts: pAll ? [pIn, pAll] : null };
}

// ---------- Clarity (Scytl) election-night reporting: detailed XML by county ----------
async function clarityEid(st, cfg, cache) {
  if (cfg.eid) return cfg.eid;
  if (cache.eid) return cache.eid;
  for (const page of cfg.discover || []) {
    try {
      const html = await get(page);
      const m = [...html.matchAll(new RegExp(`clarityelections\\.com/+${st}/+(\\d{5,7})`, "gi"))].map((x) => +x[1]);
      if (m.length) { cache.eid = String(Math.max(...m)); return cache.eid; }
    } catch (e) {
      log(`[clarity] ${st} discover ${page}: ${e.message}`);
    }
  }
  throw new Error("current Clarity election id not found");
}

export function parseClarityXml(xml, race) {
  const ts = (xml.match(/<Timestamp>([^<]+)<\/Timestamp>/) || [])[1];
  const contests = [...xml.matchAll(/<Contest\b([^>]*)>([\s\S]*?)<\/Contest>/g)];
  const contest = contests.find((c) => {
    const text = (c[1].match(/text="([^"]*)"/) || [])[1] || "";
    return SENATE_RE.test(text) && !/state senat|district/i.test(text);
  });
  if (!contest) throw new Error("no U.S. Senate contest in the Clarity file");
  const body = contest[2];
  const attr = (s, k) => (s.match(new RegExp(`\\b${k}="([^"]*)"`)) || [])[1];
  const units = new Map();
  for (const m of body.matchAll(/<County\b([^>]*)\/>/g)) {
    const name = attr(m[1], "name");
    if (!name || units.has(name)) continue;
    const part = num(attr(m[1], "precinctsParticipating")), rep = num(attr(m[1], "precinctsReported"));
    if (attr(m[1], "votes") != null) continue;
    units.set(name, { name, left: 0, right: 0, other: 0, complete: part > 0 && rep >= part });
  }
  for (const ch of body.matchAll(/<Choice\b([^>]*)>([\s\S]*?)<\/Choice>/g)) {
    const side = sideOf(race, { name: attr(ch[1], "text"), party: attr(ch[1], "party") });
    for (const vt of ch[2].matchAll(/<VoteType\b[^>]*>([\s\S]*?)<\/VoteType>/g)) {
      for (const c of vt[1].matchAll(/<(?:County|Precinct)\b([^>]*)\/>/g)) {
        const name = attr(c[1], "name");
        const u = units.get(name) || { name, left: 0, right: 0, other: 0, complete: false };
        u[side] += num(attr(c[1], "votes"));
        units.set(name, u);
      }
    }
  }
  const pIn = num(attr(contest[1], "precinctsReported")), pAll = num(attr(contest[1], "precinctsParticipating"));
  return { units: [...units.values()], precincts: pAll ? [pIn, pAll] : null, timestamp: ts };
}

async function clarity(race, cfg, cache) {
  const st = cfg.state || race.id;
  const eid = await clarityEid(st, cfg, cache);
  const base = `https://results.enr.clarityelections.com/${st}/${eid}`;
  const ver = (await get(`${base}/current_ver.txt`)).trim();
  const zip = unzip(await get(`${base}/${ver}/reports/detailxml.zip`, { as: "buffer", timeout: 45000 }));
  const xml = Object.values(zip)[0].toString("utf8");
  const r = parseClarityXml(xml, race);
  return { source: cfg.source || `${race.state} election results`, url: `${base}/web.${ver}/`, ...r };
}

const READERS = { florida, clarity };

export async function allCounts(races, prev, cache, health) {
  const out = {};
  await Promise.all(races.map(async (race) => {
    const cfg = race.counts;
    const old = prev && prev[race.id] && prev[race.id].counts;
    if (!cfg || !READERS[cfg.reader]) { out[race.id] = old || null; return; }
    const c = (cache[race.id] = cache[race.id] || {});
    try {
      const r = await READERS[cfg.reader](race, cfg, c);
      const votes = r.units.reduce((a, u) => a + u.left + u.right + u.other, 0);
      out[race.id] = { ok: votes > 0, ...r, votes, fetched: new Date().toISOString(), updated: r.updated || (votes !== (old && old.votes) ? new Date().toISOString() : old && old.updated) || null, error: votes > 0 ? null : "no votes counted yet" };
      health.push({ name: `count ${race.id}`, ok: true, detail: `${votes} votes` });
    } catch (e) {
      log(`[count] ${race.id}: ${e.message}`);
      health.push({ name: `count ${race.id}`, ok: false, detail: e.message });
      out[race.id] = old && old.ok ? { ...old, stale: true, error: e.message } : { ok: false, error: e.message, fetched: new Date().toISOString() };
    }
  }));
  return out;
}
