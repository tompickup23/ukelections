/**
 * Seats defended: which party held each council seat before a contest.
 *
 * The rules are written out in data/seats/README.md. In short: a holder is
 * recorded only when it is determined, never estimated. Where held data leaves
 * two or more parties possible, the record says "unresolved" and why.
 *
 * Pure functions only. The generator (scripts/build-seats-defended.mjs) reads
 * the files and the tests feed these functions small hand-built histories.
 */
import { canonParty } from "./local-byelection-model.mjs";

export const SEATS_FILE = "data/seats/seats-defended.json";

/** Review tiers, best first. Only the generator's own tier is ever rebuilt. */
export const TIERS = ["hand_verified_two_sources", "hand_recorded", "published_roundup", "derived"];
export const HAND_TIERS = new Set(["hand_verified_two_sources", "hand_recorded"]);
export const CONFIDENCE = ["determined", "unresolved"];

/**
 * The party a label stands for. Labour and Co-operative is Labour; every
 * independent is "Independent"; a residents' group or other small party keeps
 * its own name, so two different local groups are never treated as one party.
 */
export function partyLabel(name) {
  const c = canonParty(name);
  if (c !== "Other") return c;
  const s = String(name || "").trim();
  return s || "Other";
}

/** Shift an ISO date by whole years, keeping the month and day. */
export function addYears(isoDate, years) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${String(y + years).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * One contest in a ward, normalised. `winners` is null when the source carries
 * no elected flags, which is not the same as nobody being elected.
 */
export function normaliseContest(raw, sourceName) {
  const cands = raw.candidates || [];
  const flagged = cands.some((c) => c.elected === true || c.elected === "True" || c.elected === "true");
  const winners = flagged
    ? cands
        .filter((c) => c.elected === true || c.elected === "True" || c.elected === "true")
        .map((c) => ({ name: c.name || c.candidate_name || null, party: partyLabel(c.party_canonical || c.party_name), votes: c.votes ?? null }))
    : null;
  return {
    id: raw.ballot_paper_id,
    council: raw.council_slug,
    ward: raw.ward_slug,
    date: raw.election_date,
    is_by: Boolean(raw.is_by_election === true || raw.is_by_election === "True" || /\.by\./.test(raw.ballot_paper_id || "")),
    winners,
    source_name: sourceName,
    source_url: raw.source || null,
    review_status: raw.review_status || null,
  };
}

/** Distinct parties in a list of winners, sorted for stable output. */
const partiesOf = (winners) => [...new Set(winners.map((w) => w.party))].sort();

/**
 * Who could hold a seat in a ward on a date, from the ward's own contests.
 *
 * ward: { date, seats, boundary_start }  date of the contest being asked about
 * history: normalised contests for this council and ward slug, any order.
 *
 * Window: contests on the ward's current boundaries in the four years before
 * the date. Every councillor's term is four years in the councils this is used
 * for, so anyone elected earlier has either been re-elected or replaced within
 * the window. A postponed election (councillors serving past four years) shows
 * up as too few seats filled in the window and is left unresolved, never
 * guessed.
 */
export function sittingParties(history, ward) {
  const from = addYears(ward.date, -4);
  const inWindow = history
    .filter((h) => h.date > from && h.date < ward.date && (!ward.boundary_start || h.date >= ward.boundary_start))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const ordinary = inWindow.filter((h) => !h.is_by);
  const byes = inWindow.filter((h) => h.is_by);
  const evidence = inWindow.map((h) => h.id);
  const missingFlags = inWindow.filter((h) => !h.winners);
  if (missingFlags.length) {
    return { determined: false, reason: "missing_elected_flags", detail: `no elected flags in held data for ${missingFlags.map((h) => h.id).join(", ")}`, evidence };
  }
  const filled = ordinary.reduce((n, h) => n + h.winners.length, 0);
  if (!ordinary.length) {
    return {
      determined: false,
      reason: "no_election_in_window",
      detail: `no ordinary election for this ward on its current boundaries (from ${ward.boundary_start || "unknown"}) in the four years before ${ward.date} in held data: a redrawn ward, a postponed election or a gap in the data`,
      evidence,
    };
  }
  if (ward.seats && filled !== ward.seats) {
    return {
      determined: false,
      reason: "seat_count_mismatch",
      detail: `ordinary elections in the four years before ${ward.date} fill ${filled} seats; the ward has ${ward.seats}. A missing year in the data, a casual vacancy filled at an ordinary election, or a postponed election`,
      evidence,
    };
  }
  if (ward.seats === 1) {
    // One seat: whoever won it last holds it, by-election or not.
    const last = inWindow.at(-1);
    if (last.winners.length !== 1) {
      return { determined: false, reason: "seat_count_mismatch", detail: `${last.id} elected ${last.winners.length} in a one-seat ward`, evidence };
    }
    return { determined: true, parties: [last.winners[0].party], basis: last.is_by ? "single_member_ward_last_byelection" : "single_member_ward_last_election", from: [last], evidence };
  }
  const all = [...ordinary, ...byes].flatMap((h) => h.winners);
  const parties = partiesOf(all);
  if (parties.length === 1) {
    return { determined: true, parties, basis: "every_sitting_councillor_one_party", from: inWindow, evidence };
  }
  return {
    determined: false,
    reason: "two_or_more_parties_in_ward",
    detail: `councillors elected in this ward in the four years before ${ward.date} sat for ${parties.join(", ")}, and held data does not say whose seat fell vacant`,
    parties,
    evidence,
  };
}

/**
 * The seat a scheduled thirds or halves contest on 7 May 2026 defends: the one
 * filled at the ordinary election four years earlier, adjusted for any
 * by-election to that same seat.
 *
 * row: the 7 May 2026 ballot (winner_count is the seats up).
 */
export function thirdsDefended(history, row, electionDate = "2026-05-07") {
  const k = row.winner_count;
  // From 1 January four years earlier: the base election is that May, a few
  // days more than four years before polling day.
  const from = `${Number(electionDate.slice(0, 4)) - 4}-01-01`;
  const inWindow = history
    .filter((h) => h.date >= from && h.date < electionDate)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const evidence = inWindow.map((h) => h.id);
  const missingFlags = inWindow.filter((h) => !h.winners);
  if (missingFlags.length) {
    return { determined: false, reason: "missing_elected_flags", detail: `no elected flags in held data for ${missingFlags.map((h) => h.id).join(", ")}`, evidence };
  }
  const base = inWindow.find((h) => !h.is_by && h.date.slice(0, 4) === from.slice(0, 4));
  const later = inWindow.filter((h) => h !== base);
  const laterOrdinary = later.filter((h) => !h.is_by);
  const byes = later.filter((h) => h.is_by);
  const allParties = partiesOf(inWindow.flatMap((h) => h.winners));

  // Fallback used by every awkward case: if everyone elected in the ward in the
  // four years is one party, the defended seats are that party whatever the order.
  const onePartyFallback = (reason, detail) => {
    if (inWindow.length && allParties.length === 1 && laterOrdinary.length + (base ? 1 : 0) > 0) {
      return { determined: true, parties: Array(k).fill(allParties[0]), basis: "every_sitting_councillor_one_party", note: detail, evidence };
    }
    return { determined: false, reason, detail, parties: allParties, evidence };
  };

  if (!base) {
    return onePartyFallback("no_base_election", `no ordinary election for this ward in ${from.slice(0, 4)} in held data: a redrawn ward or a gap in the data`);
  }
  if (base.winners.length !== k) {
    return onePartyFallback(
      base.winners.length > k ? "base_was_all_out" : "casual_vacancy_in_2026",
      base.winners.length > k
        ? `${base.id} elected ${base.winners.length} councillors and ${k} ${k === 1 ? "is" : "are"} up in ${electionDate.slice(0, 4)}: which retires is set by the council's own retirement order, which held data does not record`
        : `${base.id} elected ${base.winners.length} and ${k} seats are up in ${electionDate.slice(0, 4)}: the extra seat fills a casual vacancy whose holder held data does not record`,
    );
  }
  const oddOrdinary = laterOrdinary.filter((h) => h.winners.length !== k);
  if (oddOrdinary.length) {
    return onePartyFallback("ordinary_contest_odd_size", `${oddOrdinary.map((h) => `${h.id} elected ${h.winners.length}`).join("; ")}: a casual vacancy filled at an ordinary election or a boundary change, so the seat order is not certain`);
  }
  const baseParties = partiesOf(base.winners);
  const crossing = byes.filter((b) => b.winners.some((w) => !baseParties.includes(w.party)) || baseParties.length > 1);
  if (crossing.length) {
    return onePartyFallback(
      "byelection_may_have_filled_seat",
      `${crossing.map((b) => `${b.id} (won by ${partiesOf(b.winners).join(", ")})`).join("; ")} could have filled the ${from.slice(0, 4)} seat or another seat in the ward, and held data does not say which`,
    );
  }
  return {
    determined: true,
    parties: base.winners.map((w) => w.party).sort(),
    basis: byes.length ? "base_election_byelections_same_party" : "base_election",
    from_contest: base.id,
    members: base.winners.map((w) => w.name),
    evidence,
  };
}

/* ------------------------------------------------------------------ */
/* Published roundups (data/results/local-byelections.json)            */
/* ------------------------------------------------------------------ */

export function nameKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/\b(cc|council|county|borough|district|city of|city|metropolitan|royal|the)\b/g, " ")
    .replace(/[^a-z]+/g, "");
}

/** "Labour x2" to ["Labour", "Labour"]; "Labour" to ["Labour"]. */
export function parsePrevious(s) {
  const m = String(s || "").trim().match(/^(.*?)\s*x\s*(\d+)$/i);
  if (m) return Array(Number(m[2])).fill(partyLabel(m[1]));
  return s ? [partyLabel(s)] : [];
}

/** Index the roundup by polling day, council key and ward key. */
export function roundupIndex(doc) {
  const idx = new Map();
  for (const day of doc?.dates || []) {
    for (const c of day.contests || []) {
      const key = `${day.date}|${nameKey(c.council)}|${nameKey(c.ward)}`;
      const list = idx.get(key) || [];
      list.push({ ...c, date: day.date, sources: c.source ? [{ label: c.source_label || "Roundup entry", url: c.source, accessed_at: c.accessed_at }] : day.sources || [] });
      idx.set(key, list);
    }
  }
  return idx;
}

export function roundupFor(idx, contest) {
  const key = `${contest.polling_day}|${nameKey(contest.council_name)}|${nameKey(contest.ward_name)}`;
  const hit = idx.get(key);
  return hit && hit.length === 1 ? hit[0] : null;
}

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

const sameParties = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/**
 * The record for one by-election, from the best tier that answers it.
 * hand: hand-verified holder from data/contests/local-byelection-holders.json
 * roundup: matching row of the published roundup, or null
 * derived: sittingParties() result
 */
export function byElectionRecord(contest, inputs) {
  const rec = byElectionRecordInner(contest, inputs);
  const { derived } = inputs;
  if (rec.review_status !== "derived") {
    // How the record compares with the last-elected reading of held data.
    rec.held_data_check = !derived?.determined
      ? "not_determined"
      : rec.confidence !== "determined"
        ? "not_compared"
        : sameParties([...new Set(derived.parties)], [...new Set(rec.holders)])
          ? "agrees"
          : "differs";
  }
  return rec;
}

function byElectionRecordInner(contest, { hand, roundup, derived, handRecorded }) {
  const base = {
    kind: "by_election",
    council: contest.council_name,
    ward: contest.ward_name,
    polling_day: contest.polling_day,
    seats_contested: contest.seats_contested,
    ward_seats: contest.seats_total,
  };
  const derivedNote = derived?.determined
    ? `Held election data gives ${derived.parties.join(", ")} (${derived.basis}).`
    : derived
      ? `Held election data leaves it open: ${derived.detail}.`
      : null;
  if (hand) {
    const rec = {
      ...base,
      confidence: "determined",
      holders: Array(contest.seats_contested || 1).fill(hand.party),
      elected_as: hand.elected_as || null,
      basis: "vacating_councillor_named_by_two_sources",
      review_status: "hand_verified_two_sources",
      source: [{ label: "data/contests/local-byelection-holders.json", url: null }, ...(hand.sources || [])],
      note: hand.note || null,
    };
    if (derived?.determined && !sameParties(derived.parties, [hand.party])) {
      rec.disagreement = hand.elected_as && sameParties(derived.parties, [partyLabel(hand.elected_as)])
        ? `Held election data gives ${derived.parties.join(", ")}, the party this councillor was elected for; the sources record the change of party.`
        : `Kept the hand-verified party. ${derivedNote}`;
    }
    return rec;
  }
  if (handRecorded) {
    const rec = { ...base, ...handRecorded, review_status: "hand_recorded" };
    if (rec.confidence === "determined" && derived?.determined && !sameParties(derived.parties, [...new Set(rec.holders)])) {
      rec.disagreement = rec.elected_as && sameParties(derived.parties, [partyLabel(rec.elected_as)])
        ? `Held election data gives ${derived.parties.join(", ")}, the party this councillor was elected for; the source records the change of party.`
        : `Kept the hand-recorded party. ${derivedNote}`;
    }
    return rec;
  }
  if (roundup) {
    const prev = parsePrevious(roundup.previous);
    const n = contest.seats_contested || 1;
    const holders = prev.length === n ? prev : null;
    if (!holders) {
      return { ...base, confidence: "unresolved", holders: null, reason: "roundup_seat_count", detail: `the roundup lists ${prev.length} previous holders for ${n} seats`, review_status: "published_roundup", source: roundup.sources };
    }
    if (derived?.determined && !sameParties(derived.parties.length === 1 ? Array(n).fill(derived.parties[0]) : derived.parties, holders)) {
      return {
        ...base,
        confidence: "unresolved",
        holders: null,
        reason: "sources_disagree",
        detail: `the published roundup gives ${holders.join(", ")} but ${derivedNote.replace(/\.$/, "")}. This may be a change of party since the election, or an error in either; check the council's own record`,
        candidates: { roundup: holders, last_elected: derived.parties },
        review_status: "published_roundup",
        source: roundup.sources,
      };
    }
    return {
      ...base,
      confidence: "determined",
      holders,
      basis: "previous_party_named_by_published_roundup",
      review_status: "published_roundup",
      source: roundup.sources,
      note: derived?.determined
        ? "The roundup and held election data agree."
        : `The roundup is the only source held. ${derivedNote || ""}`.trim(),
    };
  }
  if (derived?.determined) {
    const n = contest.seats_contested || 1;
    return {
      ...base,
      confidence: "determined",
      holders: Array(n).fill(derived.parties[0]),
      basis: derived.basis,
      review_status: "derived",
      source: derived.evidence.map((id) => ({ label: `Democracy Club result ${id}`, url: `https://candidates.democracyclub.org.uk/elections/${id}/` })),
      note: "Party as last elected. A change of party since then is not checked unless a source is named.",
    };
  }
  return {
    ...base,
    confidence: "unresolved",
    holders: null,
    reason: derived?.reason || "no_data",
    detail: derived?.detail || "no held election data for this ward",
    review_status: "derived",
    source: (derived?.evidence || []).map((id) => ({ label: `Democracy Club result ${id}`, url: `https://candidates.democracyclub.org.uk/elections/${id}/` })),
  };
}

/** Check a seats-defended file against its own rules. Returns problems, empty when sound. */
export function validateSeats(doc) {
  const errors = [];
  for (const [section, recs] of [["by_elections", doc?.by_elections || {}], ["scheduled", doc?.scheduled || {}]]) {
    for (const [id, r] of Object.entries(recs)) {
      const where = `${section} ${id}`;
      if (!CONFIDENCE.includes(r.confidence)) errors.push(`${where}: confidence must be determined or unresolved`);
      if (!TIERS.includes(r.review_status)) errors.push(`${where}: unknown review_status ${r.review_status}`);
      if (!Array.isArray(r.source) || !r.source.length) {
        if (r.confidence === "determined") errors.push(`${where}: a determined record needs a source`);
      }
      const list = section === "by_elections" ? r.holders : r.defended;
      if (r.confidence === "determined") {
        if (!Array.isArray(list) || !list.length) errors.push(`${where}: determined but no party`);
        if (!r.basis) errors.push(`${where}: determined but no basis`);
      } else {
        if (list != null) errors.push(`${where}: unresolved records carry no party`);
        if (!r.reason || !r.detail) errors.push(`${where}: unresolved records need a reason and detail`);
      }
      const n = section === "by_elections" ? r.seats_contested : r.seats_up;
      if (Array.isArray(list) && n && list.length !== n) errors.push(`${where}: ${list.length} parties for ${n} seats`);
    }
  }
  return errors;
}

/** The holder the scoreboard benchmark calls: one party, or null when not determined. */
export function benchmarkHolder(record) {
  if (!record || record.confidence !== "determined" || !record.holders?.length) return null;
  const parties = [...new Set(record.holders)];
  return parties.length === 1 ? parties[0] : null;
}

/** Map a party label to the council-control.json key. */
export function controlKey(party) {
  switch (party) {
    case "Conservative": return "con";
    case "Labour": return "lab";
    case "Liberal Democrats": return "ld";
    case "Green Party": return "green";
    case "Reform UK": return "ref";
    default: return "other";
  }
}
