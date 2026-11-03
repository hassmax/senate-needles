import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { estimate, phi, normalName } from "../site/model.js";

const base = JSON.parse(fs.readFileSync(new URL("../site/data/baseline/MI.json", import.meta.url)));
const opts = { prior: { margin: 6, sd: 5.5 }, turnout: 0.8, late_share: 0.02 };

// Votes in each county: 2024's result shifted by `swing` (fraction), at `frac` of 80% turnout.
function counts(swing, frac, complete = false, only = null) {
  return {
    units: base.units.filter((u, i) => !only || only(u, i)).map((u) => {
      const n = u.total * 0.8 * frac;
      const m = (u.d - u.r) / u.total + swing;
      const other = n * 0.02;
      return { name: u.name, left: (n - other) / 2 + (m * n) / 2, right: (n - other) / 2 - (m * n) / 2, other, complete };
    }),
  };
}

test("phi is a normal CDF", () => {
  assert.ok(Math.abs(phi(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(phi(1.96) - 0.975) < 1e-4);
  assert.ok(Math.abs(phi(-1) - 0.1587) < 1e-4);
});

test("no count shows the polling prior", () => {
  const e = estimate(base, null, opts);
  assert.equal(e.mode, "prior");
  assert.ok(Math.abs(e.p - phi(6 / 5.5)) < 1e-9);
});

test("everything counted gives the counted margin and near-certainty", () => {
  const e = estimate(base, counts(-0.04, 1, true), opts); // 2024 R+1.4 shifted 4 more toward R
  assert.ok(Math.abs(e.margin - (-0.054)) < 0.003, e.margin);
  assert.ok(e.p < 0.01, e.p);
  assert.ok(e.reported > 0.97);
});

test("a little early vote barely moves the needle; more moves it further", () => {
  const p0 = estimate(base, null, opts).p;
  const early = estimate(base, counts(-0.1, 0.1), opts).p;
  const half = estimate(base, counts(-0.1, 0.6), opts).p;
  assert.ok(early < p0 && early > 0.4, `early ${early}`);
  assert.ok(half < early, `half ${half}`);
});

test("finished counties outweigh partial ones", () => {
  // Half the counties finished at R+4 swing; a few partial ones show a big D swing.
  const c = counts(-0.04, 1, true, (u, i) => i % 2 === 0);
  c.units.push(...counts(0.2, 0.2, false, (u, i) => i % 2 === 1).units);
  const e = estimate(base, c, opts);
  assert.ok(e.swing < 0, `swing ${e.swing}`);
});

test("names line up across feeds", () => {
  assert.equal(normalName("St. Clair County"), normalName("Saint Clair"));
  assert.equal(normalName("State House District 12"), normalName("District 12"));
  assert.equal(normalName("HD 12"), normalName("District 12"));
});

test("statewide-only counts work", () => {
  const e = estimate(base, { statewide: { left: 2e6, right: 1.8e6, other: 5e4 } }, opts);
  assert.equal(e.mode, "statewide");
  assert.ok(e.p > 0.9);
});

test("ranked choice widens the range when nobody passes 50%", () => {
  const ak = JSON.parse(fs.readFileSync(new URL("../site/data/baseline/AK.json", import.meta.url)));
  const c = { statewide: { left: 100000, right: 98000, other: 30000 } };
  const a = estimate(ak, c, { prior: { margin: 3, sd: 6 }, turnout: 0.75, late_share: 0.3, rcv: false });
  const b = estimate(ak, c, { prior: { margin: 3, sd: 6 }, turnout: 0.75, late_share: 0.3, rcv: true });
  assert.ok(b.sd > a.sd);
});

test("probit inverts phi", async () => {
  const { probit } = await import("../site/model.js");
  for (const p of [0.01, 0.2, 0.5, 0.63, 0.77, 0.99]) assert.ok(Math.abs(phi(probit(p)) - p) < 1e-6, p);
});

test("the starting point blends the forecast with the polls", async () => {
  const { priorOf, blendLive, probit } = await import("../site/model.js");
  const race = { prior: { margin: 2.8, sd: 5.5 }, forecast: { p_left: 0.661 } };
  const pr = priorOf(race, 0.7);
  const want = 0.7 * probit(0.661) + 0.3 * (2.8 / 5.5);
  assert.ok(Math.abs(pr.margin / pr.sd - want) < 1e-9);
  assert.equal(priorOf({ prior: { margin: 2.8, sd: 5.5 } }).from, "polls");
  const now = Date.parse("2026-11-04T02:00:00Z");
  const fresh = blendLive(0.6, { p_left: 0.9, time: "2026-11-04T02:00:00Z" }, now, 0);
  assert.ok(fresh.p > 0.7 && fresh.p < 0.9 && Math.abs(fresh.w - 0.5) < 1e-9);
  const old = blendLive(0.6, { p_left: 0.9, time: "2026-11-04T00:00:00Z" }, now, 0);
  assert.ok(old.w < 0.13 && old.p < fresh.p);
  assert.equal(blendLive(0.6, { p_left: 0.9, time: "2026-11-04T02:00:00Z" }, now, 1).p, 0.6);
});

test("a Democratic washout in one state moves the others toward Republicans", async () => {
  const { needles } = await import("../site/model.js");
  const cfg = JSON.parse(fs.readFileSync(new URL("../config/races.json", import.meta.url)));
  const bl = {};
  for (const r of cfg.races) bl[r.id] = JSON.parse(fs.readFileSync(new URL(`../site/data/baseline/${r.id}.json`, import.meta.url)));
  const before = Date.parse("2026-11-03T23:30:00Z"); // before any polls close
  const quiet = needles(cfg.races, bl, {}, {}, cfg, before);
  assert.equal(quiet.national.used.length, 0);
  // Florida mostly counted, running 8 points worse for the Democrat than its starting point.
  const fl = cfg.races.find((r) => r.id === "FL");
  const { priorOf } = await import("../site/model.js");
  const start = priorOf(fl, cfg.forecast_weight) .margin / 100;
  const B = (bl.FL.d - bl.FL.r) / bl.FL.total;
  const swing = start - B - 0.08;
  const units = bl.FL.units.map((u) => {
    const n = u.total * 0.72 * 0.85, m = (u.d - u.r) / u.total + swing, o = n * 0.02;
    return { name: u.name, left: (n - o) / 2 + (m * n) / 2, right: (n - o) / 2 - (m * n) / 2, other: o, complete: false };
  });
  const live = { FL: { counts: { ok: true, units } } };
  const res = needles(cfg.races, bl, live, {}, cfg, before);
  assert.deepEqual(res.national.used, ["FL"]);
  assert.ok(res.national.shift < -0.02, `national shift ${res.national.shift}`);
  for (const id of ["OH", "TX", "MI", "AK"]) {
    assert.ok(res.byRace[id].est.p < quiet.byRace[id].est.p - 0.03, `${id} ${quiet.byRace[id].est.p} -> ${res.byRace[id].est.p}`);
  }
  // Florida's own needle is judged on its own count, not pushed again by itself.
  assert.equal(res.byRace.FL.nat.used.length, 0);
});

test("starting point blends Morris, Decision Desk HQ and polls; Senate control adds up", async () => {
  const { priorOf, phi, needles, senateControl } = await import("../site/model.js");
  const cfg = JSON.parse(fs.readFileSync(new URL("../config/races.json", import.meta.url)));
  const tx = cfg.races.find((r) => r.id === "TX"), fl = cfg.races.find((r) => r.id === "FL");
  const p = (pr) => phi(pr.margin / pr.sd);
  // TX sits between Morris (65%) and DDHQ (60%); FL has no DDHQ number and uses Morris and polls.
  assert.ok(p(priorOf(tx, cfg.forecast_weights)) > 0.6 && p(priorOf(tx, cfg.forecast_weights)) < 0.66);
  assert.equal(priorOf(fl, cfg.forecast_weights).from, "blend");
  assert.equal(priorOf({ prior: { margin: 1, sd: 5 } }, cfg.forecast_weights).from, "polls");
  const bl = Object.fromEntries(cfg.races.map((r) => [r.id, JSON.parse(fs.readFileSync(new URL(`../site/data/baseline/${r.id}.json`, import.meta.url)))]));
  const N = needles(cfg.races, bl, {}, {}, cfg, Date.parse("2026-11-03T21:00:00Z"), {});
  const c = N.control;
  assert.equal(c.races, 35);
  assert.ok(Math.abs(c.d + c.r + c.balance - 1) < 1e-9);
  assert.ok(c.d > 0.4 && c.d < 0.85, `control ${c.d}`);
  // Every tracked race settled for Republicans: Democrats could only reach 51 by also winning
  // several seats assumed safe, so their chance is tiny; settled for Democrats, it is near certain.
  const all = (p) => Object.fromEntries(cfg.races.map((r) => [r.id, { model: { p, reported: 1 } }]));
  assert.ok(senateControl(cfg, cfg.races, all(0.0001), N.national).d < 0.02);
  assert.ok(senateControl(cfg, cfg.races, all(0.9999), N.national).d > 0.95);
});
