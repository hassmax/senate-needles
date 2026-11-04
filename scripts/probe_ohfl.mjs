// One-off: find tonight's Ohio XML file name and Florida's election date. Nothing is written.
import { UA } from "./lib.mjs";
const g = async (u) => { try { const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25000) }); return [r.status, await r.text()]; } catch (e) { return [0, e.message]; } };
const sh = (s, n) => s.replace(/\s+/g, " ").slice(0, n);
const [s1, oh] = await g("https://liveresults.ohiosos.gov/");
const files = [...new Set([...oh.matchAll(/downloadReport\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]))];
console.log("OH page", s1, "files:", files.join(" | "));
for (const f of files.filter((f) => /xml/i.test(f)).slice(0, 6)) {
  const [s, t] = await g(`https://liveresults.ohiosos.gov/Api/v1/download?filename=${encodeURIComponent(f)}`);
  console.log(`OH ${f}: ${s} ${t.length} senate=${/U\.?S\.? Senat|United States Senat/i.test(t)} head=${sh(t, 300)}`);
}
const [s2, csv] = await g("https://liveresults.ohiosos.gov/Api/v1/Contest/GetElectionSummaryCsv");
console.log("OH summary csv", s2, csv.length, sh(csv, 400));
for (const u of ["https://results.elections.myflorida.com/TitlePage.asp?ElectionDate=&DATAMODE=", "https://results.elections.myflorida.com/ElectionRaces.asp?ElectionDate=&DATAMODE=",
  "https://results.elections.myflorida.com/ResultsExtract.Asp?ElectionDate=11/3/2026&OfficialResults=N&PartyRaces=N&DataMode=&FormsButton1=Download"]) {
  const [s, t] = await g(u);
  console.log(`FL ${u}\n  ${s} ${t.length} dates=${[...new Set(t.match(/ElectionDate=[\d\/]+/g) || [])].slice(0, 10).join(",")} head=${sh(t.replace(/<[^>]+>/g, " "), 500)}`);
}
process.exit(0);
