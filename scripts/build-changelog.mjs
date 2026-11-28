#!/usr/bin/env node
// build-changelog.mjs
//
// Writes data/transparency/changelog.json, the source of the public changelog
// at /changelog/, from the pull requests merged into main.
//
// The page reads only the committed JSON, so the site never needs git or the
// GitHub API at build time. This script is the one place either is consulted.
//
//   1. `gh pr list --state merged --base main` gives every merged pull request
//      with its exact merge time. That time is the entry's date: an entry can
//      never claim a change before it reached main.
//   2. `git log --merges` on main confirms the merge commits are present. A PR
//      merged by squash or rebase has no merge commit, so it is reported but
//      still included; GitHub's merge time is authoritative either way.
//   3. data/transparency/changelog-copy.json holds the reader-language line and
//      category for each PR, or omit: true with a reason for pure chores.
//      Developer titles never reach the page: a merged PR with no copy entry
//      stops the script, listing what needs writing.
//
// The file carries no generated-at clock time. `updated_at` is the newest merge it
// covers, so rerunning on the same history produces the same bytes.
//
// Usage:
//   node scripts/build-changelog.mjs              write the file
//   node scripts/build-changelog.mjs --check      fail if the file is out of date
//   node scripts/build-changelog.mjs --since=2026-08-01

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const REPO = "tompickup23/ukelections";
const ROOT = process.cwd();
const COPY_PATH = path.join(ROOT, "data/transparency/changelog-copy.json");
const OUT_PATH = path.join(ROOT, "data/transparency/changelog.json");
export const CATEGORIES = ["data", "results", "model", "pages", "corrections"];
export const BANNED_DASHES = /[‒–—―]| - |&[mn]dash;|&#821[12];/;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const SINCE = typeof args.since === "string" ? args.since : "2026-08-01";

/** YYYY-MM-DD of an instant in UK time, the date a UK reader would give it. */
export function londonDate(iso) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function run(cmd, cmdArgs) {
  return execFileSync(cmd, cmdArgs, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function mergedPullRequests() {
  const json = run("gh", [
    "pr", "list", "--repo", REPO, "--state", "merged", "--base", "main",
    "--limit", "2000", "--search", `merged:>=${SINCE}`,
    "--json", "number,title,mergedAt",
  ]);
  return JSON.parse(json).filter((pr) => pr.mergedAt && londonDate(pr.mergedAt) >= SINCE);
}

function mergeCommitPrNumbers() {
  let ref = "origin/main";
  try {
    run("git", ["rev-parse", "--verify", "--quiet", ref]);
  } catch {
    ref = "main";
  }
  const log = run("git", ["log", ref, "--merges", `--since=${SINCE}`, "--format=%s"]);
  const numbers = new Set();
  for (const line of log.split("\n")) {
    const m = line.match(/^Merge pull request #(\d+)/);
    if (m) numbers.add(Number(m[1]));
  }
  return numbers;
}

export function buildEntries(prs, copy) {
  const missing = [];
  const problems = [];
  const entries = [];
  for (const pr of prs) {
    const c = copy[String(pr.number)];
    if (!c) {
      missing.push(`#${pr.number} ${pr.title}`);
      continue;
    }
    if (c.omit) {
      if (!c.reason) problems.push(`#${pr.number} is omitted without a reason`);
      continue;
    }
    if (!CATEGORIES.includes(c.category)) problems.push(`#${pr.number} has unknown category ${c.category}`);
    if (!c.summary || BANNED_DASHES.test(c.summary)) problems.push(`#${pr.number} summary is empty or has a banned dash`);
    entries.push({
      date: londonDate(pr.mergedAt),
      merged_at: pr.mergedAt,
      pr: pr.number,
      url: `https://github.com/${REPO}/pull/${pr.number}`,
      category: c.category,
      summary: c.summary,
    });
  }
  entries.sort((a, b) => (a.merged_at < b.merged_at ? 1 : a.merged_at > b.merged_at ? -1 : b.pr - a.pr));
  return { entries, missing, problems };
}

function main() {
  const copy = JSON.parse(readFileSync(COPY_PATH, "utf8")).entries;
  const prs = mergedPullRequests();
  const merges = mergeCommitPrNumbers();

  const { entries, missing, problems } = buildEntries(prs, copy);
  if (missing.length || problems.length) {
    if (missing.length) {
      console.error(`${missing.length} merged pull request(s) have no reader copy in ${path.relative(ROOT, COPY_PATH)}:`);
      for (const m of missing) console.error(`  ${m}`);
    }
    for (const p of problems) console.error(`  ! ${p}`);
    process.exit(1);
  }

  const noMergeCommit = prs.filter((pr) => !merges.has(pr.number)).map((pr) => pr.number);
  if (noMergeCommit.length) {
    console.warn(`  note: no merge commit on main for #${noMergeCommit.join(", #")} (squash or rebase merge); GitHub's merge time used`);
  }

  const omitted = prs.length - entries.length;
  const doc = {
    _about:
      "Public changelog for ukelections.co.uk, one entry per merged pull request on main since " +
      `${SINCE}. Written by scripts/build-changelog.mjs from GitHub's merge records and the reader copy in ` +
      "changelog-copy.json. date is the UK date of the merge. Dependency updates, CI and internal tooling are left out.",
    since: SINCE,
    updated_at: entries[0]?.merged_at ?? null,
    omitted_count: omitted,
    entries,
  };
  const text = JSON.stringify(doc, null, 2) + "\n";

  if (args.check) {
    const current = readFileSync(OUT_PATH, "utf8");
    if (current !== text) {
      console.error("changelog.json is out of date; run node scripts/build-changelog.mjs");
      process.exit(1);
    }
    console.log(`changelog.json is current: ${entries.length} entries`);
    return;
  }
  writeFileSync(OUT_PATH, text);
  console.log(`wrote ${path.relative(ROOT, OUT_PATH)}: ${entries.length} entries, ${omitted} chores left out`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
