/** Explicitly allowlisted polling artefacts served at /data/. */
export interface PublishedFile {
  path: string;
  label: string;
}

export const PUBLISHED_DATA: PublishedFile[] = [
  {
    path: "polling/override.json",
    label: "The published 14-day Westminster polling average and its fieldwork window",
  },
  {
    path: "polling/current-polls.json",
    label: "The individual current-window polls used by the Westminster average",
  },
  {
    path: "polling/verification-ledger.json",
    label: "The public source and comparability checks for current Westminster polling candidates",
  },
  {
    path: "polling/source-registry.json",
    label: "The source and comparability policy for Westminster polling verification",
  },
];

export function contentTypeFor(filePath: string): string {
  return filePath.endsWith(".json") ? "application/json; charset=utf-8" : "text/plain; charset=utf-8";
}
