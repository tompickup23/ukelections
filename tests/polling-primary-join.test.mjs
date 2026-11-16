import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { attachPrimaryEvidence } from "../scripts/verify-polling-sources.mjs";
import { buildVerificationLedger } from "../scripts/lib/polling-verification.mjs";

const registry = JSON.parse(readFileSync(path.join(process.cwd(), "data/polling/source-registry.json"), "utf8"));
const WIKI = "https://en.wikipedia.org/wiki/Opinion_polling_for_the_next_United_Kingdom_general_election";
const shares = { Labour: 0.3, Conservative: 0.2, "Reform UK": 0.22, "Liberal Democrats": 0.1, "Green Party": 0.08, SNP: 0.03, "Plaid Cymru": 0.01, Other: 0.06 };
const row = {
  poll_id: "wikipedia:2026-10-30:Opinium:0", fieldwork_start: null, fieldwork_end: "2026-10-30", pollster: "Opinium",
  sample_size: null, geography: "GB_or_UK_as_listed", question_type: "general_election_voting_intention",
  shares, source_name: "Wikipedia polling table", source_url: WIKI,
};
const evidence = (extra = {}) => ({
  records: [{
    status: "primary_verified", pollster: "Opinium", fieldwork_start: "2026-10-29", fieldwork_end: "2026-10-30",
    source_url: "https://www.opinium.com/example/", primary_url: "https://www.opinium.com/example/",
    geography: "GB", question_type: "general_election_voting_intention", sample_size: 2050, shares, ...extra,
  }],
});

describe("joining first-party checks to Wikipedia rows", () => {
  it("verifies a row whose shares match the pollster's table", () => {
    const v = evidence();
    const joined = attachPrimaryEvidence({ records: [row] }, v);
    const ledger = buildVerificationLedger(joined.current, registry, v);
    expect(ledger.records[0].status).toBe("primary_verified");
    expect(ledger.records[0].discovered_via).toBe(WIKI);
    expect(ledger.records[0].sample_size).toBe(2050);
  });

  it("leaves a disagreeing row as Wikipedia has it and records both", () => {
    const v = evidence({ shares: { ...shares, Labour: 0.31, Other: 0.05 } });
    const joined = attachPrimaryEvidence({ records: [row] }, v);
    expect(joined.current.records[0].shares).toEqual(shares);
    expect(joined.current.records[0].source_url).toBe(WIKI);
    expect(joined.disagreements[0].differences.map((d) => d.party).sort()).toEqual(["Labour", "Other"]);
    const ledger = buildVerificationLedger(joined.current, registry, v);
    expect(ledger.records[0].status).toBe("pending_primary_verification");
  });

  it("never verifies from a URL off the pollster's own domain", () => {
    const v = evidence({ source_url: "https://example.com/x", primary_url: "https://example.com/x" });
    const joined = attachPrimaryEvidence({ records: [row] }, v);
    expect(buildVerificationLedger(joined.current, registry, v).records[0].status).toBe("pending_primary_verification");
  });
});
