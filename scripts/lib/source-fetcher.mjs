import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "./csv-parser.mjs";

export function inferRowCount(content, contentType = "", filePath = "") {
  const lowerType = contentType.toLowerCase();
  const lowerPath = filePath.toLowerCase();
  const text = typeof content === "string"
    ? content
    : content instanceof Uint8Array
      ? Buffer.from(content).toString("utf8")
      : "";

  if (lowerType.includes("json") || lowerPath.endsWith(".json")) {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.length;
    if (Array.isArray(parsed?.features)) return parsed.features.length;
    if (Array.isArray(parsed?.areas)) return parsed.areas.length;
    if (parsed?.areas && typeof parsed.areas === "object") return Object.keys(parsed.areas).length;
    if (parsed?.constituencies && typeof parsed.constituencies === "object") return Object.keys(parsed.constituencies).length;
    if (parsed && typeof parsed === "object") return Object.keys(parsed).length;
    return 1;
  }

  if (lowerType.includes("csv") || lowerPath.endsWith(".csv")) {
    if (text.length > 5_000_000) {
      const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
      return Math.max(0, lines.length - 1);
    }
    return parseCsv(text).length;
  }

  if (lowerType.includes("pdf") || lowerPath.endsWith(".pdf")) return content?.byteLength ? 1 : 0;
  if (typeof content !== "string") return content?.byteLength ? 1 : 0;
  return text.trim().length ? 1 : 0;
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

export async function fetchSourceSnapshot({ sourceName, sourceUrl, licence, outputPath, retrievedAt, signal }) {
  const response = await fetch(sourceUrl, {
    signal,
    headers: {
      "user-agent": "UK Elections source snapshot fetcher"
    }
  });
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const binary = Buffer.from(await response.arrayBuffer());
  const isText = /text|json|csv|xml|html|javascript|x-www-form-urlencoded/i.test(contentType);
  const content = isText ? binary.toString("utf8") : binary;
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content);

  return buildSourceSnapshot({
    sourceName,
    sourceUrl,
    licence,
    rawFilePath: outputPath,
    content,
    contentType,
    retrievedAt
  });
}
