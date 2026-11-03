// Source check: fetches each candidate source and prints what came back (status, type, size, CORS
// header, the first bytes, and any data links found on the page). Run by the "Check sources"
// workflow; nothing is written. Usage: node scripts/probe.mjs [group ...]
const ORIGIN = "https://hassmax.github.io";
const UA = "senate-needles/1.0 (election-night results check)";

const groups = {
  extra: [
    "https://enr.elections.virginia.gov/results/public/virginia/elections/2026-November-General",
    "https://enr.elections.virginia.gov/results/public/api/elections/virginia/2026-November-General",
    "https://enr.elections.virginia.gov/results/public/api/elections/Virginia/2026-November-General",
    "https://enr.elections.virginia.gov/results/public/api/elections/virginia/2026-August-Democratic-Primary",
  ],
  states: [
    // South Carolina, Iowa, Kansas: Clarity election-night reporting; find the current election id.
    "https://results.enr.clarityelections.com/SC/",
    "https://www.scvotes.gov/election-results",
    "https://results.enr.clarityelections.com/IA/",
    "https://electionresults.iowa.gov/",
    "https://sos.iowa.gov/elections/results/index.html",
    "https://results.enr.clarityelections.com/KS/",
    "https://sos.ks.gov/elections/elections-results.html",
    "https://sos.ks.gov/elections/election-results.html",
    // Florida: tab-separated election-night file.
    "https://fldoselectionfiles.elections.myflorida.com/enightfilespublic/20261103_ElecResultsFL.txt",
    "https://results.elections.myflorida.com/",
    // Texas: Civix results site.
    "https://results.texas-election.com/",
    "https://goelect.txelections.civixapps.com/api-ivis-system/api/s3/enr/electionConstants",
    "https://goelect.txelections.civixapps.com/api-ivis-system/api/s3/enr/electionsList",
    // Ohio
    "https://liveresults.ohiosos.gov/",
    // Michigan
    "https://mielections.us/election/results/",
    "https://mielections.us/election/results/2026GEN_CENR.html",
    // Nebraska
    "https://electionresults.nebraska.gov/",
    "https://electionresults.nebraska.gov/resultsSW.aspx?type=FED",
    // Alaska
    "https://www.elections.alaska.gov/results/26GENR/",
    "https://www.elections.alaska.gov/election-results/",
    // Maine (no live count expected)
    "https://www.maine.gov/sos/cec/elec/results/index.html",
  ],
  markets: [
    ...["AK", "IA", "KS", "ME", "OH", "TX", "MI", "NE", "FL", "SC"].flatMap((s) => [
      `https://api.elections.kalshi.com/trade-api/v2/events/SENATE${s}-26?with_nested_markets=true`,
      `https://api.elections.kalshi.com/trade-api/v2/events/SENATE${s}S-26?with_nested_markets=true`,
    ]),
    "https://api.elections.kalshi.com/trade-api/v2/events/CONTROLS-2026?with_nested_markets=true",
    ...["Alaska", "Iowa", "Kansas", "Maine", "Ohio", "Texas", "Michigan", "Nebraska", "Florida", "South Carolina"].map(
      (s) => `https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(s + " Senate election")}&limit_per_type=5`),
  ],
  social: [
    "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=Senate%20race%20call&sort=latest&limit=3",
    "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=apnews.com&limit=2",
    "https://api.bsky.app/xrpc/app.bsky.actor.getProfiles?" + [
      "apnews.com", "nytimes.com", "washingtonpost.com", "npr.org", "politico.com", "cnn.com", "nbcnews.com",
      "cbsnews.com", "reuters.com", "axios.com", "decisiondeskhq.com", "ddhq.bsky.social", "gelliottmorris.com",
      "natesilver.bsky.social", "splitticket.bsky.social", "cookpolitical.com", "centerforpolitics.org",
      "electionhq.bsky.social", "steveko.bsky.social", "taniel.bsky.social", "jbouie.bsky.social",
      "redistrict.bsky.social", "wassermandave.bsky.social", "natecohn.bsky.social", "politicalwire.com",
      "thehill.com", "abcnews.bsky.social", "punchbowlnews.com", "semafor.com", "theguardian.com",
    ].map((h) => "actors=" + h).join("&"),
    "https://news.google.com/rss/search?q=%22Maine%22+Senate+Collins+Jackson&hl=en-US&gl=US&ceid=US:en",
  ],
};

function short(s, n = 500) {
  return s.replace(/\s+/g, " ").slice(0, n);
}

async function probe(url, out = console.log) {
  const console = { log: out };
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Origin: ORIGIN, Accept: "*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get("content-type") || "";
    const text = /json|text|xml|html|javascript/.test(type) || buf.length < 200000 ? buf.toString("utf8") : "";
    console.log(`\n=== ${url}`);
    console.log(`status ${res.status} final ${res.url} type ${type} bytes ${buf.length} ms ${Date.now() - t0}`);
    if (res.status === 202 || res.status === 403) console.log("headers:", JSON.stringify(Object.fromEntries(res.headers)));
    for (const k of ["api/", "Congress", "Representative", "ballotItems", "ballot-items", "voteCount"]) {
      const i = text.indexOf(k);
      if (i >= 0 && !/kalshi|polymarket|bsky|google/.test(url)) console.log(`near "${k}":`, short(text.slice(Math.max(0, i - 400), i + 1200), 1600));
    }
    console.log(`cors ${res.headers.get("access-control-allow-origin")} cache ${res.headers.get("cache-control")} last-mod ${res.headers.get("last-modified")}`);
    if (/json/.test(type) || /^[\[{]/.test(text.trim())) {
      try {
        const j = JSON.parse(text);
        summarizeJson(url, j, console);
      } catch {
        console.log("head:", short(text, 800));
      }
    } else {
      console.log("head:", short(text, 600));
      const links = new Set();
      for (const m of text.matchAll(/(?:href|src)=["']([^"']+)["']/gi)) {
        const l = m[1];
        if (/clarity|\.json|\.zip|\.txt|\.csv|\.xml|api|results|download|data/i.test(l)) links.add(l);
      }
      for (const m of text.matchAll(/https?:\/\/[^\s"'<>]*(?:clarityelections|api|\.json|\.zip)[^\s"'<>]*/gi)) links.add(m[0]);
      if (links.size) console.log("links:", [...links].slice(0, 40).join(" | "));
      const scripts = [...text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
      if (scripts.length) console.log("scripts:", scripts.join(" | "));
      if (url.includes("ohiosos")) {
        for (const src of scripts) {
          try {
            const js = await (await fetch(new URL(src, url), { headers: { "User-Agent": UA } })).text();
            const k = js.indexOf("downloadReport");
            if (k >= 0) console.log(`in ${src}:`, short(js.slice(Math.max(0, k - 200), k + 1500), 1700));
          } catch (e) { console.log("script", src, e.message); }
        }
      }
    }
  } catch (e) {
    console.log(`\n=== ${url}\nFAILED ${e.name}: ${e.message} ${e.cause ? e.cause.code || e.cause.message : ""}`);
  }
}

function summarizeJson(url, j, console) {
  if (url.includes("kalshi")) {
    const ev = j.event || {};
    console.log("kalshi event:", ev.event_ticker, "|", ev.title, "|", ev.sub_title);
    for (const m of j.markets || ev.markets || []) {
      console.log("  market", m.ticker, "|", m.yes_sub_title || m.subtitle, "| bid", m.yes_bid, m.yes_bid_dollars, "ask", m.yes_ask, m.yes_ask_dollars, "last", m.last_price, m.last_price_dollars, "status", m.status);
    }
    if (!j.markets && !ev.markets) console.log("raw:", short(JSON.stringify(j), 400));
    return;
  }
  if (url.includes("polymarket")) {
    for (const ev of j.events || []) {
      console.log("poly event:", ev.slug, "|", ev.title, "| closed", ev.closed, "| vol", Math.round(ev.volume || 0));
      for (const m of (ev.markets || []).slice(0, 6)) {
        console.log("   market", m.slug, "|", m.groupItemTitle || m.question, "| outcomes", m.outcomes, "| prices", m.outcomePrices, "| closed", m.closed);
      }
    }
    if (!j.events) console.log("raw:", short(JSON.stringify(j), 400));
    return;
  }
  if (url.includes("getProfiles")) {
    for (const p of j.profiles || []) console.log("  profile", p.handle, "|", p.displayName, "| followers", p.followersCount, "| did", p.did);
    return;
  }
  if (url.includes("searchPosts") || url.includes("getAuthorFeed")) {
    for (const p of (j.posts || (j.feed || []).map((f) => f.post)).slice(0, 3)) {
      console.log("  post", p.author && p.author.handle, p.indexedAt, short((p.record && p.record.text) || "", 120));
    }
    return;
  }
  const keys = (x) => x && typeof x === "object" ? Object.keys(x).slice(0, 30).join(",") : typeof x;
  console.log("json keys:", keys(j), Array.isArray(j) ? `array ${j.length} first keys ${keys(j[0])}` : "");
  console.log("json:", short(JSON.stringify(j), 3500));
}

// Fetch in parallel, print in order (each probe's output is buffered).
const want = process.argv.slice(2);
const realLog = console.log;
for (const [name, urls] of Object.entries(groups)) {
  if (want.length && !want.includes(name)) continue;
  realLog(`\n##### ${name}`);
  const outs = await Promise.all(urls.map(async (u) => {
    const lines = [];
    const run = probe(u, (...a) => lines.push(a.join(" ")));
    await run;
    return lines.join("\n");
  }));
  for (const o of outs) realLog(o);
}
