#!/usr/bin/env node
// Shadow by-election swing variant. Protocol: docs/byelection-shadow-variant-2026-11.md
//
//   node scripts/shadow-byelection-variant.mjs           print the running score table
//   node scripts/shadow-byelection-variant.mjs --write   also add shadow forecasts for
//                                                        contests that have none yet
//
// Research only. Writes one file, data/transparency/byelection-shadow-variant.json,
// which no page reads. A forecast once written is never overwritten.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SHADOW_CUT,
  SHADOW_FILE,
  addShadowForecast,
  emptyShadowFile,
  scoreContest,
  shadowForecastForContest,
  summarise,
} from "./lib/byelection-shadow-variant.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTEST_DIR = path.join(ROOT, "data/contests/local-byelections");
const PUBLISHED = path.join(ROOT, "data/cards/published-byelection-forecasts.json");

export function readShadowFile(file = path.join(ROOT, SHADOW_FILE)) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : emptyShadowFile();
}

export function readContests(dir = CONTEST_DIR) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
    .filter((c) => (c.contest?.polling_day || "") >= SHADOW_CUT);
}

/**
 * Add a shadow forecast for every eligible contest that lacks one. Contests
 * already in the file are left exactly as they are; addShadowForecast throws
 * if asked to replace one, so a bug here cannot overwrite silently.
 */
export function writeNewForecasts(file, contests, corpus, generatedAt) {
  let out = file;
  const added = [];
  const kept = [];
  for (const c of contests) {
    if (Object.prototype.hasOwnProperty.call(out.forecasts, c.slug)) {
      kept.push(c.slug);
      continue;
    }
    const entry = shadowForecastForContest(c, corpus, { generatedAt });
    if (!entry) continue;
    out = addShadowForecast(out, entry);
    added.push(c.slug);
  }
  return { file: out, added, kept };
}

export function scoreAll(file, contests, published) {
  const scores = [];
  for (const c of contests) {
    const shadow = file.forecasts[c.slug];
    const pub = published[c.slug];
    if (!shadow || !pub?.central_pct || !c.result?.shares || c.contest.voting_system === "STV") continue;
    if (shadow.result_in_repo_at_generation !== false) continue;
    scores.push({
      slug: c.slug,
      ...scoreContest({ shadowPct: shadow.central_pct, publishedPct: pub.central_pct, resultShares: c.result.shares }),
    });
  }
  return scores;
}

async function loadCorpus() {
  const { loadHistory, buildPriorIndex, loadPagePriors, corpusPriorFinder } = await import("./build-local-byelections.mjs");
  const { buildSwingCorpus } = await import("./lib/local-byelection-model.mjs");
  const priors = buildPriorIndex(loadHistory());
  return buildSwingCorpus(priors.byelectionRows, corpusPriorFinder(priors, loadPagePriors()));
}

const f1 = (x) => (x === null ? "-" : x.toFixed(2));

async function main() {
  const write = process.argv.includes("--write");
  const contests = readContests();
  let file = readShadowFile();

  if (write) {
    const corpus = await loadCorpus();
    const res = writeNewForecasts(file, contests, corpus, new Date().toISOString());
    file = res.file;
    if (res.added.length) {
      fs.writeFileSync(path.join(ROOT, SHADOW_FILE), JSON.stringify(file, null, 2) + "\n");
    }
    console.log(`Shadow forecasts added: ${res.added.length}${res.added.length ? ` (${res.added.join(", ")})` : ""}`);
    console.log(`Already written, left alone: ${res.kept.length}`);
  }

  const published = JSON.parse(fs.readFileSync(PUBLISHED, "utf8")).forecasts;
  const scores = scoreAll(file, contests, published);
  console.log(`\nShadow forecasts on file: ${Object.keys(file.forecasts).length}. Scored contests: ${scores.length}.`);
  if (!scores.length) {
    console.log("No contest yet has both a shadow forecast and a declared result. That is expected early on.");
    return;
  }
  console.log("\ncontest".padEnd(58), "shadow MAE  published MAE  shadow called  published called");
  for (const s of scores) {
    console.log(
      s.slug.padEnd(57),
      f1(s.shadow.mae).padStart(10),
      f1(s.published.mae).padStart(14),
      String(s.shadow.called).padStart(14),
      String(s.published.called).padStart(17),
    );
  }
  const t = summarise(scores);
  console.log(`\n${t.contests} contests (${t.restore_standing} with Restore Britain standing); minimum for a decision is 15.`);
  console.log(`MAE per party, points: shadow ${f1(t.shadow.mae)}, published ${f1(t.published.mae)}`);
  console.log(`Winners called: shadow ${t.shadow.called}, published ${t.published.called}`);
  console.log(`Reform UK mean signed error, points: shadow ${f1(t.shadow.reform_bias)}, published ${f1(t.published.reform_bias)}`);
  console.log(`Shadow lower error in ${t.shadow_better_per_contest} of ${t.contests} contests`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
