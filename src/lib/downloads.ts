/** Catalogue metadata comes from published files, never the build clock. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PUBLISHED_DATA, contentTypeFor } from "./publishedData";
import { SITE_URL } from "./site";

export const OUTPUT_LICENCE = "https://creativecommons.org/licenses/by/4.0/";

/** Locations refer to fields in the linked file or its companion JSON. */
const SOURCE_NOTES: Record<string, { section: string; upstream: string }> = {
  "polling/current-polls.json": { section: "source, records and data_quality", upstream: "Wikipedia, Opinion polling for the next United Kingdom general election. The source URL and captured revision hash are recorded in source. Primary verification is separate." },
  "polling/override.json": { section: "sources", upstream: "Westminster: Wikipedia polling table, with source URL, capture hash and fieldwork window in sources.uk_westminster. Devolved series retain their own dates; they are not refreshed by the Westminster average." },
  "polling/source-registry.json": { section: "target_series and pollsters", upstream: "UK Elections registry of named pollsters, publication patterns and primary hosts. A registry entry does not certify an individual poll." },
  "polling/verification-ledger.json": { section: "publication_ready, counts and records", upstream: "UK Elections verification ledger. Each record names the pollster and evidence URL. Pending primary verification is not a verified poll." },
  "predictions/by-elections/makerfield-2026-06-18.json": { section: "inputs, forecast and result", upstream: "UK Elections forecast using the historical election and polling inputs named in the file. The later declared result has its own source; it is not part of the original forecast." },
  "predictions/ge-next/assumptions.json": { section: "snapshot and parameters", upstream: "UK Elections general election model assumptions. These are model parameters, not election results." },
  "predictions/ge-next/constituencies.json": { section: "snapshot.sources and predictions", upstream: "UK Elections estimates. The snapshot lists the constituency identity, historical results, British Election Study priors and national polling inputs, with methodology version." },
  "predictions/ge-next/summary.json": { section: "snapshot.sources, seat_tallies_by_party and national_vote_share", upstream: "UK Elections estimates from the same constituency model. The snapshot records the methodology and any applied polling overlay." },
  "predictions/historical/demographic-indicator-backtest.json": { section: "summary, per_party and predictive_backtest_2025_to_2026", upstream: "UK Elections retrospective analysis of the local result and demographic inputs. Read the council panels and predictive backtest separately from descriptive associations." },
  "predictions/historical/may-2025-council-analysis.json": { section: "election_date, councils, regional, indicators and national", upstream: "UK Elections historical analysis of the May 2025 local elections. This is a derived analysis, not an official national declaration." },
  "transparency/may-2026-postaudit-2026-05-10.json": { section: "snapshot, prereg, live, shadow and step9b", upstream: "UK Elections post-audit against the recorded May 2026 results snapshot. The snapshot names the preregistration manifest and coverage; scores use that edition of the results." },
  "transparency/may-2026-reform-controlled-councils.json": { section: "snapshot.method, control_by_party, majorities and largest_noc", upstream: "UK Elections calculation using the OpenCouncilData 2025 composition snapshot and recorded May 2026 results. Seats previously held are approximated for councils not electing all seats. This is not a verified post-election composition register." },
};

export function recordedDataDate(data: any): string | null {
  const value = data.updated_at ?? data.snapshot?.generated_at ?? data.generated_at;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) && Number.isFinite(Date.parse(value))
    ? value : null;
}

export function loadDownloads() {
  return PUBLISHED_DATA.map(file => {
    // The CSV and Markdown are alternate exports of the neighbouring JSON.
    const metadataPath = file.path.replace(/\.(csv|md)$/, ".json");
    const metadata = JSON.parse(readFileSync(path.join(process.cwd(), "data", metadataPath), "utf8"));
    const notes = SOURCE_NOTES[metadataPath];
    if (!notes) throw new Error(`Missing download provenance: ${file.path}`);
    const date = recordedDataDate(metadata);
    const version = metadata.snapshot?.snapshot_id ?? metadata.model_version ??
      (metadata.schema_version != null ? `Schema ${metadata.schema_version}` : null);
    return {
      ...file,
      href: `/data/${file.path}`,
      date,
      source: {
        publisher: "UK Elections",
        document: file.label,
        edition: [version, date].filter(Boolean).join("; ") || "Edition and date not recorded in file",
        ...notes,
      },
      dateBasis: metadataPath === file.path ? "Timestamp recorded in file" : "Timestamp of companion JSON export",
      format: contentTypeFor(file.path).split(";")[0],
      licence: OUTPUT_LICENCE,
    };
  });
}

export function downloadDistributions() {
  return loadDownloads().map(file => ({
    "@type": "DataDownload",
    name: file.label,
    contentUrl: `${SITE_URL}${file.href}`,
    encodingFormat: file.format,
    license: file.licence,
    ...(file.date ? { dateModified: file.date } : {}),
  }));
}
