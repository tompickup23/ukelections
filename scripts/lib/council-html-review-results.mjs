import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const MONTHS = new Map([
  ["january", "01"],
  ["february", "02"],
  ["march", "03"],
  ["april", "04"],
  ["may", "05"],
  ["june", "06"],
  ["july", "07"],
  ["august", "08"],
  ["september", "09"],
  ["october", "10"],
  ["november", "11"],
  ["december", "12"]
]);

function decodeHtmlEntities(text = "") {
  return String(text)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;/gi, "'");
}

function stripHtml(html = "") {
  return decodeHtmlEntities(String(html).replace(/<[^>]*>/g, " "));
}

function normaliseText(text = "") {
  return stripHtml(text).replace(/\s+/g, " ").trim();
}

function canonicalArea(text = "") {
  return normaliseText(text)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\s+ward\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function integerFromText(text = "") {
  const match = String(text).match(/\d[\d,]*/);
  return match ? Number(match[0].replace(/,/g, "")) : undefined;
}

function turnoutFromHtml(html = "") {
  const match = normaliseText(html).match(/\bTurnout:\s*([\d.]+)%/i);
  return match ? Number((Number(match[1]) / 100).toFixed(4)) : undefined;
}

function electionDateFromHtml(html = "") {
  const sentence = normaliseText(html).match(/\bheld on\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/i);
  if (!sentence) return undefined;
  const month = MONTHS.get(sentence[2].toLowerCase());
  return month ? `${sentence[3]}-${month}-${String(Number(sentence[1])).padStart(2, "0")}` : undefined;
}

function extractCells(rowHtml = "") {
  return [...String(rowHtml).matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)]
    .map((match) => ({
      html: match[1],
      text: normaliseText(match[1])
    }));
}

function tableRows(tableHtml = "") {
  return [...String(tableHtml).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((match) => extractCells(match[1]))
    .filter((cells) => cells.length > 0);
}

function extractResultTable(html = "") {
  return [...String(html).matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)]
    .map((match) => match[0])
    .find((table) => {
      const header = tableRows(table)[0]?.map((cell) => cell.text.toLowerCase()).join(" ") || "";
      return header.includes("name") && header.includes("party") && header.includes("votes cast");
    }) || null;
}

function parseRibbleValleyAreaName(html = "") {
  const sentence = normaliseText(html).match(/\bfor\s+(.+?)\s+of\s+Ribble Valley Borough Council\b/i);
  return sentence?.[1]?.replace(/^the\s+/i, "").replace(/\s+Ward$/i, "") || undefined;
}

function parseCandidateRows(tableHtml = "") {
  return tableRows(tableHtml)
    .filter((cells) => cells.length >= 4)
    .filter((cells) => !cells.map((cell) => cell.text.toLowerCase()).join(" ").includes("votes cast"))
    .map((cells) => ({
      candidate_or_party_name: cells[0].text,
      party_name: cells[1].text,
      votes: integerFromText(cells[2].text),
      elected: /\belected\b/i.test(cells[3].text)
    }))
    .filter((row) => row.candidate_or_party_name && row.party_name && Number.isInteger(row.votes));
}

function sourceUrlFromHtml(html = "", fallbackUrl = "") {
  return decodeHtmlEntities(
    String(html).match(/<meta\s+property=["']og:url["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
    String(html).match(/<meta\s+property=["']dcterms:identifier["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
    fallbackUrl
  );
}

function linkedSourceForArea(linkedSources = [], areaName = "") {
  const wanted = canonicalArea(areaName);
  return linkedSources.find((source) => canonicalArea(parseRibbleValleyAreaName(source.html)) === wanted) || null;
}

export function readCouncilLinkedSources(linkedRawDir, targetIdPrefix) {
  if (!linkedRawDir) return [];
  return readdirSync(linkedRawDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => !targetIdPrefix || entry.name.startsWith(targetIdPrefix))
    .map((entry) => {
      const filePath = path.join(linkedRawDir, entry.name);
      return {
        file_path: filePath,
        html: readFileSync(filePath, "utf8")
      };
    });
}

export function parseRibbleValleyReviewResult({
  html,
  areaName,
  areaCode,
  fallbackSourceUrl,
  sourceSnapshotId,
  linkedRawFilePath
} = {}) {
  const pageAreaName = parseRibbleValleyAreaName(html);
  if (canonicalArea(pageAreaName) !== canonicalArea(areaName)) {
    return {
      ok: false,
      error: "linked_result_page_area_mismatch",
      area_code: areaCode,
      area_name: areaName,
      linked_area_name: pageAreaName
    };
  }
  const table = extractResultTable(html);
  if (!table) return { ok: false, error: "result_table_not_found", area_code: areaCode, area_name: areaName };
  const resultRows = parseCandidateRows(table);
  if (!resultRows.length) return { ok: false, error: "candidate_rows_not_found", area_code: areaCode, area_name: areaName };
  const turnoutVotes = resultRows.reduce((sum, row) => sum + row.votes, 0);
  return {
    ok: true,
    record: {
      area_code: areaCode,
      area_name: areaName,
      election_date: electionDateFromHtml(html),
      election_type: "borough",
      voting_system: "fptp",
      source_url: sourceUrlFromHtml(html, fallbackSourceUrl),
      source_snapshot_id: sourceSnapshotId,
      seats_contested: resultRows.filter((row) => row.elected).length || 1,
      turnout_votes: turnoutVotes,
      turnout: turnoutFromHtml(html),
      result_rows: resultRows,
      draft_review: {
        status: "draft_transcribed_requires_manual_review",
        extraction_route: "ribble_valley_linked_html_transcription",
        linked_raw_file_path: linkedRawFilePath,
        declared_total_votes: undefined,
        declared_total_matches_candidate_votes: undefined
      }
    }
  };
}

export function buildCouncilHtmlReviewDraft({
  manifest = {},
  linkedSources = [],
  generatedAt = new Date().toISOString()
} = {}) {
  const areas = (manifest.areas || [])
    .filter((area) => area.import_status === "ready_for_row_transformation")
    .filter((area) => area.primary_import_route === "council_html_transcription")
    .filter((area) => (area.council_names || []).includes("Ribble Valley"));

  const parsed = areas.map((area) => {
    const linkedSource = linkedSourceForArea(linkedSources, area.area_name);
    if (!linkedSource) {
      return {
        ok: false,
        error: "linked_result_page_not_found",
        area_code: area.area_code,
        area_name: area.area_name,
        source_target_id: area.primary_source?.target_id || null
      };
    }
    return parseRibbleValleyReviewResult({
      html: linkedSource.html,
      areaName: area.area_name,
      areaCode: area.area_code,
      fallbackSourceUrl: area.primary_source?.source_url,
      sourceSnapshotId: area.primary_source?.snapshot_id,
      linkedRawFilePath: linkedSource.file_path
    });
  });

  return {
    generated_at: generatedAt,
    source_name: "Draft council HTML review result transcription",
    licence: "Official public election results; confirm reuse terms before republication",
    draft_import_gate: "manual_review_required_before_model_import",
    supported_councils: ["Ribble Valley"],
    total_areas: areas.length,
    drafted_records: parsed.filter((result) => result.ok).length,
    failed_records: parsed.filter((result) => !result.ok).length,
    failures: parsed.filter((result) => !result.ok),
    records: parsed.filter((result) => result.ok).map((result) => result.record)
  };
}
