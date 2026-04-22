import { describe, expect, it } from "vitest";
import { buildPconLadCrosswalk } from "../scripts/lib/ons-postcode-directory-crosswalk.mjs";

describe("ONS postcode directory crosswalk", () => {
  it("builds constituency and local-authority live-postcode weights", () => {
    const crosswalk = buildPconLadCrosswalk([
      { attributes: { PCON24CD: "E14000001", LAD25CD: "E07000001", postcode_count: 30 } },
      { attributes: { PCON24CD: "E14000001", LAD25CD: "E07000002", postcode_count: 70 } },
      { attributes: { PCON24CD: "E14000002", LAD25CD: "E07000002", postcode_count: 30 } }
    ], { generatedAt: "2026-04-22T00:00:00.000Z", sourceUrl: "https://example.test/query" });

    expect(crosswalk.totals).toMatchObject({
      constituencies: 2,
      local_authorities: 2,
      postcode_pairs: 3,
      live_postcodes: 130
    });
    expect(crosswalk.rows.find((row) => row.pcon24cd === "E14000001" && row.lad25cd === "E07000002")).toMatchObject({
      pcon_postcode_share: 0.7,
      lad_postcode_share: 0.7
    });
  });
});
