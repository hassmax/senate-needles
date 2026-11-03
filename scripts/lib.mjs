// Small helpers for the collector: fetching with a timeout, reading zip files, parsing CSV/TSV.
import zlib from "node:zlib";

export const UA = "senate-needles/1.0 (+https://github.com/hassmax/senate-needles)";

export async function get(url, { timeout = 20000, headers = {}, as = "text" } = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "*/*", ...headers },
    redirect: "follow",
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  if (as === "json") return res.json();
  if (as === "buffer") return Buffer.from(await res.arrayBuffer());
  if (as === "response") return res;
  return res.text();
}

export const getJSON = (url, opts = {}) => get(url, { ...opts, as: "json" });

// Reads the files in a zip archive (stored or deflated entries). Returns {name: Buffer}.
export function unzip(buf) {
  const out = {};
  // Find the end-of-central-directory record.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad zip directory");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(local + 26), lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + csize);
    out[name] = method === 0 ? data : zlib.inflateRawSync(data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// Splits delimited text into rows of objects keyed by the header row. Handles quoted fields.
export function parseDelimited(text, delim = ",") {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"' && field === "") q = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

export const num = (x) => {
  const n = Number(String(x ?? "").replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// Which side a candidate or party label belongs to for a race: "left", "right" or "other".
export function sideOf(race, { name = "", party = "" } = {}) {
  const n = String(name).toLowerCase(), pa = String(party).toLowerCase();
  const has = (c) => c && n.includes(c.last.toLowerCase());
  if (has(race.left) && !has(race.right)) return "left";
  if (has(race.right) && !has(race.left)) return "right";
  const isParty = (c, s) => (c.party === "D" && /^(d|dem|democrat|democratic)/.test(s)) ||
    (c.party === "R" && /^(r|rep|gop|republican)/.test(s)) || (c.party === "I" && /^(i|ind|independent|np|nonpartisan)/.test(s));
  if (pa) {
    if (isParty(race.left, pa)) return "left";
    if (isParty(race.right, pa)) return "right";
  }
  return "other";
}

export function log(...a) {
  console.log(new Date().toISOString().slice(11, 19), ...a);
}
