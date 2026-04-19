const WEIGHT_BASES = new Set(["population", "electorate", "lsoa_best_fit", "manual"]);
const REVIEW_STATUSES = new Set(["unreviewed", "reviewed", "reviewed_with_warnings", "quarantined"]);

export function validateBoundaryMapping(mapping) {
  const errors = [];
  for (const field of [
    "mapping_id",
    "source_area_id",
    "source_area_code",
    "target_area_id",
    "target_area_code",
    "weight",
    "weight_basis",
    "source_snapshot_id",
    "source_url",
    "review_status"
  ]) {
    if (mapping[field] === undefined || mapping[field] === null || mapping[field] === "") {
      errors.push(`${field} is required`);
    }
  }
  if (typeof mapping.weight !== "number" || mapping.weight <= 0 || mapping.weight > 1) {
    errors.push("weight must be > 0 and <= 1");
  }
  if (mapping.weight_basis && !WEIGHT_BASES.has(mapping.weight_basis)) {
    errors.push("weight_basis is invalid");
  }
  if (mapping.source_url && !/^https?:\/\//.test(mapping.source_url)) {
    errors.push("source_url must be an absolute http(s) URL");
  }
  if (mapping.review_status && !REVIEW_STATUSES.has(mapping.review_status)) {
    errors.push("review_status is invalid");
  }
  return { ok: errors.length === 0, errors };
}

export function validateBoundaryMappings(mappings) {
  if (!Array.isArray(mappings)) {
    return { ok: false, results: [], errors: ["boundary mappings manifest must be an array"] };
  }

  const mappingIds = new Set();
  const targetWeight = new Map();
  const results = mappings.map((mapping, index) => {
    const result = validateBoundaryMapping(mapping);
    if (mappingIds.has(mapping.mapping_id)) {
      result.ok = false;
      result.errors.push("mapping_id must be unique");
    }
    if (mapping.mapping_id) mappingIds.add(mapping.mapping_id);
    const key = mapping.target_area_id;
    if (key && typeof mapping.weight === "number") {
      targetWeight.set(key, (targetWeight.get(key) || 0) + mapping.weight);
    }
    return { index, mapping_id: mapping.mapping_id, ...result };
  });

  for (const [targetAreaId, total] of targetWeight.entries()) {
    if (total < 0.98 || total > 1.02) {
      results.push({
        index: -1,
        mapping_id: `target:${targetAreaId}`,
        ok: false,
        errors: [`weights for target_area_id ${targetAreaId} must sum to approximately 1`]
      });
    }
  }

  const failures = results.filter((result) => !result.ok);
  return { ok: failures.length === 0, results, errors: failures.flatMap((failure) => failure.errors) };
}
