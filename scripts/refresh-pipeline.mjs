#!/usr/bin/env node
// Single-command full refresh: ingest → features → predictions → backtest →
// Senedd → Holyrood → build → deploy.
//
// Usage:
//   node scripts/refresh-pipeline.mjs              # all phases
//   node scripts/refresh-pipeline.mjs --skip-fetch # skip remote ingest, reuse cache
//   node scripts/refresh-pipeline.mjs --no-deploy  # build but don't push to CF Pages
//
// Designed to be run from cron (vps-main, daily) or manually before launch.
// Exits non-zero on first failure so cron sends an alert.

import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const args = new Set(process.argv.slice(2));
const skipFetch = args.has("--skip-fetch");
const noDeploy = args.has("--no-deploy");

function step(label, cmd, cmdArgs = [], opts = {}) {
  const { softFailExitCodes = [], ...spawnOpts } = opts;
  process.stdout.write(`\n=== [${new Date().toISOString()}] ${label} ===\n`);
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, stdio: "inherit", env: process.env, ...spawnOpts });
  if (r.status !== 0) {
    // Some steps distinguish "did not finish cleanly" from "must not deploy".
    // A by-election contest whose candidate list was rate-limited is worth
    // shouting about and re-running, but it must not stop the nightly build.
    if (softFailExitCodes.includes(r.status)) {
      process.stderr.write(`\n!!! SOFT FAIL [${label}] exit=${r.status}, continuing\n`);
      softFailures.push(`${label} (exit ${r.status})`);
      return;
    }
    process.stderr.write(`\n!!! FAIL [${label}] exit=${r.status} signal=${r.signal}\n`);
    process.exit(r.status || 1);
  }
}

const softFailures = [];

function run(label, scriptPath, opts = {}) {
  if (scriptPath === null) {
    // Python step
    step(label, "python3", ["scripts/aggregate-lsoa-to-ward-demographics.py"], opts);
  } else {
    step(label, "node", [scriptPath], opts);
  }
}

// Pull before doing anything, on the server only.
//
// This pipeline had no git in it at all. The vps-main checkout only ever moved
// when the SEPARATE Friday by-election cron happened to pull, so merged work
// sat unbuilt for days: the 20 June CSP and search fix had never gone live when
// it was found on 11 July. It is worse than untidy for anything time-critical.
// Council by-elections poll on a Thursday and the Friday pull is the day AFTER,
// so without this a contest that polled on Thursday would still read "Upcoming"
// all through Friday.
//
// --autostash because the server checkout is permanently dirty with generated
// data, and --ff-only so this can never invent a merge. A failure here is
// reported and the run continues on the code already present, which is strictly
// better than not refreshing at all. Nothing reaches production without passing
// step 8's test suite first.
if (process.env.UKE_ON_VPS_MAIN === "1" && !process.argv.includes("--no-pull")) {
  process.stdout.write(`\n=== [${new Date().toISOString()}] 0. Pull latest main ===\n`);
  const before = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim();
  const pull = spawnSync("git", ["pull", "--ff-only", "--autostash", "origin", "main"], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  const after = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim();
  if (pull.status !== 0) {
    process.stderr.write(`\n!!! SOFT FAIL [0. Pull latest main] exit=${pull.status}, continuing on ${after}\n`);
    softFailures.push(`0. Pull latest main (exit ${pull.status})`);
  } else {
    process.stdout.write(before === after ? `already current at ${after}\n` : `${before} -> ${after}\n`);
  }
}

const phases = [];

if (!skipFetch) {
  phases.push(["1a. Refresh Democracy Club ballot scope (May 7 2026)", "scripts/build-may-2026-scope.mjs"]);
  phases.push(["1b. Refresh Democracy Club historic results", "scripts/ingest-dc-historic-results.mjs"]);
  phases.push(["1c. Refresh polling override from Wikipedia rolling avg", "scripts/refresh-polling.mjs"]);
} else {
  process.stdout.write("(skipping remote DC fetches — reusing cached ingest files)\n");
}
phases.push(["2. Build ward identity table", "scripts/build-ward-identity.mjs"]);
phases.push(["2b. Ingest LEAP archive (Andrew Teale 2009-2017 supplemental)", "scripts/ingest-leap.mjs"]);
phases.push(["3. Build LA features (HP v7.0 + IMD + GE2024)", "scripts/build-la-features.mjs"]);
phases.push(["3b. Aggregate Census 2021 + IMD LSOA → ward (P3)", null /* python */ ]);
phases.push(["3c. Calibrate regional dampening (P5)", "scripts/calibrate-regional-dampening.mjs"]);
// 3d builds BES Wave 1-30 LAD priors. Skipped automatically if .sav not staged.
phases.push(["3d. Build BES Wave 1-30 priors", "scripts/build-bes-priors-wrapper.mjs"]);
phases.push(["4. Run bulk ward predictions (locals + mayors)", "scripts/run-bulk-predictions.mjs"]);
phases.push(["5. Run 2024 backtest", "scripts/run-2024-backtest.mjs"]);
phases.push(["6. Run Senedd 2026 predictions", "scripts/run-senedd-predictions.mjs"]);
phases.push(["7. Run Holyrood 2026 predictions", "scripts/run-holyrood-predictions.mjs"]);
phases.push(["7a. Build GE PCON identity table", "scripts/ingest-pcon-identity.mjs"]);
phases.push(["7b. Run GE2024 backtest", "scripts/run-ge-backtest.mjs"]);
phases.push(["7c. Run GE next-election bulk forecast (650 PCONs)", "scripts/run-ge-predictions.mjs"]);
// 7f rebuilds one page per scheduled council by-election. It must run every
// night, not weekly: contests are added continuously, nominations close on
// their own timetable, and a contest that has polled still says "Upcoming"
// until this regenerates. It exits 2 when a request got no answer, which is a
// signal to re-run rather than a pipeline failure, so it is allowed to soft-fail.
phases.push(["7f. Build council by-election contests", "scripts/build-local-byelections.mjs", { softFailExitCodes: [2] }]);
// 7g renders each contest's share card. After 7f, because it reads what 7f
// wrote, and before the site build, because the page only advertises a card
// that already exists on disk.
phases.push(["7g. Render by-election share cards", "scripts/build-byelection-cards.mjs"]);
// 7d/7e (Makerfield 2026-06-18 by-election forecast + analysis) were REMOVED on
// 19 Jun 2026: the contest concluded on 18 Jun (Labour hold, Burnham). The
// forecast is now frozen as a post-mortem (status: "concluded" in the JSON) and
// graded against the result by scripts/finalise-makerfield-result.mjs. Re-running
// the daily generators would clobber the frozen forecast + result blocks; both
// generators also self-guard against overwriting a concluded file. Re-add a phase
// here only when a NEW by-election forecast is created.

for (const [label, scriptPath, opts] of phases) run(label, scriptPath, opts);

step("8. Run vitest suite", "npm", ["test", "--silent"]);
// BUILD_OG switched ON 23 Aug 2026 after the supervised timed run the old
// comment here asked for: on vps-main the full build with the Satori pass
// took 7m52s wall (456s Astro build), exit 0, 811 cards, 74MB in dist/og/.
// The 31-minute figure was a loaded Mac and does not transfer. BaseLayout
// only advertises cards a build actually rendered, so a build with the flag
// accidentally unset degrades to /og-default.png rather than dangling.
step("9. Build Astro static site", "npm", ["run", "build"], { env: { ...process.env, BUILD_OG: "1" } });

// Technical SEO gate over the rendered output, between build and deploy. It
// catches the class of defect the unit tests structurally cannot: a page with
// no h1, a page nothing links to, an attribution rendered as a link target.
// Hard-fails only on binary defects; length budgets are compared against the
// counts recorded when the gate landed, so they can fall but not rise. Every
// check has a fixture in tests/audit-seo.test.ts proving it fires.
step("9b. Technical SEO gate", "node", ["scripts/audit-seo.mjs", "dist"]);

if (!noDeploy) {
  process.stdout.write("\n=== 10. Deploy to Cloudflare Pages via vps-main ===\n");
  // Detect whether we're already running on vps-main (cron context) — if so,
  // skip the rsync and deploy from the local dist directly. Otherwise rsync
  // from a developer machine to vps-main first.
  const onVpsMain = process.env.UKE_ON_VPS_MAIN === "1"
    || (() => {
      try {
        const hostname = spawnSync("hostname", [], { encoding: "utf8" }).stdout.trim();
        return /vps-main|hostinger|srv\d+/i.test(hostname);
      } catch { return false; }
    })();
  if (onVpsMain) {
    step(
      "10. wrangler pages deploy (running on vps-main; deploy from local dist)",
      "bash",
      ["-c", "set -a; . /opt/dashboard/.env; set +a; wrangler pages deploy dist --project-name ukelections --branch main --commit-dirty=true"],
    );
  } else {
    step("10a. rsync dist to vps-main", "rsync", ["-az", "--delete", "dist/", "vps-main:/tmp/ukelections-dist/"]);
    step(
      "10b. wrangler pages deploy",
      "ssh",
      [
        "vps-main",
        "set -a; . /opt/dashboard/.env; set +a; wrangler pages deploy /tmp/ukelections-dist --project-name ukelections --branch main --commit-dirty=true",
      ],
    );
  }
} else {
  process.stdout.write("\n(skipping deploy — --no-deploy set)\n");
}

process.stdout.write(`\n=== Pipeline complete [${new Date().toISOString()}] ===\n`);
if (softFailures.length) {
  // Deliberately after the deploy: the site went out, but something in it is
  // staler than it should be and somebody needs to look.
  process.stdout.write(`\n!!! ${softFailures.length} step(s) soft-failed and need a re-run:\n`);
  for (const f of softFailures) process.stdout.write(`    ${f}\n`);
  process.exitCode = 2;
}
