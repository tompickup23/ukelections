import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const ENTITY_MAP = {
  amp: "&",
  nbsp: " ",
  quot: '"',
  apos: "'",
  "#039": "'",
  "#8217": "'",
  "#8216": "'",
  "#8218": "'",
  "#8220": '"',
  "#8221": '"',
  "#38": "&",
  "#47": "/",
  "#58": ":",
  "#160": " "
};

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function decodeHtmlEntities(value = "") {
  return String(value).replace(/&([a-zA-Z0-9#]+);/g, (match, entity) => {
    const key = entity.toLowerCase();
    if (ENTITY_MAP[key] !== undefined) return ENTITY_MAP[key];
    if (key.startsWith("#x")) {
      const codePoint = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    if (key.startsWith("#")) {
      const codePoint = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return match;
  });
}

export function stripHtml(value = "") {
  return decodeHtmlEntities(String(value))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normaliseForEvidenceSearch(value = "") {
  return decodeHtmlEntities(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bward\b/g, " ward ")
    .replace(/\bdivision\b/g, " division ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function areaNameVariants(areaName = "") {
  const base = String(areaName).trim();
  const variants = new Set([base]);
  variants.add(base.replace(/\bWard$/i, "").trim());
  variants.add(base.replace(/\bDivision$/i, "").trim());
  variants.add(base.replace(/&/g, "and"));
  variants.add(base.replace(/\band\b/gi, "&"));
  variants.add(base.replace(/-/g, " "));
  variants.add(base.replace(/,/g, " "));
  return [...variants]
    .map((variant) => normaliseForEvidenceSearch(variant))
    .filter((variant) => variant.length >= 4);
}

export function isPdfBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.subarray(0, 4).toString("utf8") === "%PDF";
}

export function extractTextFromRawFile(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return {
      ok: false,
      text: "",
      method: "missing_file",
      error: filePath ? `Raw source file not found: ${filePath}` : "Raw source file path missing"
    };
  }

  const buffer = readFileSync(filePath);
  const lowerPath = filePath.toLowerCase();
  if (isPdfBuffer(buffer) || lowerPath.endsWith(".pdf")) {
    const result = spawnSync("pdftotext", [filePath, "-"], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024
    });
    if (result.status === 0 && result.stdout.trim()) {
      return {
        ok: true,
        text: result.stdout,
        method: "pdftotext"
      };
    }
    return {
      ok: false,
      text: buffer.toString("utf8"),
      method: "pdf_binary_fallback",
      error: result.error?.message || result.stderr?.trim() || "pdftotext did not return searchable text"
    };
  }

  const raw = buffer.toString("utf8");
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(raw);
  return {
    ok: true,
    text: looksLikeHtml ? stripHtml(raw) : raw,
    method: looksLikeHtml ? "html_text" : "plain_text"
  };
}

export function sourceRecordFromSnapshot(snapshot) {
  const extraction = extractTextFromRawFile(snapshot.raw_file_path);
  return {
    target_id: snapshot.target_id,
    snapshot_id: snapshot.snapshot_id || null,
    source_name: snapshot.source_name || null,
    source_url: snapshot.source_url || null,
    raw_file_path: snapshot.raw_file_path || null,
    source_classes: snapshot.source_classes || [],
    extraction_method: extraction.method,
    extraction_error: extraction.error || null,
    searchable_text: normaliseForEvidenceSearch(extraction.text),
    text_length: extraction.text.length
  };
}

function buildSourceRecords(execution = {}, extraSourceRecords = []) {
  return [
    ...(execution.source_snapshots || []).map(sourceRecordFromSnapshot),
    ...extraSourceRecords
  ];
}

function findAreaMatches(area, sourceRecords) {
  const variants = areaNameVariants(area.area_name);
  const matches = [];
  for (const source of sourceRecords) {
    const matchedVariant = variants.find((variant) => {
      const expression = new RegExp(`(?:^| )${escapeRegExp(variant)}(?: |$)`);
      return expression.test(source.searchable_text || "");
    });
    if (matchedVariant) {
      matches.push({
        target_id: source.target_id,
        snapshot_id: source.snapshot_id || null,
        source_name: source.source_name || null,
        source_url: source.source_url || null,
        raw_file_path: source.raw_file_path || null,
        matched_variant: matchedVariant,
        extraction_method: source.extraction_method || null,
        linked_source: Boolean(source.linked_source)
      });
    }
  }
  return matches;
}

function boundaryEvidenceMatches(area, sourceRecords) {
  const councilNames = area.source_context?.council_names || [];
  const boundarySources = sourceRecords.filter((source) =>
    (source.source_classes || []).some((sourceClass) =>
      ["lgbce_final_recommendations", "electoral_change_orders", "boundary_lineage", "ons_boundary_codes", "area_name_code_register"].includes(sourceClass)
    )
  );
  return boundarySources
    .filter((source) => councilNames.some((councilName) =>
      new RegExp(`(?:^| )${escapeRegExp(normaliseForEvidenceSearch(councilName))}(?: |$)`).test(source.searchable_text || "")
    ))
    .map((source) => ({
      target_id: source.target_id,
      snapshot_id: source.snapshot_id || null,
      source_name: source.source_name || null,
      source_url: source.source_url || null
    }));
}

export function buildReviewEvidenceVerification({
  workflows = {},
  execution = {},
  extraSourceRecords = [],
  generatedAt = new Date().toISOString()
} = {}) {
  const sourceRecords = buildSourceRecords(execution, extraSourceRecords);
  const recordsByTarget = new Map();
  for (const record of sourceRecords) {
    if (!recordsByTarget.has(record.target_id)) recordsByTarget.set(record.target_id, []);
    recordsByTarget.get(record.target_id).push(record);
  }

  const areas = (workflows.areas || execution.areas || []).map((area) => {
    const targetRecords = (area.source_targets || [])
      .flatMap((targetId) => recordsByTarget.get(targetId) || []);
    const areaMatches = findAreaMatches(area, targetRecords);
    const boundaryMatches = boundaryEvidenceMatches(area, targetRecords);
    const targetIdsWithExtractedText = new Set(targetRecords.filter((record) => record.text_length > 0).map((record) => record.target_id));
    const expectedTargetIds = area.source_targets || [];
    const missingTextTargetIds = expectedTargetIds.filter((targetId) => !targetIdsWithExtractedText.has(targetId));
    const sourceEvidenceStatus = areaMatches.length > 0
      ? "area_name_confirmed"
      : targetRecords.length > 0
        ? "source_fetched_no_area_match"
        : "no_searchable_source";
    const boundaryEvidenceStatus = area.workflow_code === "build_boundary_notional_history" || area.workflow_code === "extend_temporal_validation"
      ? boundaryMatches.length > 0 ? "boundary_source_context_confirmed" : "boundary_source_context_not_confirmed"
      : "not_required_for_workflow";

    const blockers = [
      sourceEvidenceStatus === "area_name_confirmed"
        ? "Area name is evidenced in fetched official/linked sources, but result rows have not yet been transformed into reviewed model inputs."
        : "Fetched source set does not yet contain a searchable area-name match; add or crawl a more specific official declaration source.",
      boundaryEvidenceStatus === "boundary_source_context_not_confirmed"
        ? "Boundary/code source context for the council was not confirmed in searchable LGBCE/ONS evidence."
        : null,
      area.promotion_gate
    ].filter(Boolean);

    return {
      area_code: area.area_code,
      area_name: area.area_name,
      council_names: area.source_context?.council_names || [],
      model_family: area.model_family,
      priority: area.priority,
      workflow_code: area.workflow_code,
      action_code: area.action_code,
      source_evidence_status: sourceEvidenceStatus,
      boundary_evidence_status: boundaryEvidenceStatus,
      matched_sources: areaMatches,
      boundary_context_sources: boundaryMatches,
      missing_text_target_ids: missingTextTargetIds,
      promotion_status: "not_ready",
      promotion_blockers: blockers
    };
  });

  const bySourceEvidenceStatus = areas.reduce((counts, area) => {
    counts[area.source_evidence_status] = (counts[area.source_evidence_status] || 0) + 1;
    return counts;
  }, {});
  const byBoundaryEvidenceStatus = areas.reduce((counts, area) => {
    counts[area.boundary_evidence_status] = (counts[area.boundary_evidence_status] || 0) + 1;
    return counts;
  }, {});
  const linkedSourceRecords = sourceRecords.filter((source) => source.linked_source);

  return {
    generated_at: generatedAt,
    total_areas: areas.length,
    total_source_records: sourceRecords.length,
    linked_source_records: linkedSourceRecords.length,
    area_name_confirmed: bySourceEvidenceStatus.area_name_confirmed || 0,
    areas_still_needing_specific_source: (bySourceEvidenceStatus.source_fetched_no_area_match || 0) + (bySourceEvidenceStatus.no_searchable_source || 0),
    by_source_evidence_status: bySourceEvidenceStatus,
    by_boundary_evidence_status: byBoundaryEvidenceStatus,
    linked_sources: linkedSourceRecords.map((source) => ({
      target_id: source.target_id,
      source_name: source.source_name,
      source_url: source.source_url,
      raw_file_path: source.raw_file_path,
      extraction_method: source.extraction_method,
      text_length: source.text_length
    })),
    source_extraction: sourceRecords.map((source) => ({
      target_id: source.target_id,
      snapshot_id: source.snapshot_id || null,
      source_name: source.source_name || null,
      source_url: source.source_url || null,
      raw_file_path: source.raw_file_path || null,
      extraction_method: source.extraction_method || null,
      extraction_error: source.extraction_error || null,
      text_length: source.text_length || 0,
      linked_source: Boolean(source.linked_source)
    })),
    areas
  };
}
