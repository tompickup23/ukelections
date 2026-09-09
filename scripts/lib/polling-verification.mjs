import { createHash } from "node:crypto";

export const PRIMARY_VERIFICATION = "primary_verified";
export const PENDING_VERIFICATION = "pending_primary_verification";
export const NOT_COMPARABLE = "not_comparable";

function isoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function canonicalHost(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isPrimaryHost(url, pollsterSpec) {
  const host = canonicalHost(url);
  if (!host || !pollsterSpec?.primary_hosts) return false;
  return pollsterSpec.primary_hosts.some((candidate) => {
    const allowed = candidate.toLowerCase().replace(/^www\./, "");
    return host === allowed || host.endsWith(`.${allowed}`);
  });
}

function recordKey(record) {
  return JSON.stringify([
    record.pollster || null,
    record.fieldwork_start || null,
    record.fieldwork_end || null,
    record.source_url || null,
  ]);
}

function verificationIndex(verifications) {
  return new Map((verifications?.records || []).map((record) => [recordKey(record), record]));
}

function shareTotal(shares) {
  return Object.values(shares || {}).reduce((sum, value) => (
    typeof value === "number" && Number.isFinite(value) ? sum + value : sum
  ), 0);
}

function normalisedSharesMatch(left, right) {
  const leftKeys = Object.keys(left || {}).sort();
  const rightKeys = Object.keys(right || {}).sort();
  if (leftKeys.join("|") !== rightKeys.join("|")) return false;
  return leftKeys.every((key) => Math.abs(left[key] - right[key]) < 0.000001);
}

/**
 * Evaluate a current-window record against the published target-series policy.
 * An automatically fetched URL can only establish that first-party evidence is
 * linked. Moving to primary_verified requires a checked entry in
 * primary-verifications.json; it is deliberately never inferred by a crawler.
 */
export function evaluatePollingRecord(record, registry, verifications) {
  const target = registry.target_series;
  const pollsterSpec = registry.pollsters?.[record.pollster] || null;
  const evidence = verificationIndex(verifications).get(recordKey(record));
  const measureType = record.measure_type || pollsterSpec?.default_measure_type || null;
  const checks = {
    fieldwork_start: Boolean(isoDate(record.fieldwork_start)),
    fieldwork_end: Boolean(isoDate(record.fieldwork_end)),
    source_url: Boolean(record.source_url),
    primary_host: isPrimaryHost(record.source_url, pollsterSpec),
    shares: shareTotal(record.shares) >= 0.99 && shareTotal(record.shares) <= 1.01,
    geography: record.geography === target.geography,
    question_type: record.question_type === target.question_type,
    measure_type: (target.accepted_measure_types || []).includes(measureType),
  };

  if (pollsterSpec?.eligible_for_target_series === false) {
    return {
      ...record,
      status: NOT_COMPARABLE,
      included: false,
      reason: pollsterSpec.exclusion_reason || "Pollster measure is not comparable with the target series.",
      checks,
    };
  }

  const policyPasses = Object.values(checks).every(Boolean);
  const evidenceMatches = evidence
    && evidence.status === PRIMARY_VERIFICATION
    && evidence.primary_url === record.source_url
    && evidence.geography === record.geography
    && evidence.question_type === record.question_type
    && normalisedSharesMatch(evidence.shares, record.shares);

  if (policyPasses && evidenceMatches) {
    return {
      ...record,
      status: PRIMARY_VERIFICATION,
      included: true,
      evidence: {
        primary_url: evidence.primary_url,
        checked_at: evidence.checked_at,
        document_sha256: evidence.document_sha256,
        extract_locator: evidence.extract_locator,
      },
      checks,
    };
  }

  return {
    ...record,
    status: PENDING_VERIFICATION,
    included: false,
    reason: policyPasses
      ? "First-party evidence has not yet been independently checked against the recorded figures."
      : "Record does not yet meet the target-series comparability and provenance policy.",
    checks,
  };
}

export function buildVerificationLedger(currentPolls, registry, verifications, generatedAt = new Date().toISOString()) {
  const records = (currentPolls.records || []).map((record) => evaluatePollingRecord(record, registry, verifications));
  const counts = records.reduce((out, record) => {
    out[record.status] = (out[record.status] || 0) + 1;
    return out;
  }, {});
  const included = records.filter((record) => record.included);
  return {
    schema_version: 1,
    generated_at: generatedAt,
    target_series: registry.target_series,
    candidate_manifest_generated_at: currentPolls.generated_at || null,
    counts,
    publication_ready: included.length >= registry.target_series.minimum_verified_polls,
    records,
  };
}

export function assertPublicationReady(ledger) {
  const minimum = ledger.target_series?.minimum_verified_polls || 2;
  const included = ledger.records?.filter((record) => record.included) || [];
  if (included.length < minimum) {
    throw new Error(`Only ${included.length} primary-verified comparable polls are available; need at least ${minimum}. Retain the last verified snapshot.`);
  }
  if (ledger.records?.some((record) => record.included && record.status !== PRIMARY_VERIFICATION)) {
    throw new Error("A non-primary-verified record was marked as included.");
  }
}

export function evidenceFingerprint(value) {
  return createHash("sha256").update(value).digest("hex");
}
