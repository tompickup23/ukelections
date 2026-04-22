const DEFAULT_FEATURE_SERVER =
  "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Online_ONS_Postcode_Directory_Live/FeatureServer/0/query";

function normaliseFeature(feature) {
  const attrs = feature?.attributes || {};
  const pcon24cd = String(attrs.PCON24CD || "").trim();
  const lad25cd = String(attrs.LAD25CD || "").trim();
  const postcodeCount = Number(attrs.postcode_count || attrs.POSTCODE_COUNT || 0);
  if (!/^[ENSW]\d{8}$/.test(pcon24cd) || !/^[ENSW]\d{8}$/.test(lad25cd) || postcodeCount <= 0) {
    return null;
  }
  return { pcon24cd, lad25cd, postcode_count: postcodeCount };
}

export function buildPconLadCrosswalk(rows, {
  generatedAt = new Date().toISOString(),
  sourceUrl = DEFAULT_FEATURE_SERVER
} = {}) {
  const cleanRows = rows.map(normaliseFeature).filter(Boolean);
  const totalsByPcon = new Map();
  const totalsByLad = new Map();
  for (const row of cleanRows) {
    totalsByPcon.set(row.pcon24cd, (totalsByPcon.get(row.pcon24cd) || 0) + row.postcode_count);
    totalsByLad.set(row.lad25cd, (totalsByLad.get(row.lad25cd) || 0) + row.postcode_count);
  }

  return {
    generated_at: generatedAt,
    source: {
      name: "ONS Open Geography Online ONS Postcode Directory Live",
      source_url: sourceUrl,
      feature_layer: "ONSPD_LATEST_UK_Live",
      fields: ["PCON24CD", "LAD25CD", "PCD7"],
      method: "ArcGIS grouped count of live postcodes by Westminster constituency 2024 and local authority district 2025."
    },
    method: {
      apportionment_basis: "live_postcode_count",
      limitations: [
        "Weights count live postcodes, not residents, electors, households, or asylum accommodation locations.",
        "Use as a documented interim apportionment until output-area or postcode population weighted crosswalks are imported."
      ]
    },
    rows: cleanRows
      .map((row) => ({
        ...row,
        pcon_postcode_share: row.postcode_count / totalsByPcon.get(row.pcon24cd),
        lad_postcode_share: row.postcode_count / totalsByLad.get(row.lad25cd)
      }))
      .sort((left, right) => `${left.pcon24cd}:${left.lad25cd}`.localeCompare(`${right.pcon24cd}:${right.lad25cd}`)),
    totals: {
      constituencies: totalsByPcon.size,
      local_authorities: totalsByLad.size,
      postcode_pairs: cleanRows.length,
      live_postcodes: cleanRows.reduce((sum, row) => sum + row.postcode_count, 0)
    }
  };
}

export async function fetchPconLadCrosswalk({
  endpoint = DEFAULT_FEATURE_SERVER,
  generatedAt = new Date().toISOString(),
  fetchImpl = fetch
} = {}) {
  const url = new URL(endpoint);
  url.searchParams.set("f", "json");
  url.searchParams.set("where", "PCON24CD IS NOT NULL AND LAD25CD IS NOT NULL");
  url.searchParams.set("groupByFieldsForStatistics", "PCON24CD,LAD25CD");
  url.searchParams.set("outStatistics", JSON.stringify([{
    statisticType: "count",
    onStatisticField: "PCD7",
    outStatisticFieldName: "postcode_count"
  }]));
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("returnExceededLimitFeatures", "true");
  url.searchParams.set("resultRecordCount", "2000");

  const response = await fetchImpl(url, {
    headers: {
      "user-agent": "UK Elections data audit crosswalk builder"
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ONSPD crosswalk: ${response.status} ${response.statusText}`);
  }
  const body = await response.json();
  if (body.error) {
    throw new Error(`ONSPD crosswalk query failed: ${body.error.message || JSON.stringify(body.error)}`);
  }
  return buildPconLadCrosswalk(body.features || [], {
    generatedAt,
    sourceUrl: endpoint
  });
}

export { DEFAULT_FEATURE_SERVER };
