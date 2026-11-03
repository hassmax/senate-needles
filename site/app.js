import { estimate, marketShare, lean, phi } from "./model.js?v=__BUILD__";

const REFRESH_MS = 20000;
const BUILD = document.querySelector('meta[name="build"]').content;
const DEMO = new URLSearchParams(location.search).has("demo");
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");
const ET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const ETS = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit" });
const NUM = new Intl.NumberFormat("en-US");

const S = {
  config: null, baselines: {}, live: null, history: {}, filter: "all", seenFeed: null,
  jitter: true, cards: {}, est: {}, lastOk: 0, lastGenerated: null,
};

function fatal(msg) {
  const el = document.getElementById("fatal");
  el.hidden = false;
  el.textContent = "Something went wrong loading the page: " + msg;
}
window.addEventListener("error", (e) => fatal(e.message));
window.addEventListener("unhandledrejection", (e) => fatal(String(e.reason && e.reason.message || e.reason)));

try { S.jitter = localStorage.getItem("jitter") !== "off"; } catch { /* storage blocked */ }

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) n.append(k);
  return n;
};
const svgEl = (tag, attrs = {}) => {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const partyVar = (party) => (party === "D" ? "dem" : party === "R" ? "rep" : "ind");
const pct = (x, d = 0) => (x * 100).toFixed(d);
const fmtTime = (iso) => (iso ? ET.format(new Date(iso)) : "");

async function getJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

// ---------- needle ----------
const CX = 160, CY = 160, R_OUT = 140, R_IN = 96;
// Bands by the left candidate's chance: very likely, likely, leans, tossup, leans, likely, very likely.
const BANDS = [[1, 0.9], [0.9, 0.75], [0.75, 0.6], [0.6, 0.4], [0.4, 0.25], [0.25, 0.1], [0.1, 0]];
const angleOf = (p) => (1 - p) * 180; // p=1 points left, p=0 points right
function arcPoint(p, r) {
  const t = (angleOf(p) * Math.PI) / 180;
  return [CX - r * Math.cos(t), CY - r * Math.sin(t)];
}
function bandPath(p1, p2) {
  const [x1, y1] = arcPoint(p1, R_OUT), [x2, y2] = arcPoint(p2, R_OUT);
  const [x3, y3] = arcPoint(p2, R_IN), [x4, y4] = arcPoint(p1, R_IN);
  return `M${x1},${y1} A${R_OUT},${R_OUT} 0 0 1 ${x2},${y2} L${x3},${y3} A${R_IN},${R_IN} 0 0 0 ${x4},${y4} Z`;
}

function buildNeedle(race) {
  const L = partyVar(race.left.party), Rr = partyVar(race.right.party);
  const fills = [`var(--${L})`, `color-mix(in srgb, var(--${L}) 60%, var(--${L}-soft))`, `var(--${L}-soft)`, "var(--toss)",
    `var(--${Rr}-soft)`, `color-mix(in srgb, var(--${Rr}) 60%, var(--${Rr}-soft))`, `var(--${Rr})`];
  const svg = svgEl("svg", { viewBox: "0 0 320 196", role: "img" });
  BANDS.forEach(([a, b], i) => svg.append(svgEl("path", { d: bandPath(a, b), fill: fills[i], stroke: "var(--panel)", "stroke-width": "1.5" })));
  const [mx, my] = arcPoint(0.5, R_OUT + 4);
  svg.append(svgEl("line", { x1: mx, y1: my, x2: mx, y2: my - 8, stroke: "var(--faint)", "stroke-width": "1.5" }));
  const t50 = svgEl("text", { x: mx, y: my - 12, "text-anchor": "middle", class: "gauge-label" }); t50.textContent = "50%";
  svg.append(t50);
  const ln = svgEl("text", { x: CX - (R_OUT + R_IN) / 2, y: CY + 22, "text-anchor": "middle", class: "gauge-name", fill: `var(--${L})` });
  ln.textContent = race.left.last;
  const rn = svgEl("text", { x: CX + (R_OUT + R_IN) / 2, y: CY + 22, "text-anchor": "middle", class: "gauge-name", fill: `var(--${Rr})` });
  rn.textContent = race.right.last;
  svg.append(ln, rn);
  const ticks = svgEl("g", {});
  svg.append(ticks);
  const arm = svgEl("g", { class: "arm" });
  arm.append(svgEl("path", { d: `M${CX},${CY - 5} L${CX - R_OUT + 6},${CY} L${CX},${CY + 5} Z`, fill: "var(--needle)" }));
  svg.append(arm, svgEl("circle", { cx: CX, cy: CY, r: 9, fill: "var(--needle)" }), svgEl("circle", { cx: CX, cy: CY, r: 3.5, fill: "var(--panel)" }));
  const wrap = el("div", { class: "needle-wrap" }, svg);
  return { wrap, svg, arm, ticks };
}

function drawTicks(g, marks) {
  g.replaceChildren();
  for (const m of marks) {
    if (m.p == null || !isFinite(m.p)) continue;
    const p = Math.min(0.995, Math.max(0.005, m.p));
    const [x1, y1] = arcPoint(p, R_OUT + 2), [x2, y2] = arcPoint(p, R_OUT + 12), [xt, yt] = arcPoint(p, R_OUT + (m.label === "P" ? 32 : 21));
    if (m.hollow) {
      const [cx, cy] = arcPoint(p, R_OUT + 8);
      g.append(svgEl("circle", { cx, cy, r: 4, fill: "none", stroke: "var(--muted)", "stroke-width": "1.5" }));
    } else {
      g.append(svgEl("line", { x1, y1, x2, y2, stroke: "var(--muted)", "stroke-width": "2.5", "stroke-linecap": "round" }));
    }
    const t = svgEl("text", { x: xt, y: yt + 3, "text-anchor": "middle", class: "tick-label" });
    t.textContent = m.label;
    const title = svgEl("title", {}); title.textContent = m.title;
    t.append(title);
    g.append(t);
  }
}

function setArm(card, p) {
  card.arm.style.transform = `rotate(${angleOf(p)}deg)`;
}

// ---------- per-race estimate ----------
function raceView(race) {
  const lr = (S.live && S.live.races && S.live.races[race.id]) || {};
  const now = Date.now();
  const closed = now >= Date.parse(race.polls_close);
  const kal = lr.markets && lr.markets.kalshi, poly = lr.markets && lr.markets.polymarket;
  const mk = [marketShare(kal), marketShare(poly)].filter((x) => x != null);
  const mAvg = mk.length ? mk.reduce((a, b) => a + b, 0) / mk.length : null;
  const counts = lr.counts && lr.counts.ok ? lr.counts : null;
  const base = S.baselines[race.id];
  let est = estimate(base, counts, { prior: race.prior, turnout: race.turnout || S.config.turnout_default, late_share: race.late_share, rcv: race.rcv });
  // No official count to model (Maine, or a feed that failed): after polls close show market odds.
  const noCount = !!race.no_live_count || (closed && !counts);
  if (noCount && closed && mAvg != null) {
    est = { ...est, mode: "market", p: mAvg, note: race.no_live_count ? "Market odds: no official live count" : "Market odds: official count unavailable" };
  } else if (race.no_live_count && mAvg != null && est.mode === "prior") {
    est = { ...est, mode: "market", p: mAvg, note: "Market odds: no official live count" };
  }
  return { lr, closed, kal, poly, mAvg, est, counts };
}

// ---------- cards ----------
function buildCard(race) {
  const needle = buildNeedle(race);
  const card = {
    root: el("article", { class: "card", id: `race-${race.id}` }),
    head: el("div", { class: "card-head" }),
    status: el("span", { class: "chip-status" }),
    needle,
    arm: needle.arm,
    headline: el("div", { class: "headline", "aria-live": "polite" }),
    est: el("div", { class: "est" }),
    bar: el("div", { class: "bar", title: "Share of the expected vote counted" }, el("span")),
    meta: el("div", { class: "meta" }),
    tally: el("div", { class: "tally" }),
    call: el("div", { class: "callbox" }),
    markets: el("div", { class: "markets" }),
    spark: svgEl("svg", { class: "spark", viewBox: "0 0 300 34", preserveAspectRatio: "none", "aria-hidden": "true" }),
    note: el("div", { class: "note" }),
    sources: el("div", { class: "sources" }),
    p: 0.5, band: [0.5, 0.5],
  };
  card.head.append(el("h3", { text: race.title }), card.status);
  card.root.append(card.head, needle.wrap, card.headline, card.est, card.bar, card.meta, card.tally, card.call, card.markets, card.spark, card.note, card.sources);
  return card;
}

function updateCard(race, card) {
  const v = raceView(race);
  const { est, lr, closed } = v;
  S.est[race.id] = { p: est.p, mode: est.mode };
  const leftName = race.left.last, rightName = race.right.last;
  const call = lr.call || race.call || null;

  // Status chip
  card.status.className = "chip-status";
  if (call) {
    card.status.classList.add("call");
    card.status.textContent = `${call.by || "Called"}: ${call.winner === "left" ? leftName : rightName}`;
  } else if (!closed) {
    card.status.textContent = `Polls close ${fmtTime(race.polls_close)} ET`;
  } else if (est.mode === "model" || est.mode === "statewide") {
    card.status.classList.add("counting");
    card.status.textContent = `Counting · ${pct(est.reported)}% in`;
  } else {
    card.status.textContent = "Polls closed";
  }
  card.root.classList.toggle("called", !!call);

  // Needle
  card.p = est.p;
  if (est.mode === "model" || est.mode === "statewide") {
    card.band = [phi((est.margin - 0.25 * est.sd) / est.sd), phi((est.margin + 0.25 * est.sd) / est.sd)];
  } else card.band = [est.p, est.p];
  if (!jitterOn()) setArm(card, est.p);
  const marks = [
    { p: phi(race.prior.margin / race.prior.sd), label: "", hollow: true, title: `Pre-election polling average: ${marginText(race, race.prior.margin / 100)}` },
    { p: marketShare(v.kal), label: "K", title: "Kalshi market price" },
    { p: marketShare(v.poly), label: "P", title: "Polymarket market price" },
  ];
  drawTicks(card.needle.ticks, marks);
  const fav = est.p >= 0.5 ? leftName : rightName;
  const fp = Math.max(est.p, 1 - est.p);
  const lab = lean(est.p);
  card.needle.svg.setAttribute("aria-label", `${fav} ${pct(fp)}% chance to win (${est.mode === "market" ? "market odds" : "estimate"})`);

  // Headline + estimate
  card.headline.replaceChildren(
    lab === "Tossup" ? "Tossup " : `${fav} ${fp > 0.995 ? ">99" : pct(fp)}% `,
    el("span", { class: "lean", text: lab === "Tossup" ? `(${leftName} ${pct(est.p)}%)` : `${est.mode === "market" ? "market odds" : "chance to win"}` }),
  );
  if (est.mode === "model" || est.mode === "statewide") {
    card.est.textContent = `Est. final margin: ${marginText(race, est.margin)} · 80% range ${marginText(race, est.lo)} to ${marginText(race, est.hi)}`;
  } else if (est.mode === "market") {
    card.est.textContent = `${est.note}. Polling average was ${marginText(race, race.prior.margin / 100)}.`;
  } else {
    card.est.textContent = `Polling average: ${marginText(race, race.prior.margin / 100)} (${race.prior.source})`;
  }

  // Counted share bar
  const rep = est.mode === "model" || est.mode === "statewide" ? est.reported : 0;
  card.bar.firstChild.style.width = `${Math.min(100, rep * 100).toFixed(1)}%`;
  const c = v.counts;
  card.meta.textContent = c
    ? `${pct(rep)}% of expected vote counted${c.precincts ? ` · ${NUM.format(c.precincts[0])} of ${NUM.format(c.precincts[1])} precincts` : ""}${c.updated ? ` · count updated ${fmtTime(c.updated)}` : ""}`
    : race.no_live_count ? "No official live count in this state." : closed ? "Waiting for the official count." : "No votes counted yet.";

  // Tally
  card.tally.replaceChildren();
  const tot = est.left + est.right + est.other;
  if (tot > 0) {
    const row = (name, party, n) => [
      el("div", { class: "name" }, el("span", { class: "swatch", style: `background:var(--${partyVar(party)})` }), el("span", { text: name })),
      el("div", { text: NUM.format(Math.round(n)) }), el("div", { text: `${(n / tot * 100).toFixed(1)}%` }),
    ];
    card.tally.append(...row(`${race.left.name} (${race.left.party})`, race.left.party, est.left),
      ...row(`${race.right.name} (${race.right.party})`, race.right.party, est.right));
    if (est.other > 0) card.tally.append(...row("Others", "", est.other));
  }

  // Call
  card.call.replaceChildren();
  if (call) {
    const txt = `${call.by || "Reported"} call: ${call.winner === "left" ? race.left.name : race.right.name} wins${call.time ? ` (${fmtTime(call.time)})` : ""}`;
    card.call.append(call.url ? el("a", { href: call.url, target: "_blank", rel: "noopener", text: txt + " ↗" }) : txt);
  }

  // Markets
  card.markets.replaceChildren();
  const mline = (label, m) => {
    const s = marketShare(m);
    if (s == null) return;
    const txt = `${label}: ${s >= 0.5 ? leftName : rightName} ${pct(Math.max(s, 1 - s))}%`;
    card.markets.append(m.url ? el("a", { href: m.url, target: "_blank", rel: "noopener", text: txt }) : el("span", { text: txt }));
  };
  mline("Kalshi", v.kal); mline("Polymarket", v.poly);
  if (!card.markets.childNodes.length) card.markets.append(el("span", { text: "Market odds not available yet." }));

  // Sparkline of the needle over the night
  drawSpark(card.spark, S.history[race.id] || [], race);

  // Notes
  const notes = [];
  if (race.count_note) notes.push(race.count_note);
  if (race.no_live_count) notes.push(race.no_live_count);
  if (race.baseline_note) notes.push(race.baseline_note);
  if (est.unmatched) notes.push(`${est.unmatched} reporting areas couldn't be matched to 2024 counties; they are judged against the statewide 2024 result.`);
  if (lr.counts && !lr.counts.ok && closed && !race.no_live_count) notes.push(`Official count not loading: ${lr.counts.error || "no data yet"}.`);
  if (race.rcv) notes.push("Ranked-choice race: if no one passes 50%, later choices decide it, so the range is wider.");
  card.note.hidden = !notes.length;
  card.note.textContent = notes.join(" ");

  // Sources
  card.sources.replaceChildren("Official results: ", el("a", { href: race.results_page, target: "_blank", rel: "noopener", text: lr.counts && lr.counts.source || race.state }));
}

function marginText(race, m) {
  if (Math.abs(m) < 0.0005) return "even";
  return `${m > 0 ? race.left.last : race.right.last} +${Math.abs(m * 100).toFixed(1)}`;
}

function drawSpark(svg, pts, race) {
  svg.replaceChildren();
  svg.append(svgEl("line", { x1: 0, y1: 17, x2: 300, y2: 17, stroke: "var(--line)", "stroke-width": "1" }));
  if (pts.length < 2) return;
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1;
  const xy = pts.map(([t, p]) => [((t - t0) / Math.max(1, t1 - t0)) * 300, 2 + (1 - p) * 30]);
  svg.append(svgEl("polyline", {
    points: xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "), fill: "none",
    stroke: pts[pts.length - 1][1] >= 0.5 ? `var(--${partyVar(race.left.party)})` : `var(--${partyVar(race.right.party)})`,
    "stroke-width": "1.6", "vector-effect": "non-scaling-stroke",
  }));
  const title = svgEl("title", {}); title.textContent = `${race.left.last}'s chance over the night (top = ${race.left.last}, bottom = ${race.right.last})`;
  svg.append(title);
}

// ---------- jitter ----------
const jitterOn = () => S.jitter && !REDUCED.matches;
function jitterTick() {
  for (const race of S.config.races) {
    const card = S.cards[race.id];
    if (!card) continue;
    const [a, b] = card.band;
    card.needle.wrap.classList.toggle("jitter", jitterOn() && a !== b);
    if (!jitterOn() || a === b) { setArm(card, card.p); continue; }
    setArm(card, a + Math.random() * (b - a));
  }
}
function setupJitter() {
  const btn = document.getElementById("jitter");
  const sync = () => { btn.textContent = S.jitter ? "Jitter on" : "Jitter off"; btn.setAttribute("aria-pressed", String(S.jitter)); btn.hidden = REDUCED.matches; };
  btn.addEventListener("click", () => {
    S.jitter = !S.jitter;
    try { localStorage.setItem("jitter", S.jitter ? "on" : "off"); } catch { /* storage blocked */ }
    sync(); jitterTick();
  });
  REDUCED.addEventListener("change", () => { sync(); jitterTick(); });
  sync();
  setInterval(jitterTick, 400);
}

// ---------- summary ----------
function renderSummary() {
  const box = document.getElementById("summary");
  box.replaceChildren();
  const ctl = S.live && S.live.control && S.live.control.kalshi;
  if (ctl && ctl.d != null) {
    box.append(el("div", { class: "item" }, "Senate control, Kalshi: ",
      el("b", { class: "dem", text: `Democrats ${pct(ctl.d / ((ctl.d + ctl.r) || 1))}%` }), " · ",
      el("b", { class: "rep", text: `Republicans ${pct(ctl.r / ((ctl.d + ctl.r) || 1))}%` })));
  }
  let l = 0, r = 0, t = 0;
  for (const race of S.config.races) {
    const e = S.est[race.id];
    if (!e) continue;
    if (lean(e.p) === "Tossup") t++; else if (e.p > 0.5) l++; else r++;
  }
  box.append(el("div", { class: "item" }, "These races now: ",
    el("b", { class: "dem", text: `${l} lean D/I` }), " · ", el("b", { class: "muted", text: `${t} tossup` }), " · ", el("b", { class: "rep", text: `${r} lean R` })));
  const now = Date.now();
  const next = S.config.races.filter((x) => Date.parse(x.polls_close) > now).sort((a, b) => Date.parse(a.polls_close) - Date.parse(b.polls_close));
  if (next.length) {
    const tnext = next[0].polls_close;
    const names = next.filter((x) => x.polls_close === tnext).map((x) => x.state).join(", ");
    box.append(el("div", { class: "item muted", text: `Next polls close ${fmtTime(tnext)} ET: ${names}` }));
  }
}

// ---------- feed ----------
function feedItems() {
  const items = (S.live && S.live.feed) || [];
  if (S.filter === "all") return items;
  if (S.filter === "calls") return items.filter((i) => i.call);
  if (S.filter === "newsrooms") return items.filter((i) => i.kind === "post" && i.via === "account");
  if (S.filter === "headlines") return items.filter((i) => i.kind === "news");
  return items.filter((i) => i.race === S.filter);
}
function renderFilter() {
  const box = document.getElementById("feed-filter");
  box.replaceChildren();
  const opts = [["all", "All"], ["calls", "Calls"], ["newsrooms", "Newsrooms"], ["headlines", "Headlines"], ...S.config.races.map((r) => [r.id, r.id])];
  for (const [id, label] of opts) {
    const b = el("button", { type: "button", "aria-pressed": String(S.filter === id), text: label });
    b.addEventListener("click", () => { S.filter = id; renderFilter(); renderFeed(); });
    box.append(b);
  }
}
function renderFeed() {
  const list = document.getElementById("feed");
  const items = feedItems().slice(0, 150);
  const firstRender = S.seenFeed == null;
  S.seenFeed = S.seenFeed || new Set();
  list.replaceChildren();
  if (!items.length) {
    list.append(el("li", { class: "feed-empty", text: S.live ? "Nothing here yet." : "Loading…" }));
    return;
  }
  for (const it of items) {
    const isNew = !firstRender && !S.seenFeed.has(it.id);
    const li = el("li", { class: [it.call ? "call" : "", isNew ? "new" : ""].join(" ").trim() });
    const who = el("div", { class: "who" },
      el("b", { text: it.author || it.outlet || "" }),
      it.handle ? el("span", { text: "@" + it.handle }) : null,
      el("span", { text: "· " + fmtTime(it.time) }),
      it.race ? el("span", { class: "tag", text: it.race }) : null,
      el("span", { class: "tag", text: it.kind === "news" ? "headline" : it.via === "search" ? "post (search)" : "post" }),
      it.call ? el("span", { class: "tag", text: "call" }) : null);
    const a = el("a", { href: it.url, target: "_blank", rel: "noopener" }, el("p", { class: "txt", text: it.text }));
    li.append(who, a);
    list.append(li);
  }
  for (const it of (S.live && S.live.feed) || []) S.seenFeed.add(it.id);
}

// ---------- status ----------
function renderStatus() {
  const box = document.getElementById("status");
  const g = S.lastGenerated ? Date.parse(S.lastGenerated) : 0;
  const age = (Date.now() - g) / 1000;
  box.replaceChildren();
  if (!g) { box.textContent = DEMO ? "Demo data" : "Waiting for the first update…"; return; }
  const stale = age > 300;
  box.append(el("span", { class: stale ? "stale" : "live", text: stale ? "Delayed" : "● Live" }),
    ` · data from ${ETS.format(new Date(g))} ET (${age < 90 ? Math.round(age) + "s" : Math.round(age / 60) + " min"} ago)`,
    S.live && S.live.health ? ` · ${S.live.health.filter((h) => h.ok).length}/${S.live.health.length} sources answering` : "");
}

// ---------- loading ----------
async function refresh() {
  try {
    const url = DEMO ? "data/demo-live.json" : `data/live.json?t=${Date.now()}`;
    const live = await getJSON(url);
    if (live.build && BUILD !== "__BUILD__" && live.build !== BUILD && !DEMO) {
      location.reload();
      return;
    }
    S.lastOk = Date.now();
    if (live.generated !== S.lastGenerated) {
      S.live = live;
      S.lastGenerated = live.generated;
      try { S.history = await getJSON(DEMO ? "data/demo-history.json" : `data/history.json?t=${Date.now()}`); } catch { /* optional */ }
      renderAll();
    }
  } catch (e) {
    console.warn("refresh failed", e);
  }
  renderStatus();
}

function renderAll() {
  for (const race of S.config.races) updateCard(race, S.cards[race.id]);
  renderSummary();
  renderFeed();
  jitterTick();
}

async function boot() {
  S.config = await getJSON(`data/config.json?t=${Date.now()}`);
  await Promise.all(S.config.races.map(async (r) => { S.baselines[r.id] = await getJSON(`data/baseline/${r.id}.json?v=${BUILD}`); }));
  const box = document.getElementById("races");
  for (const race of S.config.races) {
    S.cards[race.id] = buildCard(race);
    box.append(S.cards[race.id].root);
  }
  renderFilter();
  renderAll();
  setupJitter();
  await refresh();
  setInterval(refresh, REFRESH_MS);
  setInterval(renderStatus, 5000);
  // Polls-close times pass without new data; re-render each minute so status chips change.
  setInterval(renderAll, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
}

boot().catch((e) => fatal(e.message));
