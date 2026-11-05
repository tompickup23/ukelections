/** Catalogue metadata comes from published files, never the build clock. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PUBLISHED_DATA, contentTypeFor } from "./publishedData";
import { SITE_URL } from "./site";

export const OUTPUT_LICENCE = "https://creativecommons.org/licenses/by/4.0/";

export function recordedDataDate(data: any): string | null {
  const value = data.updated_at ?? data.snapshot?.generated_at ?? data.generated_at;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) && Number.isFinite(Date.parse(value))
    ? value : null;
}

export function loadDownloads() {
  return PUBLISHED_DATA.map(file => {
    // The CSV and Markdown are alternate exports of the neighbouring JSON.
    const metadataPath = file.path.replace(/\.(csv|md)$/, ".json");
    const metadata = JSON.parse(readFileSync(path.join(process.cwd(), "data", metadataPath), "utf8"));
    return {
      ...file,
      href: `/data/${file.path}`,
      date: recordedDataDate(metadata),
      dateBasis: metadataPath === file.path ? "Timestamp recorded in file" : "Timestamp of companion JSON export",
      format: contentTypeFor(file.path).split(";")[0],
      licence: OUTPUT_LICENCE,
    };
  });
}

export function downloadDistributions() {
  return loadDownloads().map(file => ({
    "@type": "DataDownload",
    name: file.label,
    contentUrl: `${SITE_URL}${file.href}`,
    encodingFormat: file.format,
    license: file.licence,
    ...(file.date ? { dateModified: file.date } : {}),
  }));
}
