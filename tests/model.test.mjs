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
