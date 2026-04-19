import { describe, expect, it } from "vitest";
import {
  buildAidogeFeatureSnapshots,
  importAidogeElectionData,
  importAidogePollAggregate
} from "../scripts/lib/local-upstream-importers.mjs";
import { validateHistoryBundle } from "../scripts/lib/history-quality.mjs";
import { validateModelInputs } from "../scripts/lib/model-input-quality.mjs";
import { validateCandidateRosters } from "../scripts/lib/candidate-quality.mjs";

const sourceSnapshot = {
  snapshot_id: "ai-doge-example-123",
  source_url: "https://ukelections.co.uk/sources"
};

const electionData = {
  meta: {
    council_id: "burnley",
    council_name: "Burnley",
    council_tier: "district",
    generated: "2026-04-18T00:00:00Z",
    next_election: {
      date: "2026-05-07",
      type: "borough_thirds",
      defenders: {
        "Bank Hall": { name: "Jane Holder", party: "Labour" }
      }
    }
  },
  wards: {
    "Bank Hall": {
      gss_code: "E05005150",
      current_holders: [{ name: "Jane Holder", party: "Labour" }],
      history: [
        {
          date: "2024-05-02",
          type: "borough",
          turnout_votes: 900,
          turnout: 0.3,
          candidates: [
            { name: "Jane Holder", party: "Labour", votes: 600, elected: true },
            { name: "John Challenger", party: "Conservative", votes: 300, elected: false }
          ]
        }
      ],
      candidates_2026: [
        { name: "Jane Holder", party: "Labour" },
        { name: "John Challenger", party: "Conservative" }
      ]
    }
  }
};

describe("local upstream importers", () => {
  it("imports AI DOGE ward history and nominations into backend manifests", () => {
    const imported = importAidogeElectionData({ electionData, sourceSnapshot });
    const validation = validateHistoryBundle({
      boundaries: imported.boundaries,
      history: imported.history
    });
    const candidateValidation = validateCandidateRosters(imported.candidateRosters);

    expect(validation.ok).toBe(true);
    expect(candidateValidation.ok).toBe(true);
    expect(imported.boundaries[0].review_status).toBe("quarantined");
    expect(imported.history[0].turnout_votes).toBe(900);
    expect(imported.candidateRosters[0].candidates[0].defending_seat).toBe(true);
  });

  it("links Lancashire candidate rosters to official statement sources when supplied", () => {
    const imported = importAidogeElectionData({
      electionData,
      sourceSnapshot,
      candidateSourceSnapshot: { snapshot_id: "sopn-source-1", source_url: "https://ukelections.co.uk/sources" },
      candidateSourceManifest: [{
        council_id: "burnley",
        official_url: "https://example.com/statement.pdf",
        official_page_url: "https://example.com/notices",
        source_basis: "statement_of_persons_nominated"
      }]
    });

    expect(imported.candidateRosters[0].source_snapshot_id).toBe("sopn-source-1");
    expect(imported.candidateRosters[0].statement_of_persons_nominated_url).toBe("https://example.com/statement.pdf");
    expect(imported.candidateRosters[0].direct_statement_url_attached).toBe(true);
  });

  it("imports AI DOGE polling as a validated aggregate", () => {
    const aggregate = importAidogePollAggregate({
      sourceSnapshot,
      pollingData: {
        meta: { generated: "2026-04-18" },
        aggregate: { Labour: 0.4, Conservative: 0.3, Other: 0.3 },
        individual_polls: [
          {
            pollster: "Example Polls",
            start_date: "2026-04-01",
            end_date: "2026-04-03",
            sample_size: 1000,
            parties: { Labour: 40, Conservative: 30, Other: 30 }
          }
        ]
      }
    });

    const result = validateModelInputs({ pollAggregates: [aggregate], featureSnapshots: [] });
    expect(result.pollResults[0].ok).toBe(true);
    expect(aggregate.aggregate_party_shares.Labour).toBeCloseTo(0.4);
    expect(aggregate.poll_count).toBe(1);
  });

  it("builds quarantined feature snapshots with explicit population quality", () => {
    const imported = importAidogeElectionData({ electionData, sourceSnapshot });
    const pollAggregate = importAidogePollAggregate({
      sourceSnapshot,
      pollingData: {
        aggregate: { Labour: 0.4, Conservative: 0.3, Other: 0.3 },
        individual_polls: []
      }
    });
    const features = buildAidogeFeatureSnapshots({
      electionData,
      boundaries: imported.boundaries,
      history: imported.history,
      pollAggregate,
      demographicsData: {
        meta: { ons_code: "E07000117" },
        wards: {}
      },
      projectionData: {
        ward_projections: {
          E05005150: {
            ethnicity: {
              "2027": {
                "White": { pct: 70, count: 700 },
                "White: English, Welsh, Scottish, Northern Irish or British": { pct: 65, count: 650 },
                "Asian, Asian British or Asian Welsh": { pct: 20, count: 200 },
                "_total": 1000
              }
            }
          }
        }
      },
      ukdBasePopulation: { areas: { E07000117: {} } },
      sourceSnapshots: {
        elections: sourceSnapshot,
        projections: sourceSnapshot,
        polling: sourceSnapshot
      },
      asOf: "2026-04-18"
    });
    const result = validateModelInputs({ pollAggregates: [pollAggregate], featureSnapshots: features });

    expect(result.ok).toBe(true);
    expect(features[0].review_status).toBe("quarantined");
    expect(features[0].features.population_projection.quality_level).toBe("rebased_partial");
    expect(features[0].features.population_projection.geography_fit).toBe("exact_area");
  });

  it("matches asylum context by local authority area name when constituency names differ", () => {
    const imported = importAidogeElectionData({ electionData, sourceSnapshot });
    const features = buildAidogeFeatureSnapshots({
      electionData: {
        ...electionData,
        meta: {
          ...electionData.meta,
          council_name: "Blackpool"
        }
      },
      boundaries: imported.boundaries,
      history: imported.history,
      constituencyAsylum: {
        constituencies: {
          "Blackpool North and Fleetwood": {
            area_name: "Blackpool",
            asylum_seekers: 577,
            asylum_rate_per_10k: 40,
            population: 144191,
            white_british_pct: 90.4
          },
          "Blackpool South": {
            area_name: "Blackpool",
            asylum_seekers: 577,
            asylum_rate_per_10k: 40,
            population: 144191,
            white_british_pct: 90.4
          }
        }
      },
      sourceSnapshots: {
        elections: sourceSnapshot,
        constituencyAsylum: sourceSnapshot
      },
      asOf: "2026-04-18"
    });

    expect(features[0].features.asylum_context).toMatchObject({
      supported_asylum_stock: 577,
      rate_per_10000_population: 40,
      precision: "local_authority_context",
      matched_constituency_names: ["Blackpool North and Fleetwood", "Blackpool South"]
    });
  });
});
