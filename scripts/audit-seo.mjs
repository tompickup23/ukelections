#!/usr/bin/env node
/**
 * Technical SEO gate over the built site.
 *
 * Written 27 Aug 2026 after a hand audit found defects that had been live for
 * months and that nothing in the test suite could have caught, because they
 * only exist in the rendered output: 590 constituency pages with no internal
 * link pointing at them, a homepage with no h1, and ~2,300 attribution strings
 * rendered as link targets.
 *
 * Two classes of check:
 *
 *   HARD   binary defects. Any occurrence exits non-zero.
 *   BUDGET counts that should not regress. Compared against BUDGETS below, which
 *          are set at the measured value on the day this landed, so the number
 *          can fall freely and any rise fails.
 *
 * Every hard check has a fixture in tests/audit-seo.test.ts proving it can
 * actually fail. A gate nobody has seen fail is decoration.
 */
import { readFileSync, existsSync, globSync } from "node:fs";
import path from "node:path";

export const BUDGETS = {
  titleOver60: 1652,
  titleOver70: 706,
  descOver155: 37,
  descUnder70: 473
};

const HARD = [
  "noTitle",
  "noDesc",
  "noH1",
  "multiH1",
  "noCanonical",
  "canonicalNotAbsolute",
  "noLang",
  "noOgImage",
  "imgNoAlt",
  "badJsonLd",
  "junkHref",
  "duplicateTitles",
  "orphanPages"
];

const SITE = "https://ukelections.co.uk";

export function auditDir(distDir) {
  const files = globSync(path.join(distDir, "**/*.html"));
  const counts = {};
  const examples = {};
  const bump = (k, ex) => {
    counts[k] = (counts[k] || 0) + 1;
    if (ex && (examples[k] ||= []).length < 5) examples[k].push(ex);
  };

  const titles = new Map();
  const linksFrom = new Map();

  for (const file of files) {
    const html = readFileSync(file, "utf8");
    const url = "/" + path.relative(distDir, file).replace(/index\.html$/, "").replace(/\\/g, "/");
    // Inline SVG carries its own <title>, and scripts carry markup in strings.
    const body = html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<script[\s\S]*?<\/script>/g, "");
    const isNoIndex = /<meta name="robots" content="noindex/.test(html);

    const title = html.match(/<title>(.*?)<\/title>/s)?.[1];
    const desc = html.match(/<meta name="description" content="(.*?)"/s)?.[1];

    if (!title) bump("noTitle", url);
    else {
      titles.set(title, (titles.get(title) || 0) + 1);
      if (title.length > 60) bump("titleOver60");
      if (title.length > 70) bump("titleOver70");
    }
    if (!desc) bump("noDesc", url);
    else {
      if (desc.length > 155) bump("descOver155");
      if (desc.length < 70) bump("descUnder70");
    }

    const h1s = body.match(/<h1[\s>]/g) || [];
    if (h1s.length === 0) bump("noH1", url);
    if (h1s.length > 1) bump("multiH1", url);

    const canonical = html.match(/<link rel="canonical" href="(.*?)"/)?.[1];
    if (!canonical) bump("noCanonical", url);
    else if (!canonical.startsWith(SITE)) bump("canonicalNotAbsolute", `${url} -> ${canonical}`);

    if (!/<html lang="en-GB"/.test(html)) bump("noLang", url);
    if (!/<meta property="og:image"/.test(html)) bump("noOgImage", url);

    for (const img of body.match(/<img\b[^>]*>/g) || []) {
      if (!/\balt=/.test(img)) bump("imgNoAlt", `${url} :: ${img.slice(0, 80)}`);
    }

    for (const block of html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g) || []) {
      const raw = block.replace(/^[^>]*>/, "").replace(/<\/script>$/, "");
      try {
        JSON.parse(raw);
      } catch {
        bump("badJsonLd", url);
      }
    }

    // A source field holding an attribution rather than a URL invents a
    // relative link under the current page. See src/lib/seo.ts externalHref().
    for (const href of body.match(/href="[^"]*"/g) || []) {
      const value = href.slice(6, -1);
      if (/^(https?:\/\/|\/|#|mailto:|tel:)/.test(value) && !/\s/.test(value)) continue;
      bump("junkHref", `${url} :: ${href.slice(0, 80)}`);
    }

    const internal = new Set();
    for (const a of body.match(/href="\/[^"]*"/g) || []) internal.add(a.slice(6, -1).split("#")[0]);
    if (!isNoIndex) linksFrom.set(url, internal);
    else linksFrom.set(url, internal), (counts.__noindex = (counts.__noindex || 0) + 1);
    if (isNoIndex) (examples.__noindexUrls ||= []).push(url);
  }

  for (const [title, n] of titles) if (n > 1) bump("duplicateTitles", `${n}x ${title.slice(0, 70)}`);

  // Reachability from the homepage by following internal links.
  const noindex = new Set(examples.__noindexUrls || []);
  const all = new Set([...linksFrom.keys()].filter((u) => !noindex.has(u)));
  const seen = new Set(["/"]);
  let frontier = ["/"];
  while (frontier.length) {
    const next = [];
    for (const u of frontier)
      for (const raw of linksFrom.get(u) || []) {
        const l = raw.endsWith("/") ? raw : `${raw}/`;
        if (all.has(l) && !seen.has(l)) {
          seen.add(l);
          next.push(l);
        }
      }
    frontier = next;
  }
  for (const u of all) if (!seen.has(u)) bump("orphanPages", u);

  delete counts.__noindex;
  delete examples.__noindexUrls;
  return { pages: files.length, counts, examples };
}

export function evaluate(result, budgets = BUDGETS) {
  const failures = [];
  for (const key of HARD) {
    if (result.counts[key]) {
      failures.push({ key, kind: "hard", count: result.counts[key], examples: result.examples[key] || [] });
    }
  }
  for (const [key, budget] of Object.entries(budgets)) {
    const actual = result.counts[key] || 0;
    if (actual > budget) failures.push({ key, kind: "budget", count: actual, budget, examples: [] });
  }
  return failures;
}

// Entry point. Skipped when imported by the test suite.
if (process.argv[1] && process.argv[1].endsWith("audit-seo.mjs")) {
  const dist = process.argv[2] || "dist";
  if (!existsSync(dist)) {
    console.error(`[audit-seo] ${dist} does not exist. Run the build first.`);
    process.exit(2);
  }
  const result = auditDir(dist);
  const failures = evaluate(result);
  console.log(`[audit-seo] ${result.pages} pages`);
  for (const [k, v] of Object.entries(result.counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }
  if (!failures.length) {
    console.log("[audit-seo] PASS");
    process.exit(0);
  }
  console.error("\n[audit-seo] FAIL");
  for (const f of failures) {
    console.error(
      f.kind === "hard"
        ? `  HARD ${f.key}: ${f.count}` + (f.examples.length ? `\n       ${f.examples.join("\n       ")}` : "")
        : `  BUDGET ${f.key}: ${f.count}, over the ${f.budget} recorded when this gate landed`
    );
  }
  process.exit(1);
}
