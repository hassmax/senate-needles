// Official election-night counts, one reader per kind of state results site. Each returns
// {source, url, updated, units: [{name, fips?, left, right, other, complete}], precincts: [in, total]}.
// A reader that fails leaves the race on its last good count (marked with the error).
import { get, getJSON, unzip, parseDelimited, num, sideOf, log } from "../lib.mjs";

const SENATE_RE = /united states senat|u\.?\s?s\.?\s+senat|us senat|senator,? u\.?s|^senat(e|or)$/i;

// ---------- Florida: the Division of Elections' tab-separated election-night file ----------
// The last Florida file read this run, so the House bellwethers can use it without another request.
let floridaRows = null;

async function florida(race, cfg) {
  const url = cfg.url || "https://results.elections.myflorida.com/ResultsExtract.Asp?ElectionDate=11/3/2026&OfficialResults=N&PartyRaces=N&DataMode=&FormsButton1=Download";
  const rows = parseDelimited(await get(url), "\t");
  floridaRows = rows;
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

// ---------- Nebraska: the Secretary of State's media CSV (statewide totals) ----------
async function nebraska(race, cfg) {
  const url = cfg.url || "https://electionresults.nebraska.gov/resultsCSV.aspx?text=All&type=SW&map=CTY";
  const rows = parseDelimited(await get(url), ",").filter((r) => /united states senator/i.test(r.RaceName || ""));
  if (!rows.length) throw new Error("no U.S. Senate rows in the Nebraska file");
  const byArea = new Map();
  let precincts = null, updated = null;
  for (const r of rows) {
    const area = r.AreaType === "SW" || !r.AreaNum ? "__state" : r.AreaNum;
    const u = byArea.get(area) || { name: area, left: 0, right: 0, other: 0, complete: false };
    u[sideOf(race, { name: r.CandidateName, party: r.PartyCode })] += num(r.CandidateVotes);
    const m = String(r.PrecinctsReporting || "").match(/(\d+)\s*\/\s*(\d+)/);
    if (m) {
      u.complete = +m[2] > 0 && +m[1] >= +m[2];
      if (area === "__state") precincts = [+m[1], +m[2]];
    }
    if (r.CurrentDateTime) updated = r.CurrentDateTime;
    byArea.set(area, u);
  }
  const state = byArea.get("__state");
  const counties = [...byArea.values()].filter((u) => u.name !== "__state");
  return {
    source: "Nebraska Secretary of State", url: "https://electionresults.nebraska.gov/",
    units: counties, statewide: counties.length ? null : state, precincts, stamp: updated,
  };
}

// ---------- NIST 1500-100 election results XML (Ohio's feed) ----------
const tag = (s, t) => { const m = s.match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)</${t}>`)); return m ? m[1].trim() : null; };
const tags = (s, t) => [...s.matchAll(new RegExp(`<${t}\\b([^>]*)>([\\s\\S]*?)</${t}>`, "g"))];
export function parseNist(xml, race) {
  const gp = new Map();
  for (const g of tags(xml, "GpUnit")) {
    const id = (g[1].match(/ObjectId="([^"]+)"/) || [])[1];
    const name = tag(g[2], "Name") || tag(tag(g[2], "Text") || "", "Text") || id;
    gp.set(id, {
      name: name.replace(/<[^>]+>/g, ""), type: (tag(g[2], "Type") || "").toLowerCase(),
      total: num(tag(g[2], "TotalSubUnits")), reported: num(tag(g[2], "SubUnitsReported")),
    });
  }
  const cands = new Map(), parties = new Map();
  for (const p of tags(xml, "Party")) {
    const id = (p[1].match(/ObjectId="([^"]+)"/) || [])[1];
    parties.set(id, (tag(p[2], "Abbreviation") || tag(p[2], "Text") || tag(p[2], "Name") || "").replace(/<[^>]+>/g, ""));
  }
  for (const c of tags(xml, "Candidate")) {
    const id = (c[1].match(/ObjectId="([^"]+)"/) || [])[1];
    const name = (tag(c[2], "BallotName") || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    cands.set(id, { name, party: parties.get(tag(c[2], "PartyId")) || "" });
  }
  const contest = tags(xml, "Contest").find((c) => {
    const name = (tag(c[2].replace(/<BallotSelection[\s\S]*<\/BallotSelection>/g, ""), "Name") || "").replace(/<[^>]+>/g, "");
    return /u\.?\s?s\.?\s+senat|united states senat/i.test(name) && !/state senat/i.test(name);
  });
  if (!contest) throw new Error("no U.S. Senate contest in the XML feed");
  const units = new Map();
  for (const sel of tags(contest[2], "BallotSelection")) {
    const cid = tag(sel[2], "CandidateIds") || tag(sel[2], "CandidateId");
    const cand = cands.get(cid) || { name: "", party: "" };
    const side = sideOf(race, cand);
    const perUnit = new Map();
    for (const vc of tags(sel[2], "VoteCounts")) {
      const g = tag(vc[2], "GpUnitId"), type = (tag(vc[2], "Type") || "total").toLowerCase(), n = num(tag(vc[2], "Count"));
      const e = perUnit.get(g) || { total: null, sum: 0 };
      if (type === "total") e.total = n; else e.sum += n;
      perUnit.set(g, e);
    }
    for (const [g, e] of perUnit) {
      const info = gp.get(g) || { name: g, type: "" };
      const u = units.get(g) || { name: info.name, type: info.type, left: 0, right: 0, other: 0, complete: info.total > 0 && info.reported >= info.total };
      u[side] += e.total != null ? e.total : e.sum;
      units.set(g, u);
    }
  }
  const all = [...units.values()];
  const counties = all.filter((u) => u.type === "county");
  const state = all.find((u) => u.type === "state");
  const stateGp = [...gp.values()].find((g) => g.type === "state");
  return {
    units: counties.length ? counties : [],
    statewide: counties.length ? null : state || null,
    precincts: stateGp && stateGp.total ? [stateGp.reported, stateGp.total] : null,
  };
}

async function nist(race, cfg) {
  const xml = await get(cfg.url, { timeout: 45000 });
  return { source: cfg.source || `${race.state} election results`, url: race.results_page, ...parseNist(xml, race) };
}

// ---------- Alaska: the Division of Elections' precinct CSV, added up by house district ----------
export function parseAlaska(text, race) {
  const rows = parseDelimited(text, ",");
  const units = new Map();
  let pIn = 0, pAll = 0;
  const seenPct = new Set();
  for (const r of rows) {
    if (!/^u\.?s\.? senator/i.test(r.Contest_title || "")) continue;
    const hd = String(r.Pct_Id || r.Precinct_name || "").match(/^(\d{1,2})-/);
    if (!hd) continue;
    const name = `District ${+hd[1]}`;
    const u = units.get(name) || { name, left: 0, right: 0, other: 0, complete: true, _n: 0, _done: 0 };
    u[sideOf(race, { name: r.candidate_name, party: r.Party_Code })] += num(r.total_votes);
    if (!seenPct.has(r.Pct_Id)) {
      seenPct.add(r.Pct_Id);
      const done = String(r.Reporting_flag) === "1";
      u._n++; if (done) u._done++;
      pAll++; if (done) pIn++;
    }
    units.set(name, u);
  }
  if (!units.size) throw new Error("no U.S. Senate rows in the Alaska file");
  const list = [...units.values()].map(({ _n, _done, ...u }) => ({ ...u, complete: _n > 0 && _done >= _n }));
  return { units: list, precincts: pAll ? [pIn, pAll] : null };
}

async function alaska(race, cfg) {
  const url = cfg.url || "https://www.elections.alaska.gov/enr/26GENR/results/GA_ENR_Precinct_State_of_Alaska.csv";
  const text = await get(url, { timeout: 45000 });
  return { source: "Alaska Division of Elections", url: race.results_page, ...parseAlaska(text, race) };
}

const READERS = { florida, clarity, nebraska, nist, alaska };

export async function allCounts(races, prev, cache, health) {
  const out = {};
  await Promise.all(races.map(async (race) => {
    const cfg = race.counts;
    const old = prev && prev[race.id] && prev[race.id].counts;
    if (!cfg || !READERS[cfg.reader]) { out[race.id] = old || null; return; }
    const c = (cache[race.id] = cache[race.id] || {});
    // Some sites challenge readers that ask too often (Florida's did, three requests in a row), and
    // most only refresh every few minutes anyway: ask each at most every `min_interval` seconds.
    const wait = (cfg.min_interval || 60) * 1000;
    if (c.lastTry && Date.now() - c.lastTry < wait && old) { out[race.id] = old; return; }
    c.lastTry = Date.now();
    try {
      const r = await READERS[cfg.reader](race, cfg, c);
      r.units = r.units || [];
      const votes = (r.units.length ? r.units : [r.statewide || { left: 0, right: 0, other: 0 }]).reduce((a, u) => a + u.left + u.right + u.other, 0);
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

// ---------- House bellwethers (config/races.json "bellwethers") ----------
// District totals for the early-clue House races: {left, right, other, precincts: [in, all]}.
const HOUSE_RE = /representative in congress|united states representative|u\.?s\.? representative|member,? (of )?(the )?house of representatives|^representative$/i;

export function floridaHouse(rows, bw) {
  let left = 0, right = 0, other = 0, pIn = 0, pAll = 0;
  const seen = new Set();
  for (const r of rows || []) {
    if (!HOUSE_RE.test(r.OfficeDesc || r.RaceName || "")) continue;
    if (num(r.Juris1num) !== bw.district) continue;
    const name = [r.CanNameFirst, r.CanNameLast].filter(Boolean).join(" ");
    const side = sideOf(bw, { name, party: r.PartyCode || r.PartyName });
    if (side === "left") left += num(r.CanVotes); else if (side === "right") right += num(r.CanVotes); else other += num(r.CanVotes);
    const key = r.CountyCode || r.CountyName;
    if (!seen.has(key)) { seen.add(key); pIn += num(r.PrecinctsReporting); pAll += num(r.Precincts); }
  }
  if (!seen.size) return null;
  return { left, right, other, precincts: pAll ? [pIn, pAll] : null };
}

// Virginia's Department of Elections results site (Enhanced Voting): every contest, paged.
const VA_API = "https://enr.elections.virginia.gov/results/public/api/elections/virginia/2026-November-General/ballot-items";
let vaItems = null;
async function virginiaItems() {
  if (vaItems) return vaItems;
  const all = [];
  for (let offset = 0, page = 0; page < 20; page++) {
    const j = await getJSON(`${VA_API}?limit=500&offset=${offset}`, { timeout: 30000 });
    const data = j.data || [];
    all.push(...data);
    offset += data.length;
    if (!data.length || offset >= (j.totalRecordCount || 0)) break;
  }
  return (vaItems = all);
}
const en = (arr) => ((arr || []).find((x) => /^en/i.test(x.languageId)) || (arr || [])[0] || {}).text || "";

export function virginiaHouse(items, bw) {
  const item = (items || []).find((it) => {
    const m = en(it.name).match(/House of Representatives \((\d+)(?:st|nd|rd|th) District\)/i);
    return m && +m[1] === bw.district;
  });
  if (!item) return null;
  let left = 0, right = 0, other = 0;
  for (const o of (item.summaryResults && item.summaryResults.ballotOptions) || []) {
    const side = sideOf(bw, { name: en(o.name), party: (o.party && (o.party.abbreviation || en(o.party.name))) || "" });
    if (side === "left") left += num(o.voteCount); else if (side === "right") right += num(o.voteCount); else other += num(o.voteCount);
  }
  const rs = item.reportingStatus || {};
  return { left, right, other, precincts: rs.totalUnits ? [num(rs.reportingUnits), num(rs.totalUnits)] : null, unitsAre: "localities" };
}

// Kentucky's live results page (State Board of Elections / Secretary of State): one server-rendered
// page with every contest as a "results-tbl" block. The site has a bot manager; if it refuses,
// the clue just shows that it couldn't be read.
let kyHtml = null;
async function kentuckyPage() {
  if (kyHtml) return kyHtml;
  return (kyHtml = await get("https://vrsws.sos.ky.gov/liveresults/", { timeout: 45000 }));
}
export function kentuckyContest(html, bw, titleRe) {
  const blocks = String(html || "").split(/<div class="results-tbl[ "]/).slice(1);
  const strip = (x) => x.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  for (const b of blocks) {
    const title = strip((b.match(/results-tbl-bar[^>]*>\s*<div[^>]*>([\s\S]*?)<\/div>/) || [])[1] || "");
    if (!titleRe.test(title)) continue;
    let left = 0, right = 0, other = 0, rows = 0;
    for (const r of b.matchAll(/results-tbl-row-candidate-name[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*candidate-party[^>]*>([\s\S]*?)<\/div>([\s\S]*?)(?=results-tbl-row-candidate-name|$)/g)) {
      const cells = [...r[3].matchAll(/<div[^>]*results-tbl-col\d[^>]*>([\s\S]*?)<\/div>/g)].map((m) => strip(m[1]));
      const total = num(cells[1] != null ? cells[1] : cells[0]);
      const side = sideOf(bw, { name: strip(r[1]), party: strip(r[2]) });
      if (side === "left") left += total; else if (side === "right") right += total; else other += total;
      rows++;
    }
    if (!rows) continue;
    const pr = strip(b).match(/(\d[\d,]*)\s*(?:of|\/)\s*(\d[\d,]*)\s*precincts/i);
    return { left, right, other, precincts: pr ? [num(pr[1]), num(pr[2])] : null };
  }
  return null;
}

// Indiana's election-night site (enr.indianavoters.in.gov): JSON files named by a version letter
// from settings.json; the U.S. House races are office category 1005.
const IN_BASE = "https://enr.indianavoters.in.gov/site/data/";
let inHouse = null;
async function indianaHouseFile() {
  if (inHouse) return inHouse;
  const settings = await getJSON(`${IN_BASE}settings.json`);
  const vt = ((settings.Root || settings).VersionType) || "A";
  return (inHouse = await getJSON(`${IN_BASE}OffCatC_1005_${vt}.json`));
}
const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9 };
export function indianaRace(json, bw) {
  const root = (json && (json.Root || json)) || {};
  const races = [].concat((root.StatewideSummary && root.StatewideSummary.Race) || []);
  const race = races.find((r) => {
    const t = `${r.SubSortOrder || ""} ${r.OFFICE_TITLE || ""}`;
    const m = t.match(/\((\d+)\) District/) || t.match(/District\s+0*(\d+)/i);
    const w = (r.OFFICE_TITLE || "").toLowerCase().match(/(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth) district/);
    return /representative/i.test(t) && ((m && +m[1] === bw.district) || (w && ORD[w[1]] === bw.district));
  });
  if (!race) return null;
  let left = 0, right = 0, other = 0;
  for (const c of [].concat((race.Candidates && race.Candidates.Candidate) || [])) {
    const side = sideOf(bw, { name: c.NAME_ON_BALLOT || c.CandidateName, party: c.PARTY });
    if (side === "left") left += num(c.TOTAL); else if (side === "right") right += num(c.TOTAL); else other += num(c.TOTAL);
  }
  // Precinct counts, if the file carries them for the race.
  const key = (re) => Object.keys(race).find((k) => re.test(k));
  const rep = key(/precincts?_?reporting|reporting_?precincts|PRECINCTSREPORTING/i), all = key(/total_?precincts|precincts?_?total|NumofPrecincts|PRECINCTS$/i);
  return { left, right, other, precincts: rep && all && num(race[all]) ? [num(race[rep]), num(race[all])] : null };
}

const BW_READERS = {
  indiana: async (bw) => indianaRace(await indianaHouseFile(), bw),
  kentucky: async (bw) => kentuckyContest(await kentuckyPage(), bw, /united states senator|u\.?s\.? senator/i),
  virginia: async (bw) => virginiaHouse(await virginiaItems(), bw),
  // Florida's districts come from the statewide file the Senate reader just fetched (no extra request).
  florida: async (bw) => (floridaRows ? floridaHouse(floridaRows, bw) : undefined),
};

export async function allBellwethers(list, prev, health, cache = {}) {
  const out = {};
  await Promise.all((list || []).map(async (bw) => {
    const old = prev && prev[bw.id];
    const fn = BW_READERS[bw.reader];
    if (!fn) { out[bw.id] = old || null; return; }
    // Ask slow or touchy sites (Kentucky's) at most every bw.min_interval seconds.
    const c = (cache[bw.id] = cache[bw.id] || {});
    if (bw.min_interval && c.lastTry && Date.now() - c.lastTry < bw.min_interval * 1000 && old) { out[bw.id] = old; return; }
    c.lastTry = Date.now();
    try {
      const r = await fn(bw);
      if (r === undefined) { out[bw.id] = old || null; return; } // nothing new this run
      if (!r) { out[bw.id] = old || { ok: false, error: "district not in the results yet" }; return; }
      const votes = r.left + r.right + r.other;
      out[bw.id] = { ok: votes > 0, ...r, votes, fetched: new Date().toISOString() };
      health.push({ name: `clue ${bw.id}`, ok: true, detail: `${votes} votes` });
    } catch (e) {
      log(`[clue] ${bw.id}: ${e.message}`);
      health.push({ name: `clue ${bw.id}`, ok: false, detail: e.message });
      out[bw.id] = old && old.ok ? { ...old, stale: true } : { ok: false, error: e.message };
    }
  }));
  return out;
}
