import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "./csv-parser.mjs";

export function inferRowCount(content, contentType = "", filePath = "") {
  const lowerType = contentType.toLowerCase();
  const lowerPath = filePath.toLowerCase();

  if (lowerType.includes("json") || lowerPath.endsWith(".json")) {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed.length;
    if (Array.isArray(parsed?.features)) return parsed.features.length;
    if (Array.isArray(parsed?.areas)) return parsed.areas.length;
    if (parsed?.areas && typeof parsed.areas === "object") return Object.keys(parsed.areas).length;
    if (parsed?.constituencies && typeof parsed.constituencies === "object") return Object.keys(parsed.constituencies).length;
    if (parsed && typeof parsed === "object") return Object.keys(parsed).length;
    return 1;
  }

  if (lowerType.includes("csv") || lowerPath.endsWith(".csv")) {
    return parseCsv(content).length;
  }

  return content.trim().length ? 1 : 0;
}

export function buildSourceSnapshot({ sourceName, sourceUrl, licence, rawFilePath, content, contentType = "", retrievedAt }) {
  const sha256 = createHash("sha256").update(content).digest("hex");
  return {
    snapshot_id: `${sourceName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${sha256.slice(0, 12)}`,
    source_name: sourceName,
    source_url: sourceUrl,
    retrieved_at: retrievedAt || new Date().toISOString(),
    licence,
    raw_file_path: rawFilePath,
    sha256,
    row_count: inferRowCount(content, contentType, rawFilePath),
    quality_status: "quarantined",
    review_notes: "Fetched automatically. Review licence, row semantics, and transformation notes before accepting."
  };
}

export async function fetchSourceSnapshot({ sourceName, sourceUrl, licence, outputPath, retrievedAt }) {
  const response = await fetch(sourceUrl, {
    headers: {
      "user-agent": "UK Elections source snapshot fetcher"
    }
  });
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }

  const content = await response.text();
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content, "utf8");

  return buildSourceSnapshot({
    sourceName,
    sourceUrl,
    licence,
    rawFilePath: outputPath,
    content,
    contentType: response.headers.get("content-type") || "",
    retrievedAt
  });
}
