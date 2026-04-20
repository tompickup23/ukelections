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

function canonicalHeading(text = "") {
  return normaliseText(text).toLowerCase().replace(/\s+ward$/, "");
}

function extractTagBlocks(html = "", tagName) {
  return [...String(html).matchAll(new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, "gi"))]
    .map((match) => ({ html: match[0], index: match.index }));
}

function extractHeadingSection(html = "", areaName = "") {
  const headings = extractTagBlocks(html, "h2");
  const wanted = canonicalHeading(areaName);
  const headingIndex = headings.findIndex((heading) => canonicalHeading(heading.html) === wanted);
  if (headingIndex === -1) return null;
  const start = headings[headingIndex].index + headings[headingIndex].html.length;
  const end = headings[headingIndex + 1]?.index ?? html.length;
  return String(html).slice(start, end);
}

function extractFirstTable(html = "") {
  return String(html).match(/<table\b[^>]*>[\s\S]*?<\/table>/i)?.[0] || null;
}

function extractTableRows(tableHtml = "") {
  return [...String(tableHtml).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((rowMatch) => [...rowMatch[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)]
      .map((cellMatch) => ({
        html: cellMatch[1],
        text: normaliseText(cellMatch[1])
      })))
    .filter((cells) => cells.length > 0);
}

function parseVotesCell(cell = {}) {
  const text = cell.text || "";
  const votes = Number(text.match(/\d[\d,]*/)?.[0]?.replace(/,/g, ""));
  return {
    votes: Number.isInteger(votes) ? votes : null,
    elected: /\belected\b/i.test(text) || /\belected\b/i.test(cell.html || "")
  };
}

function parseTurnout(sectionHtml = "") {
  const text = normaliseText(sectionHtml);
  const turnoutMatch = text.match(/\b(?:Voter\s+)?Turnout:\s*([\d.]+)%/i);
  return turnoutMatch ? Number((Number(turnoutMatch[1]) / 100).toFixed(4)) : undefined;
}

function parseSpoiltBallots(sectionHtml = "") {
  const text = normaliseText(sectionHtml);
  const match = text.match(/\b(?:Spoilt|Rejected ballot papers):\s*(\d[\d,]*)/i);
  return match ? Number(match[1].replace(/,/g, "")) : undefined;
}

function parseDeclaredTotalVotesCast(sectionHtml = "") {
  const text = normaliseText(sectionHtml);
  const match = text.match(/\bTotal votes cast:\s*(\d[\d,]*)/i);
  return match ? Number(match[1].replace(/,/g, "")) : undefined;
}

function isHeaderRow(cells = []) {
  const rowText = cells.map((cell) => cell.text.toLowerCase()).join(" ");
  return /\bcandidate\b/.test(rowText) && /\bvotes\b/.test(rowText);
}

function parseCandidateRows(tableHtml = "") {
  const rows = extractTableRows(tableHtml).filter((cells) => !isHeaderRow(cells));
  return rows
    .map((cells) => {
      const [candidateCell, partyCell, votesCell, electedCell] = cells;
      const votes = parseVotesCell(votesCell);
      return {
        candidate_or_party_name: candidateCell?.text || "",
        party_name: partyCell?.text || "",
        votes: votes.votes,
        elected: votes.elected || /\belected\b/i.test(electedCell?.text || "")
      };
    })
    .filter((row) => row.candidate_or_party_name && row.party_name && Number.isInteger(row.votes));
}

export function parseStructuredReviewResult({
  html,
  areaName,
  areaCode,
  electionDate,
  sourceUrl,
  sourceSnapshotId,
  seatsContested = 1
} = {}) {
  const section = extractHeadingSection(html, areaName);
  if (!section) {
    return {
      ok: false,
      error: "area_heading_not_found",
      area_code: areaCode,
      area_name: areaName
    };
  }

  const table = extractFirstTable(section);
  if (!table) {
    return {
      ok: false,
      error: "result_table_not_found",
      area_code: areaCode,
      area_name: areaName
    };
  }

  const resultRows = parseCandidateRows(table);
  if (!resultRows.length) {
    return {
      ok: false,
      error: "candidate_rows_not_found",
      area_code: areaCode,
      area_name: areaName
    };
  }

  const turnoutVotes = resultRows.reduce((sum, row) => sum + row.votes, 0);
  const declaredTotalVotesCast = parseDeclaredTotalVotesCast(section);
  const spoiltBallots = parseSpoiltBallots(section);
  const turnout = parseTurnout(section);
  const expectedDeclaredTotal = Number.isInteger(spoiltBallots) ? turnoutVotes + spoiltBallots : undefined;

  return {
    ok: true,
    record: {
      area_code: areaCode,
      area_name: areaName,
      election_date: electionDate,
      election_type: "borough",
      voting_system: "fptp",
      source_url: sourceUrl,
      source_snapshot_id: sourceSnapshotId,
      seats_contested: seatsContested,
      turnout_votes: turnoutVotes,
      turnout,
      result_rows: resultRows,
      draft_review: {
        status: "draft_transcribed_requires_manual_review",
        extraction_route: "structured_html_table_transcription",
        declared_total_votes_cast: declaredTotalVotesCast,
        spoilt_ballots: spoiltBallots,
        declared_total_matches_candidate_votes_plus_spoilt: Number.isInteger(declaredTotalVotesCast) && Number.isInteger(expectedDeclaredTotal)
          ? declaredTotalVotesCast === expectedDeclaredTotal
          : undefined
      }
    }
  };
}

export function buildStructuredReviewDraft({
  manifest = {},
  sourceReader,
  electionDate = "2024-05-02",
  generatedAt = new Date().toISOString()
} = {}) {
  if (typeof sourceReader !== "function") {
    throw new Error("sourceReader is required");
  }
  const structuredAreas = (manifest.areas || [])
    .filter((area) => area.import_status === "ready_for_row_transformation")
    .filter((area) => area.primary_import_route === "structured_html_table_transcription")
    .filter((area) => area.primary_source?.raw_file_path);

  const parsed = structuredAreas.map((area) => parseStructuredReviewResult({
    html: sourceReader(area.primary_source.raw_file_path),
    areaName: area.area_name,
    areaCode: area.area_code,
    electionDate,
    sourceUrl: area.primary_source.source_url,
    sourceSnapshotId: area.primary_source.snapshot_id,
    seatsContested: 1
  }));

  return {
    generated_at: generatedAt,
    source_name: "Draft structured HTML review result transcription",
    licence: "Official public election results; confirm reuse terms before republication",
    draft_import_gate: "manual_review_required_before_model_import",
    total_areas: structuredAreas.length,
    drafted_records: parsed.filter((result) => result.ok).length,
    failed_records: parsed.filter((result) => !result.ok).length,
    failures: parsed.filter((result) => !result.ok),
    records: parsed.filter((result) => result.ok).map((result) => result.record)
  };
}
