import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";

const owner = "tompickup23";
const repo = "lancashire";
const branch = "gh-pages";
const councilSlug = "lancashirecc";
const rawDir = path.resolve("data/raw/lancashire_cc");
const manifestDir = path.resolve("data/raw/manifests");
const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
const basePath = `${councilSlug}/data/`;

const exactFiles = new Set([
  "spending-index.json",
  "budgets.json",
  "budgets_summary.json",
  "budgets_govuk.json",
  "budget_mapping.json",
  "budget_variance.json",
  "budget_efficiency.json",
  "budget_insights.json",
  "proposed_budget.json"
]);

function curlJson(url) {
  const output = execFileSync("curl", ["-sS", "-L", url], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64
  });

  return JSON.parse(output);
}

function downloadFile(url, destination) {
  execFileSync("curl", ["-sS", "-L", url, "-o", destination], {
    stdio: "inherit",
    maxBuffer: 1024 * 1024 * 16
  });
}

function isWanted(pathname) {
  if (!pathname.startsWith(basePath)) {
    return false;
  }

  const filename = pathname.slice(basePath.length);
  return exactFiles.has(filename) || /^spending-\d{4}-\d{2}\.json$/.test(filename);
}

mkdirSync(rawDir, { recursive: true });
mkdirSync(manifestDir, { recursive: true });

const tree = curlJson(treeUrl);
const wantedFiles = (tree.tree || [])
  .filter((entry) => entry.type === "blob" && isWanted(entry.path))
  .map((entry) => {
    const relativePath = entry.path.slice(basePath.length);
    return {
      relativePath,
      sourcePath: entry.path,
      rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${entry.path}`
    };
  })
  .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

for (const file of wantedFiles) {
  const destination = path.join(rawDir, file.relativePath);
  downloadFile(file.rawUrl, destination);
}

const manifest = {
  generatedAt: new Date().toISOString(),
  bodyId: "lancashire_cc",
  sourceRepo: `${owner}/${repo}`,
  branch,
  fetchedFileCount: wantedFiles.length,
  files: wantedFiles.map((file) => {
    const destination = path.join(rawDir, file.relativePath);
    const sizeBytes = statSync(destination).size;
    return {
      relativePath: file.relativePath,
      sourcePath: file.sourcePath,
      rawUrl: file.rawUrl,
      sizeBytes
    };
  })
};

writeFileSync(
  path.join(manifestDir, "lancashire_cc.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
);

console.log(`Fetched ${wantedFiles.length} Lancashire CC source files.`);
