#!/usr/bin/env node
// Wrapper that runs build-bes-priors.py if the BES SAV is staged, otherwise
// no-ops (so refresh-pipeline.mjs doesn't fail on hosts without BES data).
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");
const SAV = process.env.BES_SAV || join(homedir(), "ukelections/.cache/bes/BES2024_W30_Panel_v30.1.sav");
const VENV_PY = join(REPO, ".venv-bes/bin/python");

if (!existsSync(SAV)) {
  console.log(`(BES SAV not staged at ${SAV} — skipping prior build; predictions will run without BES MRP step)`);
  process.exit(0);
}
const py = existsSync(VENV_PY) ? VENV_PY : "python3";
const r = spawnSync(py, [join(REPO, "scripts/build-bes-priors.py")], { cwd: REPO, stdio: "inherit" });
process.exit(r.status || 0);
