import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * RFC 4180 CSV parser — handles quoted fields, escaped quotes, and multi-line values.
 * Returns an array of objects keyed by header names.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === "\"") {
        if (text[index + 1] === "\"") {
          field += "\"";
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === "\"") {
      inQuotes = true;
      continue;
    }

    if (character === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (character === "\r") {
      continue;
    }

    field += character;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [headerRow = [], ...dataRows] = rows;
  const headers = headerRow.map((header) => header.trim());

  return dataRows
    .filter((dataRow) => dataRow.some((value) => String(value).trim().length > 0))
    .map((dataRow) =>
      Object.fromEntries(headers.map((header, index) => [header, dataRow[index] ?? ""]))
    );
}

/**
 * Read a CSV file from disk and return parsed rows.
 */
export function readCsv(filePath) {
  return parseCsv(readFileSync(filePath, "utf8"));
}

/**
 * Compute SHA-256 hex digest of a file.
 */
export function fileSha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/**
 * Generate a short hash ID from an array of parts.
 */
export function hashId(parts) {
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}
