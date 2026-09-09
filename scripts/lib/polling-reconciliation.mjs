import { createHash } from "node:crypto";

export const ROAD_TO_326_ARCHIVE_URL = "https://roadto326.com/data/poll-archive.json";

const PARTY_KEYS = {
  lab: "Labour",
  con: "Conservative",
  ref: "Reform UK",
  ld: "Liberal Democrats",
  green: "Green Party",
  snp: "SNP",
  pc: "Plaid Cymru",
  other: "Other",
  restore: "Restore Britain",
};

function isoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function percentToShare(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value / 100
    : null;
}

function normalise(shares) {
  const total = Object.values(shares).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  return Object.fromEntries(Object.entries(shares).map(([party, value]) => [party, value / total]));
}

/**
 * Convert a source-linked Road to 326 record to the site party taxonomy.
 * This is deliberately restricted to current GB national voting-intention
 * polls. It does not import MRPs, regional work, or rows without enough
 * published shares to stand beside the existing Wikipedia-derived average.
 */
export function normaliseRoadTo326Poll(row) {
  if (!row || row.mrp === true) return null;
  if (!/^(GB|Great Britain)$/i.test(String(row.area || ""))) return null;
  const fieldworkEnd = isoDate(row.fieldwork_end);
  const publicationDate = isoDate(row.publication_date);
  const pollster = typeof row.pollster === "string" ? row.pollster.trim() : "";
  if (!fieldworkEnd || !publicationDate || !pollster || !row.source_url) return null;

  const raw = row.shares || {};
  const shares = {};
  let missing = 0;
  for (const key of ["lab", "con", "ref", "ld", "green", "snp", "pc", "other", "restore"]) {
    const value = percentToShare(raw[key]);
    if (value == null) {
      missing += 1;
      continue;
    }
    shares[PARTY_KEYS[key]] = value;
  }

  // Small parties and a separately prompted Restore Britain question can be
  // absent. The five principal GB parties must be present, and at most two of
  // the remaining columns may be absent, matching the existing parser rule.
  if (["Labour", "Conservative", "Reform UK", "Liberal Democrats", "Green Party"].some((party) => shares[party] == null)) return null;
  if (missing > 2) return null;

  const restoreBritain = shares["Restore Britain"];
  delete shares["Restore Britain"];
  if (restoreBritain != null) shares.Other = (shares.Other || 0) + restoreBritain;

  const total = Object.values(shares).reduce((sum, value) => sum + value, 0);
  if (total < 0.85 || total > 1.15) return null;
  const canonicalShares = normalise(shares);
  if (!canonicalShares) return null;

  const pollId = row.id || createHash("sha256")
    .update(JSON.stringify([pollster, fieldworkEnd, publicationDate, raw]))
    .digest("hex")
    .slice(0, 16);

  return {
    poll_id: `road-to-326:${pollId}`,
    date: fieldworkEnd,
    fieldwork_start: isoDate(row.fieldwork_start),
    fieldwork_end: fieldworkEnd,
    publication_date: publicationDate,
    pollster,
    client: row.client || null,
    sample_size: Number.isInteger(row.sample_size) && row.sample_size > 0 ? row.sample_size : null,
    mode: row.mode || null,
    geography: "GB",
    question_type: "general_election_voting_intention",
    shares: canonicalShares,
    ...(restoreBritain != null ? { restore_britain_reported: restoreBritain } : {}),
    source_name: row.source_name || "Road to 326 archive",
    source_url: row.source_url,
    source_archive_url: ROAD_TO_326_ARCHIVE_URL,
    source_status: "source_linked_secondary",
  };
}

export function recentRoadTo326Polls(payload, { now = new Date(), windowDays = 14 } = {}) {
  const current = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const cutoff = current - windowDays * 86400 * 1000;
  const seen = new Set();
  const polls = [];
  for (const row of payload?.polls || []) {
    const poll = normaliseRoadTo326Poll(row);
    if (!poll) continue;
    const time = Date.parse(`${poll.fieldwork_end}T00:00:00Z`);
    if (!Number.isFinite(time) || time < cutoff || time > current + 86400 * 1000) continue;
    if (seen.has(poll.poll_id)) continue;
    seen.add(poll.poll_id);
    polls.push(poll);
  }
  return polls.sort((left, right) => (
    left.fieldwork_end.localeCompare(right.fieldwork_end)
    || left.publication_date.localeCompare(right.publication_date)
    || left.poll_id.localeCompare(right.poll_id)
  ));
}

export function averagePollRecords(polls) {
  if (!polls.length) return null;
  const sums = {};
  const counts = {};
  const rb = [];
  for (const poll of polls) {
    for (const [party, share] of Object.entries(poll.shares)) {
      sums[party] = (sums[party] || 0) + share;
      counts[party] = (counts[party] || 0) + 1;
    }
    if (poll.restore_britain_reported != null) rb.push(poll.restore_britain_reported);
  }
  const shares = normalise(Object.fromEntries(Object.entries(sums).map(([party, sum]) => [party, sum / counts[party]])));
  if (!shares) return null;
  return {
    shares,
    polls_used: polls.length,
    fieldwork_window: {
      earliest: polls[0].fieldwork_end,
      latest: polls.at(-1).fieldwork_end,
    },
    ...(rb.length ? {
      restore_britain: {
        share_where_reported: rb.reduce((sum, value) => sum + value, 0) / rb.length,
        polls_reporting: rb.length,
      },
    } : {}),
  };
}
