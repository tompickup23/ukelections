import { describe, expect, it } from "vitest";
import { buildVerificationLedger, evaluatePollingRecord, NOT_COMPARABLE, PENDING_VERIFICATION, PRIMARY_VERIFICATION } from "../scripts/lib/polling-verification.mjs";

const registry = {
  target_series: {
    geography: "GB",
    question_type: "general_election_voting_intention",
    accepted_measure_types: ["publisher_headline"],
    minimum_verified_polls: 2,
  },
  pollsters: {
    "Example Polling": { primary_hosts: ["example.test"], default_measure_type: "publisher_headline" },
    "Different Measure": { primary_hosts: ["example.test"], default_measure_type: "likelihood_to_vote", eligible_for_target_series: false, exclusion_reason: "Different question." },
  },
};

const record = {
  poll_id: "example-1",
  pollster: "Example Polling",
  fieldwork_start: "2026-09-02",
  fieldwork_end: "2026-09-04",
  geography: "GB",
  question_type: "general_election_voting_intention",
  shares: { Labour: 0.25, Conservative: 0.2, "Reform UK": 0.25, "Liberal Democrats": 0.1, "Green Party": 0.1, Other: 0.1 },
  source_url: "https://example.test/results",
};

describe("polling primary-source verification", () => {
  it("only admits a record when a checked first-party evidence entry matches every published share", () => {
    const verifications = { records: [{
      ...record,
      status: PRIMARY_VERIFICATION,
      primary_url: record.source_url,
      checked_at: "2026-09-05T10:00:00Z",
      document_sha256: "abc",
      extract_locator: "table 1",
    }] };
    const result = evaluatePollingRecord(record, registry, verifications);
    expect(result.status).toBe(PRIMARY_VERIFICATION);
    expect(result.included).toBe(true);
  });

  it("keeps source-linked candidates out of the model until a human checks primary evidence", () => {
    const result = evaluatePollingRecord(record, registry, { records: [] });
    expect(result.status).toBe(PENDING_VERIFICATION);
    expect(result.included).toBe(false);
  });

  it("rejects ambiguous UK geography and differently-measured polls", () => {
    expect(evaluatePollingRecord({ ...record, geography: "GB_or_UK_as_listed" }, registry, { records: [] }).status).toBe(PENDING_VERIFICATION);
    expect(evaluatePollingRecord({ ...record, pollster: "Different Measure" }, registry, { records: [] }).status).toBe(NOT_COMPARABLE);
  });

  it("publishes a ledger that cannot claim readiness without the minimum verified sample", () => {
    const ledger = buildVerificationLedger({ generated_at: "2026-09-05T00:00:00Z", records: [record] }, registry, { records: [] });
    expect(ledger.publication_ready).toBe(false);
    expect(ledger.counts.pending_primary_verification).toBe(1);
  });
});
