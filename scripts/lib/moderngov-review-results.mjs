import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

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
    .replace(/\s+ward$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractTagBlocks(html = "", tagName) {
  return [...String(html).matchAll(new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, "gi"))]
    .map((match) => match[0]);
}

function extractCells(rowHtml = "") {
  return [...String(rowHtml).matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)]
    .map((match) => ({
      html: match[1],
      text: normaliseText(match[1])
    }));
}

function tableCaption(tableHtml = "") {
  return normaliseText(tableHtml.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i)?.[1] || "");
}

function tableRows(tableHtml = "") {
  return [...String(tableHtml).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((match) => extractCells(match[1]))
    .filter((cells) => cells.length > 0);
}

function integerFromText(text = "") {
  const match = String(text).match(/\d[\d,]*/);
  return match ? Number(match[0].replace(/,/g, "")) : undefined;
}

function turnoutFromText(text = "") {
  const match = String(text).match(/[\d.]+/);
  return match ? Number((Number(match[0]) / 100).toFixed(4)) : undefined;
}

function electionDateFromHtml(html = "") {
  return decodeHtmlEntities(String(html).match(/<meta\s+name=["']DC\.date["'][^>]*content=["']([^"']+)["']/i)?.[1] || "").trim() || undefined;
}

function findResultTable(html = "", areaName = "") {
  const wanted = canonicalArea(areaName);
  return extractTagBlocks(html, "table").find((table) => {
    const caption = canonicalArea(tableCaption(table).replace(/\s+-\s+results$/i, ""));
    const headers = tableRows(table)[0]?.map((cell) => cell.text.toLowerCase()).join(" ") || "";
    return caption === wanted && headers.includes("election candidate") && headers.includes("votes");
  }) || null;
}

function findVotingSummaryTable(html = "") {
  return extractTagBlocks(html, "table").find((table) =>
    canonicalArea(tableCaption(table)) === "voting summary"
  ) || null;
}

function parseCandidateRows(tableHtml = "") {
  return tableRows(tableHtml)
    .filter((cells) => cells.length >= 5)
    .filter((cells) => !cells.map((cell) => cell.text.toLowerCase()).join(" ").includes("election candidate"))
    .map((cells) => ({
      candidate_or_party_name: cells[0].text,
      party_name: cells[1].text,
      votes: integerFromText(cells[2].text),
      elected: /^elected$/i.test(cells[4].text)
    }))
    .filter((row) => row.candidate_or_party_name && row.party_name && Number.isInteger(row.votes));
}

function parseVotingSummary(tableHtml = "") {
  const summary = {};
  for (const cells of tableRows(tableHtml).filter((row) => row.length >= 2)) {
    const label = cells[0].text.toLowerCase();
    if (label === "seats") summary.seats_contested = integerFromText(cells[1].text);
    else if (label === "total votes") summary.total_votes = integerFromText(cells[1].text);
    else if (label === "electorate") summary.electorate = integerFromText(cells[1].text);
    else if (label === "number of ballot papers issued") summary.ballot_papers_issued = integerFromText(cells[1].text);
    else if (label === "number of ballot papers rejected") summary.rejected_ballots = integerFromText(cells[1].text);
    else if (label === "turnout") summary.turnout = turnoutFromText(cells[1].text);
  }
  return summary;
}

function areaLinksFromIndex(indexHtml = "", baseUrl = "") {
  const links = new Map();
  for (const match of String(indexHtml).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*title=["']Link to election area results for ([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeHtmlEntities(match[1]);
    const titleArea = normaliseText(match[2]);
    const textArea = normaliseText(match[3]);
    const areaName = titleArea || textArea;
    let sourceUrl = href;
    try {
      sourceUrl = new URL(href, baseUrl).toString();
    } catch {
      sourceUrl = href;
    }
    links.set(canonicalArea(areaName), sourceUrl);
  }
  return links;
}

function linkedSourceForArea(linkedSources = [], areaName = "") {
  const wanted = canonicalArea(areaName);
  return linkedSources.find((source) => {
    const h1 = normaliseText(String(source.html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
    const title = normaliseText(String(source.html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
    return canonicalArea(h1.replace(/^election results for\s+/i, "")) === wanted ||
      canonicalArea(title.replace(/^election results for\s+/i, "").replace(/,\s*\d{1,2}\s+\w+\s+\d{4}.*$/i, "")) === wanted;
  }) || null;
}

export function readLinkedSources(linkedRawDir) {
  if (!linkedRawDir) return [];
  return readdirSync(linkedRawDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filePath = path.join(linkedRawDir, entry.name);
      return {
        file_path: filePath,
        html: readFileSync(filePath, "utf8")
      };
    });
}

export function parseModernGovReviewResult({
  html,
  areaName,
  areaCode,
  sourceUrl,
  sourceSnapshotId,
  linkedRawFilePath
} = {}) {
  const resultTable = findResultTable(html, areaName);
  if (!resultTable) {
    return { ok: false, error: "result_table_not_found", area_code: areaCode, area_name: areaName };
  }
  const resultRows = parseCandidateRows(resultTable);
  if (!resultRows.length) {
    return { ok: false, error: "candidate_rows_not_found", area_code: areaCode, area_name: areaName };
  }
  const summary = parseVotingSummary(findVotingSummaryTable(html) || "");
  const turnoutVotes = resultRows.reduce((sum, row) => sum + row.votes, 0);
  return {
    ok: true,
    record: {
      area_code: areaCode,
      area_name: areaName,
      election_date: electionDateFromHtml(html),
      election_type: "borough",
      voting_system: "fptp",
      source_url: sourceUrl,
      source_snapshot_id: sourceSnapshotId,
      electorate: summary.electorate,
      turnout_votes: turnoutVotes,
      turnout: summary.turnout,
      seats_contested: summary.seats_contested,
      result_rows: resultRows,
      draft_review: {
        status: "draft_transcribed_requires_manual_review",
        extraction_route: "modern_gov_html_transcription",
        linked_raw_file_path: linkedRawFilePath,
        declared_total_votes: summary.total_votes,
        ballot_papers_issued: summary.ballot_papers_issued,
        rejected_ballots: summary.rejected_ballots,
        declared_total_matches_candidate_votes: Number.isInteger(summary.total_votes)
          ? summary.total_votes === turnoutVotes
          : undefined
      }
    }
  };
}

export function buildModernGovReviewDraft({
  manifest = {},
  sourceReader,
  linkedSources = [],
  generatedAt = new Date().toISOString()
} = {}) {
  if (typeof sourceReader !== "function") {
    throw new Error("sourceReader is required");
  }
  const areas = (manifest.areas || [])
    .filter((area) => area.import_status === "ready_for_row_transformation")
    .filter((area) => area.primary_import_route === "modern_gov_html_transcription")
    .filter((area) => area.primary_source?.raw_file_path);

  const parsed = areas.map((area) => {
    const indexHtml = sourceReader(area.primary_source.raw_file_path);
    const sourceUrlByArea = areaLinksFromIndex(indexHtml, area.primary_source.source_url);
    const linkedSource = linkedSourceForArea(linkedSources, area.area_name);
    if (!linkedSource) {
      return {
        ok: false,
        error: "linked_result_page_not_found",
        area_code: area.area_code,
        area_name: area.area_name,
        source_url: sourceUrlByArea.get(canonicalArea(area.area_name)) || area.primary_source.source_url
      };
    }
    return parseModernGovReviewResult({
      html: linkedSource.html,
      areaName: area.area_name,
      areaCode: area.area_code,
      sourceUrl: sourceUrlByArea.get(canonicalArea(area.area_name)) || area.primary_source.source_url,
      sourceSnapshotId: area.primary_source.snapshot_id,
      linkedRawFilePath: linkedSource.file_path
    });
  });

  return {
    generated_at: generatedAt,
    source_name: "Draft ModernGov review result transcription",
    licence: "Official public election results; confirm reuse terms before republication",
    draft_import_gate: "manual_review_required_before_model_import",
    total_areas: areas.length,
    drafted_records: parsed.filter((result) => result.ok).length,
    failed_records: parsed.filter((result) => !result.ok).length,
    failures: parsed.filter((result) => !result.ok),
    records: parsed.filter((result) => result.ok).map((result) => result.record)
  };
}
