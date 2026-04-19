import { createHash } from "node:crypto";

function stableId(prefix, parts) {
  return `${prefix}-${createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 12)}`;
}

function hasCurrentGssCode(areaCode) {
  return /^[EWSN]\d{8}$/.test(String(areaCode || ""));
}

export function buildBoundaryLineageMappings(boundaries = []) {
  return boundaries
    .filter((boundary) => hasCurrentGssCode(boundary.area_code))
    .map((boundary) => ({
      mapping_id: stableId("lineage", [
        boundary.boundary_version_id,
        boundary.area_code,
        boundary.valid_from,
        boundary.valid_to || "current"
      ]),
      source_area_id: boundary.boundary_version_id,
      source_area_code: boundary.area_code,
      target_area_id: boundary.boundary_version_id,
      target_area_code: boundary.area_code,
      weight: 1,
      weight_basis: "manual",
      source_snapshot_id: boundary.source_snapshot_id,
      source_url: boundary.source_url,
      review_status: "reviewed",
      lineage_method: "same_gss_boundary_version_identity",
      notes: "Generated identity lineage for an imported current-format GSS area code. This does not infer any predecessor split or merge."
    }));
}
