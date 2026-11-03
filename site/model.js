// The needle's estimate. Plain arithmetic, no simulation, the same in the browser and in tests.
//
// Before any votes are counted the needle shows the pre-election polling average (prior.margin,
// with prior.sd points of error). As counties report, it compares each county's count with the
// same county's 2024 presidential result: the average shift ("swing") in the counties that are
// mostly counted is applied to the vote still to come in every county. Partly counted counties
// count for less (their completeness squared), because early and mail ballots, which usually
// lean one way, are often counted first. Uncertainty shrinks as the share of the expected vote
// still out shrinks. It is a rough estimate, not a professional forecast.
//
// All margins are fractions: left candidate minus right candidate, over all votes.

const SWING_INFO = 0.08;   // how fast counted results take over from the polling average
const COMP_SD = 0.08;      // how far the remaining vote's margin can differ from the counted vote's
const FLOOR_SD = 0.0015;   // recounts, cures, provisional ballots
const RCV_SD = 0.35;       // ranked choice: how unevenly other candidates' voters may split

export function normalName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\b(county|parish|borough|census area|municipality)\b/g, "")
    .replace(/state house district|house district|district|hd/g, "")
    .replace(/\bst\.?\s/g, "saint ")
    .replace(/[^a-z0-9]/g, "");
}

export function phi(x) {
  // Standard normal CDF (Abramowitz-Stegun 7.1.26), error below 1e-7.
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t *
    Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Inverse of phi (Acklam's approximation, relative error below 1.2e-9).
export function probit(p) {
  p = clamp(p, 1e-9, 1 - 1e-9);
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - lo) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// The starting point before votes are counted: the final polling average (prior.margin, with
// prior.sd points of error), blended with G. Elliott Morris's final forecast where the race has
// one (race.forecast.p_left) — `weight` of his forecast, the rest the polls, averaged on the
// normal-score scale so the result is again a margin and a spread.
export function priorOf(race, weight = 0.7) {
  const sd = (race.prior && race.prior.sd) || 5.5;
  const zPolls = race.prior.margin / sd;
  const f = race.forecast;
  if (!f || f.p_left == null) return { margin: race.prior.margin, sd, from: "polls" };
  const z = weight * probit(f.p_left) + (1 - weight) * zPolls;
  return { margin: z * sd, sd, from: "blend" };
}

// A win probability G. Elliott Morris posts during the night for a race (live = {p_left, time})
// is blended into the needle: half weight when posted, halving every hour after, and less as the
// count itself comes in (`reported`, the share of the expected vote counted).
export function blendLive(p, live, now, reported = 0) {
  if (!live || live.p_left == null) return { p, w: 0 };
  const ageMin = (now - Date.parse(live.time)) / 60000;
  if (!(ageMin >= -5) || ageMin > 240) return { p, w: 0 };
  const w = 0.5 * Math.pow(0.5, Math.max(0, ageMin) / 60) * (1 - clamp(reported, 0, 1));
  const lg = (x) => Math.log(clamp(x, 1e-4, 1 - 1e-4) / (1 - clamp(x, 1e-4, 1 - 1e-4)));
  const z = (1 - w) * lg(p) + w * lg(live.p_left);
  return { p: 1 / (1 + Math.exp(-z)), w };
}

// baseline: {d, r, total, units: [{fips, name, d, r, total}]}
// counts:   {units: [{fips?, name, left, right, other, complete?}], statewide?: {left, right, other}}
// opts:     {prior: {margin (points), sd (points)}, turnout, late_share, rcv}
export function estimate(baseline, counts, opts) {
  const mu0 = opts.prior.margin / 100;
  const sd0 = opts.prior.sd / 100;
  const T0 = opts.turnout || 0.75;
  const late = opts.late_share ?? 0.02;
  const B = (baseline.d - baseline.r) / baseline.total;
  const s0 = mu0 - B;

  const fromPrior = (note) => ({
    mode: "prior", note, p: phi(mu0 / sd0), margin: mu0, sd: sd0,
    lo: mu0 - 1.2816 * sd0, hi: mu0 + 1.2816 * sd0, reported: 0, counted: 0, expected: baseline.total * T0,
    left: 0, right: 0, other: 0, unmatched: 0,
  });
  if (!counts) return fromPrior("No count yet");

  // Line the feed's units up with the baseline's (by FIPS, else by name). Votes that match no
  // county go into one extra unit judged against the statewide baseline.
  const byFips = new Map(), byName = new Map();
  for (const u of baseline.units) {
    if (u.fips) byFips.set(String(u.fips).padStart(5, "0"), u);
    byName.set(normalName(u.name), u);
  }
  const obs = new Map();
  let unmatched = null, unmatchedUnits = 0;
  let units = counts.units || [];
  if (!units.length && counts.statewide) units = [{ name: "__state", ...counts.statewide }];
  const statewideOnly = units.length === 1 && units[0].name === "__state";
  for (const c of units) {
    const left = +c.left || 0, right = +c.right || 0, other = +c.other || 0;
    let b = statewideOnly ? null : (c.fips && byFips.get(String(c.fips).padStart(5, "0"))) || byName.get(normalName(c.name));
    if (!b) {
      if (!statewideOnly) unmatchedUnits++;
      unmatched = unmatched || { left: 0, right: 0, other: 0, complete: false };
      unmatched.left += left; unmatched.right += right; unmatched.other += other;
      continue;
    }
    const o = obs.get(b) || { left: 0, right: 0, other: 0, complete: true };
    o.left += left; o.right += right; o.other += other;
    o.complete = o.complete && !!c.complete;
    obs.set(b, o);
  }

  // Working list: every baseline unit (0 counted if not in the feed), plus the unmatched bucket.
  let work;
  if (statewideOnly || (!obs.size && unmatched)) {
    const o = unmatched || { left: 0, right: 0, other: 0, complete: false };
    work = [{ V: baseline.total, b: B, ...o }];
  } else {
    work = baseline.units.map((u) => {
      const o = obs.get(u) || { left: 0, right: 0, other: 0, complete: false };
      return { V: u.total, b: (u.d - u.r) / u.total, ...o };
    });
    if (unmatched && unmatched.left + unmatched.right + unmatched.other > 0) {
      // Its expected size is unknown: assume it is about as complete as the rest of the count.
      work.push({ V: 0, b: B, ...unmatched, extra: true });
    }
  }
  for (const w of work) w.c = w.left + w.right + w.other;
  const counted = work.reduce((a, w) => a + w.c, 0);
  if (counted <= 0) return fromPrior("Polls closed, no votes counted yet");

  // Turnout relative to 2024: start from the configured guess, and learn it from finished counties.
  let doneV = 0, doneC = 0;
  for (const w of work) if (w.complete && w.V > 0) { doneV += w.V; doneC += w.c / (1 - late); }
  const share = doneV / baseline.total;
  const T = doneV > 0 ? (T0 * 0.1 + (doneC / doneV) * share) / (0.1 + share) : T0;

  let sumE = 0, sumInfo = 0, sumW = 0, sumWs = 0;
  for (const w of work) {
    if (w.extra) continue;
    w.E = w.V * T;
    if (w.complete) {
      w.E = w.c / (1 - late);
      w.e = 1 - late;
    } else {
      w.e = w.E > 0 ? Math.min(0.97, w.c / w.E) : 0;
      if (w.c > w.E * 0.97) w.E = w.c / 0.97;
    }
    w.sw = w.c > 0 ? (w.left - w.right) / w.c - w.b : 0;
    sumE += w.E;
    sumInfo += w.E * w.e * w.e;
    if (w.c > 0) { sumW += w.E * w.e * w.e; sumWs += w.E * w.e * w.e * w.sw; }
  }
  const fracIn = sumE > 0 ? work.filter((w) => !w.extra).reduce((a, w) => a + Math.min(w.c, w.E), 0) / sumE : 0;
  for (const w of work) {
    if (!w.extra) continue;
    const f = Math.max(0.05, Math.min(0.97, fracIn));
    w.E = w.c / f; w.e = f; w.sw = w.c > 0 ? (w.left - w.right) / w.c - w.b : 0;
    sumE += w.E; sumInfo += w.E * w.e * w.e;
    sumW += w.E * w.e * w.e; sumWs += w.E * w.e * w.e * w.sw;
  }

  const k = sumE > 0 ? sumInfo / sumE : 0;
  const sObs = sumW > 0 ? sumWs / sumW : s0;
  const lam = k / (k + SWING_INFO);
  const sPost = s0 + lam * (sObs - s0);

  let net = 0, tot = 0, rem = 0, otherProj = 0;
  for (const w of work) {
    const r = Math.max(0, w.E - w.c);
    const sHat = sPost + w.e * w.e * (w.sw - sPost);
    const m = clamp(w.b + sHat, -1, 1);
    const oShare = w.c > 0 ? w.other / w.c : 0.03;
    net += (w.left - w.right) + r * m;
    tot += w.c + r;
    rem += r;
    otherProj += w.other + r * oShare;
  }
  let margin = net / tot;
  const rho = rem / tot;
  const sdRem = Math.sqrt(sd0 * sd0 * (1 - lam) + lam * COMP_SD * COMP_SD);
  let sd = Math.sqrt((rho * sdRem) ** 2 + FLOOR_SD ** 2);

  // Ranked choice: if nobody is projected past 50%, the others' voters' later choices decide it.
  const leftShare = (tot * (1 - otherProj / tot) + net) / 2 / tot;
  const rightShare = leftShare - margin;
  if (opts.rcv && Math.max(leftShare, rightShare) < 0.5) {
    sd = Math.sqrt(sd * sd + (otherProj / tot * RCV_SD) ** 2);
  }

  const totals = work.reduce((a, w) => ({ left: a.left + w.left, right: a.right + w.right, other: a.other + w.other }),
    { left: 0, right: 0, other: 0 });
  return {
    mode: statewideOnly ? "statewide" : "model",
    note: statewideOnly ? "Statewide totals only; no county detail" : "",
    p: phi(margin / sd), margin, sd, lo: margin - 1.2816 * sd, hi: margin + 1.2816 * sd,
    reported: 1 - rho, counted, expected: tot, swing: sPost, turnout: T,
    ...totals, unmatched: unmatchedUnits,
  };
}

// Market odds: the left candidate's price over the two main candidates' prices.
export function marketShare(m) {
  if (!m || m.left == null || m.right == null) return m && m.p_left != null ? m.p_left : null;
  const s = m.left + m.right;
  return s > 0 ? m.left / s : null;
}

// Plain-language label for a win probability (of the left candidate).
export function lean(p) {
  const q = Math.max(p, 1 - p);
  if (q < 0.6) return "Tossup";
  if (q < 0.75) return "Leans";
  if (q < 0.9) return "Likely";
  if (q < 0.99) return "Very likely";
  return "Near certain";
}

// What the needle shows for a race, the same on the page and in the saved trend:
// the count model where there's an official count; market odds where there isn't one and polls
// have closed; the starting point before that; then any live analyst estimate blended in.
// live = {counts, markets: {kalshi, polymarket}}, analyst = {p_left, time} or null.
export function needle(race, baseline, live, analyst, cfg, now) {
  const closed = now >= Date.parse(race.polls_close);
  const kal = live && live.markets && live.markets.kalshi, poly = live && live.markets && live.markets.polymarket;
  const mk = [marketShare(kal), marketShare(poly)].filter((x) => x != null);
  const mAvg = mk.length ? mk.reduce((a, b) => a + b, 0) / mk.length : null;
  const counts = live && live.counts && live.counts.ok ? live.counts : null;
  const prior = priorOf(race, cfg.forecast_weight ?? 0.7);
  let est = estimate(baseline, counts, { prior, turnout: race.turnout || cfg.turnout_default, late_share: race.late_share, rcv: race.rcv });
  const noCount = !!race.no_live_count || (closed && !counts);
  if (noCount && closed && mAvg != null) {
    est = { ...est, mode: "market", p: mAvg, note: race.no_live_count ? "Market odds: no official live count" : "Market odds: official count unavailable" };
  }
  const b = blendLive(est.p, analyst, now, est.mode === "model" || est.mode === "statewide" ? est.reported : 0);
  if (b.w > 0) est = { ...est, p: b.p, analyst: { ...analyst, w: b.w } };
  return { est, closed, kal, poly, mAvg, counts, prior };
}
