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
    expect(imported.history[0].review_status).toBe("reviewed_with_warnings");
    expect(imported.history[0].turnout_votes).toBe(900);
    expect(imported.candidateRosters[0].candidates[0].defending_seat).toBe(true);
  });

  it("drops historical contests with no candidate votes from model history", () => {
    const imported = importAidogeElectionData({
      electionData: {
        ...electionData,
        wards: {
          "Bank Hall": {
            ...electionData.wards["Bank Hall"],
            history: [{
              date: "2024-05-02",
              type: "borough",
              candidates: [
                { name: "Jane Holder", party: "Labour", votes: 0, elected: true },
                { name: "John Challenger", party: "Conservative", votes: 0, elected: false }
              ]
            }]
          }
        }
      },
      sourceSnapshot
    });

    expect(imported.history).toHaveLength(0);
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

  it("backfills missing GSS codes from compact area-name maps", () => {
    const imported = importAidogeElectionData({
      electionData: {
        ...electionData,
        wards: {
          "Gisburn, Rimington": {
            ...electionData.wards["Bank Hall"],
            name: "Gisburn, Rimington",
            gss_code: undefined
          }
        }
      },
      sourceSnapshot,
      areaCodeByName: new Map([["gisburn rimington", "E05012011"]])
    });

    expect(imported.boundaries[0].area_code).toBe("E05012011");
  });

  it("prefers current boundary-code name matches over stale upstream GSS codes", () => {
    const imported = importAidogeElectionData({
      electionData: {
        ...electionData,
        wards: {
          "Carnforth and Millhead Ward": {
            ...electionData.wards["Bank Hall"],
            name: "Carnforth and Millhead Ward",
            gss_code: "E05005225"
          }
        }
      },
      sourceSnapshot,
      areaCodeByName: new Map([["carnforth and millhead", "E05014889"]])
    });

    expect(imported.boundaries[0].area_code).toBe("E05014889");
    expect(imported.boundaries[0].upstream).toMatchObject({
      upstream_area_code: "E05005225",
      area_code_method: "name_matched_current_boundary_code"
    });
    expect(imported.history[0].upstream).toMatchObject({
      source_area_code: "E05005225",
      area_code_method: "name_matched_current_boundary_code"
    });
    expect(imported.history[0].review_status).toBe("quarantined");
  });

  it("accepts Rossendale 2024 stale-GSS history only when backed by official boundary-review evidence", () => {
    const imported = importAidogeElectionData({
      electionData: {
        ...electionData,
        meta: {
          ...electionData.meta,
          council_id: "rossendale",
          council_name: "Rossendale"
        },
        wards: {
          Helmshore: {
            ...electionData.wards["Bank Hall"],
            name: "Helmshore",
            gss_code: "E05005324"
          }
        }
      },
      sourceSnapshot,
      areaCodeByName: new Map([["helmshore", "E05015823"]])
    });

    expect(imported.boundaries[0].area_code).toBe("E05015823");
    expect(imported.history[0].review_status).toBe("reviewed_with_warnings");
    expect(imported.history[0].upstream).toMatchObject({
      source_area_code: "E05005324",
      area_code_method: "name_matched_current_boundary_code",
      stale_gss_current_boundary_review: true,
      boundary_review_evidence_urls: [
        "https://www.rossendale.gov.uk/downloads/file/18429/declaration-of-result-helmshore-2-may-2024",
        "https://www.rossendale.gov.uk/downloads/file/18428/declaration-of-result-longholme-ward-2-may-2024"
      ]
    });
  });

  it("keeps Rossendale pre-2024 stale-GSS history quarantined", () => {
    const imported = importAidogeElectionData({
      electionData: {
        ...electionData,
        meta: {
          ...electionData.meta,
          council_id: "rossendale",
          council_name: "Rossendale"
        },
        wards: {
          Helmshore: {
            ...electionData.wards["Bank Hall"],
            name: "Helmshore",
            gss_code: "E05005324",
            history: [{
              ...electionData.wards["Bank Hall"].history[0],
              date: "2023-05-04"
            }]
          }
        }
      },
      sourceSnapshot,
      areaCodeByName: new Map([["helmshore", "E05015823"]])
    });

    expect(imported.history[0].review_status).toBe("quarantined");
    expect(imported.history[0].upstream.stale_gss_current_boundary_review).toBe(false);
    expect(imported.history[0].upstream.boundary_review_evidence_urls).toBeUndefined();
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

  it("matches population projections by area name when upstream projection codes differ", () => {
    const renamedCodeElectionData = {
      ...electionData,
      wards: {
        "Bank Hall": {
          ...electionData.wards["Bank Hall"],
          gss_code: "E05099999"
        }
      }
    };
    const imported = importAidogeElectionData({ electionData: renamedCodeElectionData, sourceSnapshot });
    const features = buildAidogeFeatureSnapshots({
      electionData: renamedCodeElectionData,
      boundaries: imported.boundaries,
      history: imported.history,
      demographicsData: {
        meta: { ons_code: "E07000117" },
        wards: {
          E05005150: { name: "Bank Hall", population: 1000 }
        }
      },
      projectionData: {
        ward_projections: {
          E05005150: {
            name: "Bank Hall",
            ethnicity: {
              "2027": {
                White: { pct: 70, count: 700 },
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
        demographics: sourceSnapshot
      },
      asOf: "2026-04-18"
    });

    expect(features[0].features.population_projection.quality_level).toBe("rebased_partial");
    expect(features[0].features.population_projection.geography_fit).toBe("exact_area");
    expect(features[0].features.population_projection.limitations).toContain(
      "Population rows were matched by normalized area name because upstream projection or demographic codes differ from the election boundary code."
    );
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

  it("prefers UKD local asylum route context when an authority code is available", () => {
    const imported = importAidogeElectionData({ electionData, sourceSnapshot });
    const features = buildAidogeFeatureSnapshots({
      electionData,
      boundaries: imported.boundaries,
      history: imported.history,
      demographicsData: {
        meta: { ons_code: "E07000117" },
        wards: {}
      },
      localAsylum: {
        snapshotDate: "2025-12-31",
        areas: [{
          areaCode: "E07000117",
          areaName: "Burnley",
          population: 98400,
          supportedAsylum: 150,
          supportedAsylumRate: 15.24
        }]
      },
      sourceSnapshots: {
        elections: sourceSnapshot,
        localAsylum: sourceSnapshot
      },
      asOf: "2026-04-18"
    });

    expect(features[0].features.asylum_context).toMatchObject({
      supported_asylum_stock: 150,
      rate_per_10000_population: 15.24,
      precision: "local_authority_context",
      matched_area_code: "E07000117",
      snapshot_date: "2025-12-31"
    });
    expect(features[0].provenance.find((row) => row.field === "features.asylum_context").notes).toContain("UKD/asylumstats");
  });

  it("uses a supplied local authority lookup for county division asylum context", () => {
    const countyElectionData = {
      ...electionData,
      meta: {
        ...electionData.meta,
        council_id: "lancashire_cc",
        council_name: "Lancashire",
        council_tier: "county"
      },
      wards: {
        "Burnley Central West": {
          ...electionData.wards["Bank Hall"],
          name: "Burnley Central West",
          gss_code: "E58000001"
        }
      }
    };
    const imported = importAidogeElectionData({ electionData: countyElectionData, sourceSnapshot });
    const features = buildAidogeFeatureSnapshots({
      electionData: countyElectionData,
      boundaries: imported.boundaries,
      history: imported.history,
      localAuthorityCodeByAreaCode: new Map([["E58000001", "E07000117"]]),
      localAsylum: {
        snapshotDate: "2025-12-31",
        areas: [{
          areaCode: "E07000117",
          areaName: "Burnley",
          population: 98400,
          supportedAsylum: 150,
          supportedAsylumRate: 15.24
        }]
      },
      sourceSnapshots: {
        elections: sourceSnapshot,
        localAsylum: sourceSnapshot
      },
      asOf: "2026-04-18"
    });

    expect(features[0].features.asylum_context).toMatchObject({
      precision: "local_authority_context",
      matched_area_code: "E07000117",
      matched_area_name: "Burnley"
    });
  });

  it("falls back to Lancashire locality names for county division asylum context", () => {
    const countyElectionData = {
      ...electionData,
      meta: {
        ...electionData.meta,
        council_id: "lancashire_cc",
        council_name: "Lancashire",
        council_tier: "county"
      },
      wards: {
        "Thornton & Hambleton": {
          ...electionData.wards["Bank Hall"],
          name: "Thornton & Hambleton",
          gss_code: "E58000826"
        }
      }
    };
    const imported = importAidogeElectionData({ electionData: countyElectionData, sourceSnapshot });
    const features = buildAidogeFeatureSnapshots({
      electionData: countyElectionData,
      boundaries: imported.boundaries,
      history: imported.history,
      localAsylum: {
        snapshotDate: "2025-12-31",
        areas: [{
          areaCode: "E07000128",
          areaName: "Wyre",
          population: 118760,
          supportedAsylum: 364,
          supportedAsylumRate: 30.65
        }]
      },
      sourceSnapshots: {
        elections: sourceSnapshot,
        localAsylum: sourceSnapshot
      },
      asOf: "2026-04-18"
    });

    expect(features[0].features.asylum_context).toMatchObject({
      precision: "local_authority_context",
      matched_area_code: "E07000128",
      matched_area_name: "Wyre"
    });
  });
});
