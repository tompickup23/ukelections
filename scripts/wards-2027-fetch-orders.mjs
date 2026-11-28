#!/usr/bin/env node
// Fetch the Electoral Changes Orders made from 2023 to 2026 from
// legislation.gov.uk, and keep the text of each order's article 1 (citation
// and commencement) plus, for orders with an article coming into force at the
// 2027 ordinary elections, the whole order (to read what that article does
// and, for a redraw, the schedule naming the new wards and their councillors).
//
// legislation.gov.uk's robots.txt allows these paths with Crawl-delay: 5, so
// the script waits five seconds between requests. Text already in the cache
// is not fetched again.
//
// Output: .cache/wards-2027/orders/<uksi_YYYY_N>.article1.txt and
//         .cache/wards-2027/orders/<uksi_YYYY_N>.xml   (whole order, raw)
//         .cache/wards-2027/orders/index.json  [{id, title, url}]
// The build reads these files; they are cache, not committed.
//
// Usage: node scripts/wards-2027-fetch-orders.mjs [--schedules-only]
// (--schedules-only reuses the cached index and fetches only missing texts.)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOrderCommencement, slugify } from "./lib/wards-2027-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, ".cache/wards-2027/orders");
const UA = "Mozilla/5.0 (compatible; ukelections-research)";
const YEARS = [2023, 2024, 2025, 2026];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function xmlToText(xml) {
  return xml.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "’").replace(/\s+/g, " ").trim();
}

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  await sleep(5000);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function main() {
  mkdirSync(DIR, { recursive: true });
  const indexPath = join(DIR, "index.json");
  let index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : [];
  if (!process.argv.includes("--schedules-only")) {
    index = [];
    for (const y of YEARS) {
      for (let page = 1; page <= 5; page++) {
        const feed = await get(`https://www.legislation.gov.uk/uksi/${y}/data.feed?title=Electoral%20Changes&page=${page}`);
        const entries = [...feed.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
        let n = 0;
        for (const e of entries) {
          const title = xmlToText(e.match(/<title>([^<]*)<\/title>/)[1]);
          const id = e.match(/<id>([^<]*)<\/id>/)[1].replace("http://www.legislation.gov.uk/id/", "");
          if (!/Electoral Changes/.test(title)) continue;
          index.push({ id, title, url: `https://www.legislation.gov.uk/${id}/made` });
          n++;
        }
        if (!n) break;
      }
    }
    writeFileSync(indexPath, JSON.stringify(index, null, 1));
  }
  const c27 = JSON.parse(readFileSync(join(ROOT, "data/identity/councils-2027.json"), "utf8"));
  const scope = new Set([...c27.councils.filter((c) => c.nation === "E").map((c) => c.slug), ...c27.not_verified.map((c) => c.slug)]);
  for (const o of index) {
    const f = join(DIR, `${o.id.replace(/\//g, "_")}.article1.txt`);
    if (!existsSync(f)) writeFileSync(f, xmlToText(await get(`https://www.legislation.gov.uk/${o.id}/article/1/made/data.xml`)));
    const c = parseOrderCommencement(readFileSync(f, "utf8"));
    // The whole order (raw XML) for every in-scope council's order that
    // changes wards in 2024 or later: it says what happens in 2027, either a
    // redraw or who retires.
    const m = o.title.match(/^The (.+?) \(Electoral Changes\)/);
    if (!m || !scope.has(slugify(m[1])) || !c.ward_change_years.some((y) => y >= 2024)) continue;
    const x = join(DIR, `${o.id.replace(/\//g, "_")}.xml`);
    if (!existsSync(x)) writeFileSync(x, await get(`https://www.legislation.gov.uk/${o.id}/made/data.xml`));
  }
  console.log(`${index.length} orders indexed in ${DIR}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
