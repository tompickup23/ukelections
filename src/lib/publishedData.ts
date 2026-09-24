/**
 * Repository data files deliberately published at /data/<path>.
 *
 * The data directory also contains working and historical material that is not
 * intended for direct publication, so this list is intentionally explicit.
 * tests/published-data-links.test.mjs keeps page links, this allowlist and the
 * files on disk in sync.
 */

export interface PublishedFile {
  /** Path relative to the repository data directory. */
  path: string;
  /** Human-readable description of the published artefact. */
  label: string;
}

export const PUBLISHED_DATA: PublishedFile[] = [
  {
    path: "polling/current-polls.json",
    label: "Current Westminster polls used by the published polling average",
  },
  {
    path: "polling/override.json",
    label: "The rolling Westminster polling average used by the forecasts",
  },
  {
    path: "polling/source-registry.json",
    label: "Registry of polling sources and their publication details",
  },
  {
    path: "polling/verification-ledger.json",
    label: "Verification record for the polling inputs used by the site",
  },
  {
    path: "predictions/by-elections/makerfield-2026-06-18.json",
    label: "Machine-readable forecast for the 2026 Makerfield by-election",
  },
  {
    path: "predictions/ge-next/assumptions.json",
    label: "Next general election model assumptions and inputs",
  },
  {
    path: "predictions/ge-next/constituencies.json",
    label: "Full next general election forecast for all 650 constituencies",
  },
  {
    path: "predictions/ge-next/summary.json",
    label: "Next general election national forecast summary",
  },
  {
    path: "predictions/historical/demographic-indicator-backtest.json",
    label: "Historical backtest for the demographic indicators",
  },
  {
    path: "predictions/historical/may-2025-council-analysis.json",
    label: "Machine-readable analysis of the May 2025 council elections",
  },
  {
    path: "transparency/may-2026-postaudit-2026-05-10.json",
    label: "May 2026 forecast post-audit scored against the declared results",
  },
  {
    path: "transparency/may-2026-reform-controlled-councils.csv",
    label: "Councils under Reform control after May 2026 in CSV format",
  },
  {
    path: "transparency/may-2026-reform-controlled-councils.json",
    label: "Councils under Reform control after May 2026 in JSON format",
  },
  {
    path: "transparency/may-2026-reform-controlled-councils.md",
    label: "Councils under Reform control after May 2026 in Markdown format",
  },
];

/** Content type by extension. Anything unlisted is served as plain text. */
export function contentTypeFor(filePath: string): string {
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (filePath.endsWith(".md")) return "text/markdown; charset=utf-8";
  return "text/plain; charset=utf-8";
}
