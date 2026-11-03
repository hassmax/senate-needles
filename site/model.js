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
