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
