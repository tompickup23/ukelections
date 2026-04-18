import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const rawDir = path.resolve("data/raw/regional_sources");
const manifestDir = path.resolve("data/raw/manifests");

const mediaUrl =
  "https://northwestrsmp.org.uk/wp-json/wp/v2/media?per_page=100&search=North%20West%20Public&_fields=id,date,date_gmt,title,mime_type,source_url,media_details";
const pageUrl =
  "https://northwestrsmp.org.uk/wp-json/wp/v2/pages?slug=data-and-insights&per_page=1&_fields=id,modified,slug,link,title,content";
const pageDownloads = [
  {
    fileName: "migration-yorkshire-statistics.html",
    sourceUrl: "https://www.migrationyorkshire.org.uk/statistics"
  },
  {
    fileName: "migration-yorkshire-refugee-dashboard.html",
    sourceUrl: "https://www.migrationyorkshire.org.uk/statistics/refugee-and-asylum-seeker-dashboard"
  },
  {
    fileName: "migration-yorkshire-ukraine-dashboard.html",
    sourceUrl: "https://www.migrationyorkshire.org.uk/statistics/ukraine-data-dashboard"
  },
  {
    fileName: "migration-yorkshire-euss-dashboard.html",
    sourceUrl: "https://www.migrationyorkshire.org.uk/statistics/european-union-settlement-scheme-dashboard"
  },
  {
    fileName: "nemp-data-page.html",
    sourceUrl: "https://www.nemp.org.uk/data/"
  },
  {
    fileName: "wsmp-dataobservatory.html",
    sourceUrl: "https://www.wsmp.wales/dataobservatory"
  },
  {
    fileName: "migration-observatory-local-data-guide.html",
    sourceUrl: "https://migrationobservatory.ox.ac.uk/projects/local-data-guide/"
  }
];

function curlJson(url) {
  const output = execFileSync("curl", ["-sS", "-L", "-A", "Mozilla/5.0", url], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64
  });

  if (output.trimStart().startsWith("<!DOCTYPE") || output.trimStart().startsWith("<html")) {
    console.warn(`WARN: ${url} returned HTML instead of JSON (possible 403/captcha). Skipping.`);
    return null;
  }
  try {
    return JSON.parse(output);
  } catch (e) {
    console.warn(`WARN: ${url} returned invalid JSON: ${e.message}. Skipping.`);
    return null;
  }
}

function downloadFile(url, destination) {
  execFileSync("curl", ["-sS", "-L", "-A", "Mozilla/5.0", url, "-o", destination], {
    stdio: "inherit",
    maxBuffer: 1024 * 1024 * 64
  });
}

function fileSha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&#038;", "&")
    .replaceAll("&#8211;", "-")
    .replaceAll("&#8217;", "'")
    .replaceAll("&#8220;", "\"")
    .replaceAll("&#8221;", "\"")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeBy(rows, getKey) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = getKey(row);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildWorkbookFileName(document, dateCounts) {
  const publishedAt = String(document.publishedAt || "undated").slice(0, 10);
  const suffix = dateCounts.get(publishedAt) > 1 ? `-${document.id}` : "";
  return `nwrsmp-workbook-${publishedAt}${suffix}.xlsx`;
}

mkdirSync(rawDir, { recursive: true });
mkdirSync(manifestDir, { recursive: true });

const nwrsmpMedia = curlJson(mediaUrl);
const nwrsmpPage = curlJson(pageUrl);

if (nwrsmpMedia) {
  writeFileSync(path.join(rawDir, "nwrsmp-media.json"), `${JSON.stringify(nwrsmpMedia, null, 2)}\n`);
}
if (nwrsmpPage) {
  writeFileSync(path.join(rawDir, "nwrsmp-data-page.json"), `${JSON.stringify(nwrsmpPage, null, 2)}\n`);
}

const workbookDocuments = dedupeBy(
  (nwrsmpMedia || [])
    .filter(
      (item) =>
        item?.mime_type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" &&
        /north west public accessible/i.test(cleanText(item?.title?.rendered))
    )
    .map((item) => ({
      id: item.id,
      title: cleanText(item.title?.rendered),
      publishedAt: String(item.date_gmt || item.date || "").slice(0, 10),
      sourceUrl: item.source_url,
      fileSizeBytes: item.media_details?.filesize ?? null
    }))
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt) || left.title.localeCompare(right.title)),
  (row) => `${row.title}|${row.fileSizeBytes ?? "na"}`
);

const dateCounts = new Map();
for (const document of workbookDocuments) {
  const key = document.publishedAt || "undated";
  dateCounts.set(key, (dateCounts.get(key) ?? 0) + 1);
}

const expectedWorkbookFiles = new Set(
  workbookDocuments.map((document) => buildWorkbookFileName(document, dateCounts))
);

for (const existingFile of readdirSync(rawDir)) {
  if (existingFile.startsWith("nwrsmp-workbook-") && existingFile.endsWith(".xlsx") && !expectedWorkbookFiles.has(existingFile)) {
    rmSync(path.join(rawDir, existingFile), { force: true });
  }
}

for (const document of workbookDocuments) {
  const fileName = buildWorkbookFileName(document, dateCounts);
  downloadFile(document.sourceUrl, path.join(rawDir, fileName));
}

for (const page of pageDownloads) {
  downloadFile(page.sourceUrl, path.join(rawDir, page.fileName));
}

const manifest = {
  generatedAt: new Date().toISOString(),
  datasetId: "regional_sources",
  mediaUrl,
  pageUrl,
  workbookCount: workbookDocuments.length,
  files: [
    {
      fileName: "nwrsmp-media.json",
      sourceUrl: mediaUrl,
      sizeBytes: statSync(path.join(rawDir, "nwrsmp-media.json")).size,
      fileSha256: fileSha256(path.join(rawDir, "nwrsmp-media.json"))
    },
    {
      fileName: "nwrsmp-data-page.json",
      sourceUrl: pageUrl,
      sizeBytes: statSync(path.join(rawDir, "nwrsmp-data-page.json")).size,
      fileSha256: fileSha256(path.join(rawDir, "nwrsmp-data-page.json"))
    },
    ...pageDownloads.map((page) => ({
      fileName: page.fileName,
      sourceUrl: page.sourceUrl,
      sizeBytes: statSync(path.join(rawDir, page.fileName)).size,
      fileSha256: fileSha256(path.join(rawDir, page.fileName))
    })),
    ...workbookDocuments.map((document) => {
      const fileName = buildWorkbookFileName(document, dateCounts);
      const filePath = path.join(rawDir, fileName);
      return {
        fileName,
        publishedAt: document.publishedAt,
        title: document.title,
        sourceUrl: document.sourceUrl,
        fileSizeBytes: document.fileSizeBytes,
        sizeBytes: statSync(filePath).size,
        fileSha256: fileSha256(filePath)
      };
    })
  ]
};

writeFileSync(path.join(manifestDir, "regional_sources.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `Fetched ${workbookDocuments.length} North West RSMP workbook snapshots plus ${pageDownloads.length} regional source pages.`
);
