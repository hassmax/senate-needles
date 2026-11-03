import test from "node:test";
import assert from "node:assert/strict";
import { parseNist, parseClarityXml } from "../scripts/sources/states.mjs";
import { parseDelimited, sideOf } from "../scripts/lib.mjs";
import { detectCall, raceOf } from "../scripts/sources/social.mjs";
import fs from "node:fs";

const races = JSON.parse(fs.readFileSync(new URL("../config/races.json", import.meta.url))).races;
const OH = races.find((r) => r.id === "OH"), NE = races.find((r) => r.id === "NE");

test("sides by name and party", () => {
  assert.equal(sideOf(NE, { name: "Dan Osborn ", party: "PET" }), "left");
  assert.equal(sideOf(NE, { name: "Pete Ricketts ", party: "REP" }), "right");
  assert.equal(sideOf(NE, { name: "Mike Marvin", party: "LMN" }), "other");
  assert.equal(sideOf(OH, { name: "", party: "DEM" }), "left");
});

test("Nebraska CSV rows parse, including the =\"0/1322\" precinct field", () => {
  const csv = 'RaceID,RaceName,PartyCode,AreaType,AreaNum,OfficeSeqNo,BallotOrder,CandidateID,CandidateName,CurrentDateTime,VoteFor,CandidateVotes,CandidatePercentage,PrecinctsReporting\n' +
    '13224,"For United States Senator - 6 Year Term","REP","SW","",102,,3012,"Pete Ricketts ",11/3/2026 1:14:05 PM,1,120,0,="5/1322",\n' +
    '13224,"For United States Senator - 6 Year Term","PET","SW","",102,,3365,"Dan Osborn ",11/3/2026 1:14:05 PM,1,130,0,="5/1322",\n';
  const rows = parseDelimited(csv, ",");
  assert.equal(rows.length, 2);
  assert.equal(rows[1].CandidateName, "Dan Osborn");
  assert.match(rows[0].PrecinctsReporting, /5\/1322/);
});

test("NIST XML: county counts per side", () => {
  const xml = `<ElectionReport><Election><ContestCollection>
    <Contest xsi:type="CandidateContest" ObjectId="c1"><Name>U.S. Senator</Name>
      <BallotSelection xsi:type="CandidateSelection" ObjectId="s1"><CandidateIds>k1</CandidateIds>
        <VoteCounts><GpUnitId>g1</GpUnitId><Type>early</Type><Count>10</Count></VoteCounts>
        <VoteCounts><GpUnitId>g1</GpUnitId><Type>election-day</Type><Count>5</Count></VoteCounts>
        <VoteCounts><GpUnitId>g2</GpUnitId><Type>total</Type><Count>7</Count></VoteCounts></BallotSelection>
      <BallotSelection xsi:type="CandidateSelection" ObjectId="s2"><CandidateIds>k2</CandidateIds>
        <VoteCounts><GpUnitId>g1</GpUnitId><Type>total</Type><Count>20</Count></VoteCounts></BallotSelection>
    </Contest>
    <Contest ObjectId="c2"><Name>State Senator - District 1</Name></Contest>
  </ContestCollection></Election>
  <GpUnitCollection>
    <GpUnit xsi:type="ReportingUnit" ObjectId="g0"><Name>Ohio</Name><Type>state</Type><TotalSubUnits>100</TotalSubUnits><SubUnitsReported>40</SubUnitsReported></GpUnit>
    <GpUnit xsi:type="ReportingUnit" ObjectId="g1"><Name>Adams</Name><Type>county</Type><TotalSubUnits>10</TotalSubUnits><SubUnitsReported>10</SubUnitsReported></GpUnit>
    <GpUnit xsi:type="ReportingUnit" ObjectId="g2"><Name>Allen</Name><Type>county</Type></GpUnit>
  </GpUnitCollection>
  <CandidateCollection><Candidate ObjectId="k1"><BallotName><Text language="en">Sherrod Brown</Text></BallotName><PartyId>p1</PartyId></Candidate>
    <Candidate ObjectId="k2"><BallotName><Text language="en">Jon Husted</Text></BallotName><PartyId>p2</PartyId></Candidate></CandidateCollection>
  <PartyCollection><Party ObjectId="p1"><Abbreviation>DEM</Abbreviation></Party><Party ObjectId="p2"><Abbreviation>REP</Abbreviation></Party></PartyCollection>
  </ElectionReport>`;
  const r = parseNist(xml, OH);
  const adams = r.units.find((u) => u.name === "Adams");
  assert.equal(adams.left, 15);
  assert.equal(adams.right, 20);
  assert.equal(adams.complete, true);
  assert.equal(r.units.find((u) => u.name === "Allen").left, 7);
  assert.deepEqual(r.precincts, [40, 100]);
});

test("Clarity XML: county counts per side", () => {
  const xml = `<ElectionResult><Timestamp>11/3/2026 8:01:00 PM EST</Timestamp>
  <Contest key="2" text="United States Senator" voteFor="1" precinctsParticipating="100" precinctsReported="3">
   <ParticipatingCounties><County name="Abbeville" precinctsParticipating="2" precinctsReported="2" /></ParticipatingCounties>
   <Choice key="1" text="Annie Andrews" party="DEM" totalVotes="9"><VoteType name="Election Day" votes="9"><County name="Abbeville" votes="9" /></VoteType></Choice>
   <Choice key="2" text="Darline Graham" party="REP" totalVotes="4"><VoteType name="Election Day" votes="4"><County name="Abbeville" votes="4" /></VoteType></Choice>
  </Contest></ElectionResult>`;
  const SC = races.find((r) => r.id === "SC");
  const r = parseClarityXml(xml, SC);
  assert.deepEqual(r.units[0], { name: "Abbeville", left: 9, right: 4, other: 0, complete: true });
});

test("race calls only from clear call language after polls close", () => {
  const after = "2026-11-04T01:30:00Z";
  assert.deepEqual(detectCall(races, { text: "BREAKING: Democrat Sherrod Brown wins election to U.S. Senate in Ohio. #APRaceCall", time: after }, Date.parse(after)), { race: "OH", winner: "left" });
  assert.equal(detectCall(races, { text: "Can Sherrod Brown win the Senate race in Ohio? Polls close soon.", time: after }, Date.parse(after)), null);
  assert.equal(detectCall(races, { text: "BREAKING: Sherrod Brown wins election to U.S. Senate in Ohio.", time: "2026-11-03T20:00:00Z" }, Date.parse(after)), null);
  assert.equal(detectCall(races, { text: "Brown leads in early returns as Husted trails in Ohio Senate race", time: after }, Date.parse(after)), null);
  assert.equal(raceOf(races, "Kansas Senate: Marshall vs Hamilton").id, "KS");
});

test("stated win chances in an analyst's posts", async () => {
  const { statedChance } = await import("../scripts/sources/social.mjs");
  assert.deepEqual(statedChance(races, "Our model now gives Sherrod Brown an 82% chance in Ohio."), [{ race: "OH", p_left: 0.82 }]);
  const tx = statedChance(races, "Paxton is now a 3 in 4 favorite in the Texas Senate race, per my model.");
  assert.equal(tx[0].race, "TX"); assert.ok(Math.abs(tx[0].p_left - 0.25) < 1e-9);
  assert.deepEqual(statedChance(races, "Brown leads Husted 52-47 in Ohio with 40% reporting."), []);
  assert.deepEqual(statedChance(races, "Talarico is winning 58% of the vote in Harris County, Texas Senate."), []);
  assert.deepEqual(statedChance(races, "Turnout in Kansas is up 12% from 2022."), []);
});

test("Florida House district totals from the statewide file", async () => {
  const { floridaHouse } = await import("../scripts/sources/states.mjs");
  const cfg = JSON.parse(fs.readFileSync(new URL("../config/races.json", import.meta.url)));
  const bw = cfg.bellwethers.list.find((b) => b.id === "FL-14");
  const rows = [
    { OfficeDesc: "Representative in Congress", Juris1num: "14", PartyCode: "DEM", CanNameFirst: "Kathy", CanNameLast: "Castor", CanVotes: "1000", CountyCode: "HIL", Precincts: "100", PrecinctsReporting: "40" },
    { OfficeDesc: "Representative in Congress", Juris1num: "14", PartyCode: "REP", CanNameFirst: "Mike", CanNameLast: "Beltran", CanVotes: "900", CountyCode: "HIL", Precincts: "100", PrecinctsReporting: "40" },
    { OfficeDesc: "Representative in Congress", Juris1num: "15", PartyCode: "REP", CanNameFirst: "X", CanNameLast: "Y", CanVotes: "5000", CountyCode: "HIL", Precincts: "100", PrecinctsReporting: "40" },
    { OfficeDesc: "United States Senator", Juris1num: "", PartyCode: "REP", CanNameFirst: "Ashley", CanNameLast: "Moody", CanVotes: "7000", CountyCode: "HIL", Precincts: "300", PrecinctsReporting: "100" },
  ];
  assert.deepEqual(floridaHouse(rows, bw), { left: 1000, right: 900, other: 0, precincts: [40, 100] });
});

test("an early-clue district moves the Senate needles once enough is in", async () => {
  const { needles, bellwetherEvidence } = await import("../site/model.js");
  const cfg = JSON.parse(fs.readFileSync(new URL("../config/races.json", import.meta.url)));
  const bl = {};
  for (const r of cfg.races) bl[r.id] = JSON.parse(fs.readFileSync(new URL(`../site/data/baseline/${r.id}.json`, import.meta.url)));
  const bw = cfg.bellwethers.list.find((b) => b.id === "VA-05");
  // Expected McGuire +5.5; the Democrat is up 2 with 80% of precincts in: 7.5 pts better for Democrats.
  const counts = { ok: true, left: 51000, right: 49000, other: 0, precincts: [80, 100] };
  assert.equal(bellwetherEvidence(bw, { ...counts, precincts: [2, 100] }), null);
  const e = bellwetherEvidence(bw, counts);
  assert.ok(Math.abs(e.d - 0.075) < 1e-9);
  const t = Date.parse("2026-11-03T23:30:00Z");
  const quiet = needles(cfg.races, bl, {}, {}, cfg, t, {});
  const res = needles(cfg.races, bl, {}, {}, cfg, t, { "VA-05": counts });
  assert.deepEqual(res.national.used, ["VA-05"]);
  assert.ok(res.national.shift > 0.01 && res.national.shift < 0.03, String(res.national.shift));
  assert.ok(res.byRace.TX.est.p > quiet.byRace.TX.est.p);
});

test("Virginia House district totals from the results API", async () => {
  const { virginiaHouse } = await import("../scripts/sources/states.mjs");
  const cfg = JSON.parse(fs.readFileSync(new URL("../config/races.json", import.meta.url)));
  const bw = cfg.bellwethers.list.find((b) => b.id === "VA-01");
  const t = (x) => [{ languageId: "en", text: x }];
  const items = [
    { name: t("Member, United States Senate"), reportingStatus: { reportingUnits: 1, totalUnits: 133 }, summaryResults: { ballotOptions: [{ name: t("Mark R. Warner"), voteCount: 5, party: { abbreviation: "D" } }] } },
    { name: t("Member, House of Representatives (1st District)"), reportingStatus: { reportingUnits: 6, totalUnits: 18 },
      summaryResults: { ballotOptions: [
        { name: t("Shannon L. Taylor"), voteCount: 1200, party: { abbreviation: "D" } },
        { name: t("Robert J. Wittman"), voteCount: 1100, party: { abbreviation: "R" } },
        { name: t("Write In"), voteCount: 7, party: null }] } },
    { name: t("Member, House of Representatives (11th District)"), reportingStatus: { reportingUnits: 0, totalUnits: 3 }, summaryResults: { ballotOptions: [] } },
  ];
  const r = virginiaHouse(items, bw);
  assert.equal(r.left, 1200); assert.equal(r.right, 1100); assert.equal(r.other, 7);
  assert.deepEqual(r.precincts, [6, 18]);
  assert.equal(virginiaHouse(items, { ...bw, district: 4 }), null);
});

test("Kentucky contest totals from the live results page", async () => {
  const { kentuckyContest } = await import("../scripts/sources/states.mjs");
  const cfg = JSON.parse(fs.readFileSync(new URL("../config/races.json", import.meta.url)));
  const bw = cfg.bellwethers.list.find((b) => b.id === "KY-SEN");
  const row = (name, party, abs, total) => `<div class="results-tbl-body-row"> <div class="results-tbl-row results-tbl-row-data"> <div class="results-tbl-col1 results-tbl-row-candidate-name">${name}</div> <div class="results-tbl-col2 results-tbl-row-candidate-party">${party}</div> <div class="results-tbl-col3 results-tbl-row-absentee">${abs}</div> <div class="results-tbl-col4 results-tbl-row-total">${total}</div> <div class="results-tbl-col5 results-tbl-row-percent">50%</div> </div></div>`;
  const block = (title, rows) => `<div class="results-tbl results-tbl-partisan" data-contest-type="1"> <div class="results-tbl-bar" style="x"><div style="flex:8">${title}<span id="results-tbl-subtitle"></span></div> <div>Vote For: 1</div></div> <div class="results-tbl-content"><div class="results-tbl-body">${rows}</div></div></div>`;
  const html = block("MAYOR City of Livermore", row("Sharon BOYKEN", "", "1", "40")) +
    block("UNITED STATES SENATOR", row("Andy BARR", "Republican", "1,000", "12,345") + row("Charles BOOKER", "Democratic", "900", "10,111"));
  assert.deepEqual(kentuckyContest(html, bw, /united states senator/i), { left: 10111, right: 12345, other: 0, precincts: null });
});

test("Indiana House district totals from the results file", async () => {
  const { indianaRace } = await import("../scripts/sources/states.mjs");
  const cfg = JSON.parse(fs.readFileSync(new URL("../config/races.json", import.meta.url)));
  const bw = cfg.bellwethers.list.find((b) => b.id === "IN-01");
  const json = { Root: { StatewideSummary: { Race: [
    { SubSortOrder: "United States Representative, (1) District", OFFICE_TITLE: "United States Representative, First District",
      Candidates: { Candidate: [
        { NAME_ON_BALLOT: "Frank J. Mrvan", PARTY: "D", TOTAL: 5000 },
        { NAME_ON_BALLOT: "Barb Regnitz", PARTY: "R", TOTAL: 4000 },
        { NAME_ON_BALLOT: "Alexander R (Alex) Degman (W/I)", PARTY: "I", TOTAL: 12 }] } },
    { SubSortOrder: "United States Representative, (2) District", OFFICE_TITLE: "United States Representative, Second District",
      Candidates: { Candidate: [{ NAME_ON_BALLOT: "Rudy Yakym", PARTY: "R", TOTAL: 9 }] } },
  ] } } };
  assert.deepEqual(indianaRace(json, bw), { left: 5000, right: 4000, other: 12, precincts: null });
  assert.equal(indianaRace(json, { ...bw, district: 7 }), null);
});
