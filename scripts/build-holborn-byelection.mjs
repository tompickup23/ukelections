#!/usr/bin/env node
/**
 * build-holborn-byelection.mjs. The Holborn and St Pancras contest file.
 *
 * Keir Starmer announced on 1 September 2026 that he would stand down as MP
 * for Holborn and St Pancras, three months after resigning as Prime Minister.
 * At the time of writing the resignation has not been effected, no writ has
 * been moved and no polling day exists, so this contest is deliberately
 * DATE-LESS: the output filename carries no ISO date, which keeps it off the
 * homepage countdown (`loadUpcomingElections` only reads `<slug>-YYYY-MM-DD`
 * files) while still listing it on /by-elections/. Rename the file the day a
 * polling day is set.
 *
 * There is no forecast here, for the same reason there was none for Clacton:
 * no constituency poll exists and the field is not known. What does exist is
 * the strongest class of substitute this site has, a fresh real same-ground
 * vote four months old. Camden held whole-council elections on 7 May 2026 and
 * ten of its twenty wards sit inside this seat. That is the Arbroath method
 * (`build-scottish-byelections-2026-06-18.mjs`) applied to a London borough
 * instead of a Holyrood constituency, and on that occasion it beat the
 * general-election prior by 5.5pp of MAE (7.62pp against 2.08pp).
 *
 * Ward to constituency membership is computed, not asserted: ward centroids
 * from `data/geography/wd25-bsc-raw.geojson` tested against the seat polygon
 * in `data/geography/pcon24-buc-raw.geojson`. Use the RAW files. The
 * simplified pair drops enough of a seat this small to lose six of the ten
 * wards, which is how this script was first written wrong.
 *
 * THE PART-WARD. A centroid test answers "whole ward in or out", and this seat
 * is not made of whole wards. The Boundary Commission composition is ten whole
 * Camden wards PLUS "Primrose Hill (part)"; Primrose Hill's centroid sits in
 * Hampstead and Highgate, so the test drops all of it. There is no ward-level
 * result for the fraction that is in the seat, and inventing a split would be
 * worse than excluding it, so the published figure is the ten whole wards and
 * the file carries the whole-Primrose-Hill variant next to it as a bound. The
 * truth is between them. It matters: adding all of Primrose Hill moves Labour
 * 38.6 to 38.0 and Green 29.5 to 28.6, and puts the Conservatives above Reform
 * for third. Never state a third place here without that caveat.
 *
 * Ward shares follow `sharesFromCandidates` in the local by-election model:
 * the best candidate per party in a multi-member ward, independents summed.
 * Aggregating the borough's own three-member slates any other way double
 * counts the same elector. The alternative (every candidate summed) is carried
 * as a second sensitivity: it moves Labour 38.6 to 39.6 and Green 29.5 to
 * 29.8, so the method does not carry the story.
 *
 * VALIDATION. Running the all-candidates method over all twenty wards
 * reproduces the published borough-wide result exactly (Labour 32.84% on
 * 52,281 votes, Green 27.14% on 43,206), which is the check that the ward feed
 * underneath this is sound.
 *
 * Output: data/predictions/by-elections/holborn-and-st-pancras.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { geoContains, geoCentroid } from "d3-geo";
import { rewindFeatures } from "../src/lib/geoRewind.ts";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const p = (rel) => path.join(ROOT, rel);
// Memoised: the May results feed is 20MB and the ward boundaries 9.3MB, and
// between the published figure, the two sensitivities and the borough-wide
// validation this script asks for each of them several times over.
const _files = new Map();
const read = (rel) => {
  if (!_files.has(rel)) _files.set(rel, JSON.parse(readFileSync(p(rel), "utf8")));
  return _files.get(rel);
};

const PCON24CD = "E14001290";
const CAMDEN_LAD = "E09000007";
const OUT = "data/predictions/by-elections/holborn-and-st-pancras.json";

const round4 = (x) => Math.round(x * 10000) / 10000;

// Party-name canonicalisation for the GE2024 candidate list. Everything below
// the Loony/UKIP/SEP line is a genuine long-tail, so it collapses to "Other";
// the two independents do not, because Andrew Feinstein's 18.9% is the single
// most important number on the page.
const GE_PARTY = {
  "Labour Party": "Labour",
  "Conservative and Unionist Party": "Conservative",
  "The Official Monster Raving Loony Party": "Other",
  "UK Independence Party (UKIP)": "Other",
  "Socialist Equality Party": "Other",
};

// ---------------------------------------------------------------------------
// 1. Which Camden wards are in the seat
// ---------------------------------------------------------------------------

function wardsInSeat() {
  const wards = read("data/geography/wd25-bsc-raw.geojson");
  const pcons = read("data/geography/pcon24-buc-raw.geojson");
  const seat = rewindFeatures(
    pcons.features.filter((f) => f.properties.PCON24CD === PCON24CD),
  )[0];
  if (!seat) throw new Error(`no polygon for ${PCON24CD}`);

  const camden = rewindFeatures(
    wards.features.filter((f) => f.properties.LAD25CD === CAMDEN_LAD),
  );
  const inSeat = camden.filter((f) => geoContains(seat, geoCentroid(f)));
  if (inSeat.length !== 10) {
    throw new Error(
      `expected 10 Camden wards in ${PCON24CD}, got ${inSeat.length}. ` +
        `Check you are reading the RAW boundary files, not the simplified ones.`,
    );
  }
  return inSeat.map((f) => ({ code: f.properties.WD25CD, name: f.properties.WD25NM }));
}

/** Every Camden ward not already in the seat, for the borough-wide check. */
function allCamdenWardsExcept(seatWards) {
  const wards = read("data/geography/wd25-bsc-raw.geojson");
  const have = new Set(seatWards.map((w) => w.code));
  return wards.features
    .filter((f) => f.properties.LAD25CD === CAMDEN_LAD && !have.has(f.properties.WD25CD))
    .map((f) => ({ code: f.properties.WD25CD, name: f.properties.WD25NM }));
}

/**
 * The part-ward. The Boundary Commission composition for this seat is the ten
 * whole wards above plus "Primrose Hill (part)". A centroid test cannot split
 * a ward, and Primrose Hill's centroid falls in Hampstead and Highgate, so the
 * ten-ward figure excludes it entirely. This returns the whole ward so the
 * file can carry the other bound.
 */
function primroseHill() {
  const wards = read("data/geography/wd25-bsc-raw.geojson");
  const f = wards.features.find(
    (x) => x.properties.LAD25CD === CAMDEN_LAD && x.properties.WD25NM === "Primrose Hill",
  );
  if (!f) throw new Error("Primrose Hill ward not found in the WD25 boundary file");
  return { code: f.properties.WD25CD, name: f.properties.WD25NM };
}

// ---------------------------------------------------------------------------
// 2. The 7 May 2026 Camden result over those wards
// ---------------------------------------------------------------------------

/**
 * Per-party votes in one ward.
 *
 * mode "best" is the published rule and mirrors `sharesFromCandidates` in the
 * local by-election model: the best candidate per party, independents summed.
 * mode "all" sums every candidate, which is what a returning officer's own
 * borough-wide total does. "all" exists to cross-check against the published
 * borough result and to carry the method sensitivity; it is not the published
 * figure, because summing a three-member slate counts the same elector up to
 * three times.
 */
function bestPerParty(candidates, mode = "best") {
  const best = {};
  for (const c of candidates || []) {
    const raw = c.party_canonical || c.party_name;
    const party = /^Independent$/i.test(raw) ? "Independent" : raw;
    const votes = Number(c.votes);
    if (!Number.isFinite(votes) || votes < 0) continue;
    if (mode === "all" || party === "Independent") best[party] = (best[party] || 0) + votes;
    else best[party] = Math.max(best[party] || 0, votes);
  }
  return best;
}

const descShares = (obj, total) =>
  Object.fromEntries(
    Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => [k, round4(v / total)]),
  );

function camdenSignal(seatWards, opts = {}) {
  const { extraWards = [], mode = "best" } = opts;
  const may = read("data/results/may-2026/local-and-mayor.merged.json");
  // Ward slugs in the results feed don't carry GSS codes, so match on the
  // normalised ward name instead of hand-maintaining a slug list. The feed's
  // slugs drop both apostrophes and ampersands ("King's Cross" → kings-cross,
  // "Holborn & Covent Garden" → holborn-covent-garden), so reduce both sides
  // to bare alphanumerics with the conjunction stripped.
  const norm = (s) =>
    s.toLowerCase().replace(/&/g, " ").replace(/\band\b/g, " ").replace(/[^a-z0-9]+/g, "");
  const all = [...seatWards, ...extraWards];
  const wanted = new Map(all.map((w) => [norm(w.name), w]));

  const rows = may.results.filter(
    (r) => r.council_slug === "camden" && !r.is_by_election && wanted.has(norm(r.ward_slug)),
  );
  if (rows.length !== all.length) {
    throw new Error(`matched ${rows.length} of ${all.length} ward results in the May 2026 feed`);
  }

  const agg = {};
  let topTotal = 0;
  let validVotes = 0;
  let turnoutNum = 0;
  let turnoutDen = 0;
  const wards = [];

  for (const r of rows) {
    const best = bestPerParty(r.candidates, mode);
    const wardTop = Object.values(best).reduce((a, b) => a + b, 0);
    for (const [party, votes] of Object.entries(best)) {
      agg[party] = (agg[party] || 0) + votes;
      topTotal += votes;
    }
    validVotes += r.total_valid_votes || 0;
    turnoutNum += (r.turnout_pct || 0) * (r.total_valid_votes || 0);
    turnoutDen += r.total_valid_votes || 0;

    const shares = descShares(best, wardTop);
    wards.push({
      ward: wanted.get(norm(r.ward_slug)).name,
      ward_slug: r.ward_slug,
      seats: r.winner_count,
      turnout_pct: r.turnout_pct != null ? round4(r.turnout_pct) : null,
      total_valid_votes: r.total_valid_votes ?? null,
      top_party: Object.entries(shares)[0][0],
      shares,
    });
  }

  wards.sort((a, b) => a.ward.localeCompare(b.ward));
  return {
    shares: descShares(agg, topTotal),
    turnout_pct: round4(turnoutNum / turnoutDen),
    total_valid_votes: validVotes,
    wards,
  };
}

// ---------------------------------------------------------------------------
// 3. GE2024 baseline
// ---------------------------------------------------------------------------

function ge2024Baseline() {
  const identity = read("data/identity/pcons-ge-next.json");
  const seat = identity.pcons.find((x) => x.slug === "holborn-and-st-pancras");
  if (!seat) throw new Error("holborn-and-st-pancras missing from pcons-ge-next.json");
  const ge = seat.ge2024;
  const total = ge.candidates.reduce((a, c) => a + c.votes, 0);

  const votes = {};
  for (const c of ge.candidates) {
    const party = GE_PARTY[c.party_name] || c.party_name;
    votes[party] = (votes[party] || 0) + c.votes;
  }
  return {
    date: "2024-07-04",
    winner_party: "Labour",
    winner_candidate: "Keir Starmer",
    shares: descShares(votes, total),
    votes: Object.fromEntries(Object.entries(votes).sort((a, b) => b[1] - a[1])),
    majority_votes: 11572,
    majority_pp: round4(11572 / total),
    turnout_votes: total,
    // The identity snapshot carries votes but no turnout or electorate for
    // this seat. Both are published, so they are taken from the constituency
    // record and cited rather than left null or derived.
    turnout_pct: 0.541,
    electorate: 71300,
    turnout_source: "https://en.wikipedia.org/wiki/Holborn_and_St_Pancras",
    note:
      "Andrew Feinstein's 18.9% as an independent was the second-placed vote here, well clear of Reform UK on " +
      "6.1%. The challenger lane in this seat has been a left-of-Labour lane, not a Reform one.",
    source_url: ge.source_url,
  };
}

// ---------------------------------------------------------------------------
// 4. Assemble
// ---------------------------------------------------------------------------

const seatWards = wardsInSeat();
const partWard = primroseHill();
const signal = camdenSignal(seatWards);
const baseline = ge2024Baseline();

// Two sensitivities, both published rather than buried. The first is the one
// that matters: it is the only thing standing between "Reform third" and
// "Conservatives third".
const withPartWard = camdenSignal(seatWards, { extraWards: [partWard] });
const allCandidates = camdenSignal(seatWards, { mode: "all" });

// The validation. The all-candidates rule over all twenty wards must reproduce
// the borough result the returning officer published. If this ever stops
// matching, the ward feed underneath has drifted and nothing else on this page
// can be trusted.
const boroughCheck = camdenSignal(seatWards, {
  extraWards: allCamdenWardsExcept(seatWards),
  mode: "all",
});

const swing = {};
for (const party of new Set([...Object.keys(signal.shares), ...Object.keys(baseline.shares)])) {
  swing[party] = round4((signal.shares[party] || 0) - (baseline.shares[party] || 0));
}

const ranked = (shares) => Object.entries(shares).map(([party, pct]) => ({ party, pct }));
const pct1 = (x) => (x * 100).toFixed(1);

const out = {
  schema_version: "1.0.0",
  model_version: "london-borough-overlap-signal-v1",
  status: "upcoming",
  generated_at: new Date().toISOString(),
  generated_note:
    "Built the day after the resignation announcement. No polling day exists yet, so this file deliberately " +
    "carries no ISO date in its filename and the contest is excluded from the homepage countdown. " +
    "No constituency poll has been published and the field is not known, so there is no vote-share forecast, " +
    "only the freshest actual-vote signal, which is the Camden borough election of 7 May 2026 over the ten " +
    "whole wards inside this seat.",
  contest: {
    constituency_slug: "holborn-and-st-pancras",
    constituency_name: "Holborn and St Pancras",
    pcon24cd: PCON24CD,
    region: "London",
    trigger: {
      type: "resignation",
      departing_mp: "Keir Starmer",
      departing_party: "Labour",
      announced_at: "2026-09-01",
      effected_at: null,
      stated_reason:
        "Starmer told the Camden New Journal on 1 September 2026 that it was 'time to step aside and focus on " +
        "other issues: international affairs including defence, security, trade and technology in a fast " +
        "changing world', alongside continued work on violence against women and girls. He had resigned as " +
        "Prime Minister in June 2026 after a poor set of May local election results and a leadership challenge " +
        "from Andy Burnham, who succeeded him; this is his departure from the Commons, eleven years after " +
        "first winning the seat in 2015.",
    },
    polling_day: null,
    date_status: "tba",
    writ_status: "not_moved",
    timetable_note:
      "The seat is not yet vacant. Once the resignation is effected, by appointment to the Chiltern Hundreds " +
      "or the Manor of Northstead (the two offices of profit that vacate a Commons seat), a writ must be moved, " +
      "and polling day then falls between 21 and 27 working days later.",
  },
  field: {
    status: "not_locked",
    note:
      "Nominations cannot open until the writ is moved. Nothing below is a confirmed candidate; it is what has " +
      "been said publicly, and it is recorded separately from the candidate list on purpose.",
    declared: [
      {
        party: "Green Party",
        candidate: null,
        note:
          "Leader Zack Polanski framed the by-election on 2 September 2026 as 'a referendum on " +
          "ending Rip-off Britain' and said the party 'will announce our candidate in due course'. He has not " +
          "ruled himself out, but as of that statement the Greens had not selected anyone, so treat a Polanski " +
          "candidacy as unresolved rather than likely.",
      },
      {
        party: "Restore Britain",
        candidate: null,
        note:
          "Rupert Lowe has said Restore Britain will stand. Reported secondhand from his statement rather than " +
          "from a party press release, and no candidate is named.",
      },
    ],
    floated: [
      {
        party: "Independent",
        candidate: "Count Binface",
        note:
          "Hinted at standing. Finished second in Clacton on 13 August 2026 with 9,455 votes (26.9%), against " +
          "a five-party boycott.",
      },
    ],
  },
  // Deliberately not a forecast. The by-elections index reads `forecast.winner`
  // for its card, and calling this off a four-month-old local election would
  // dress a signal up as a model. `classification: signal-only` is the same
  // honesty valve the two Scottish seats used.
  forecast: {
    basis: "7 May 2026 Camden borough election over the ten wards inside this seat. No constituency polls exist.",
    winner: null,
    runner_up: null,
    central_shares: null,
    ranked: [],
    classification: "signal-only",
    headline:
      `No forecast: no polling day, no field, no constituency poll. Freshest same-ground vote (Camden, ` +
      `7 May 2026, ten wards): Labour ${pct1(signal.shares["Labour"])}%, Green ` +
      `${pct1(signal.shares["Green Party"])}%, Reform ${pct1(signal.shares["Reform UK"])}%.`,
  },
  inputs: {
    no_polls_note:
      "No published constituency polling. By-elections get no broadcaster exit poll either. The Camden borough " +
      "result below is the substitute, and it is a strong one: a real vote, on this ground, four months old.",
    ge2024_baseline: baseline,
    camden_signal_2026_05_07: {
      name: "Camden London Borough Council election, the ten wards inside Holborn and St Pancras",
      date: "2026-05-07",
      method:
        "Ward membership computed from ward centroids against the PCON24 boundary. Shares are the best " +
        "candidate per party in each multi-member ward (independents summed), aggregated across all ten wards " +
        "and normalised, which is the rule the local by-election model uses.",
      wards_in_seat: seatWards.length,
      wards_in_borough: 20,
      boundary_note:
        "The Boundary Commission composition of this seat is these ten whole Camden wards plus 'Primrose Hill " +
        "(part)'. No ward-level result exists for the fraction of Primrose Hill that is inside the seat, and a " +
        "made-up split would be worse than an honest exclusion, so the published figure is the ten whole wards. " +
        "The variant that adds the whole of Primrose Hill is the other bound, and the true figure sits between " +
        "the two. Highgate and Gospel Oak, which sat in the predecessor seat, are now in Hampstead and " +
        "Highgate and are correctly excluded.",
      sensitivities: [
        {
          id: "with_whole_primrose_hill",
          label: "Adding the whole of Primrose Hill (the part-ward, upper bound)",
          shares: withPartWard.shares,
          note:
            "Moves Labour to " + pct1(withPartWard.shares["Labour"]) + "% and the Greens to " +
            pct1(withPartWard.shares["Green Party"]) + "%, and puts the Conservatives above Reform UK for " +
            "third. The Labour lead over the Greens is barely touched, so the shape of the contest holds, but " +
            "no third place should be asserted without this caveat.",
        },
        {
          id: "all_candidates_summed",
          label: "Summing every candidate instead of the best per party",
          shares: allCandidates.shares,
          note:
            "Moves Labour to " + pct1(allCandidates.shares["Labour"]) + "% and the Greens to " +
            pct1(allCandidates.shares["Green Party"]) + "%. This rule counts an elector up to three times in a " +
            "three-member ward, so it is not the published figure, but it shows the method does not carry the " +
            "story.",
        },
      ],
      validation: {
        method: "The all-candidates rule run over all twenty Camden wards, against the published borough result.",
        computed: boroughCheck.shares,
        published: { Labour: 0.3284, "Green Party": 0.2714, "Liberal Democrats": 0.1483, Conservative: 0.1408, "Reform UK": 0.0751, "Camden People's Alliance": 0.0315 },
        published_source: "https://en.wikipedia.org/wiki/2026_Camden_London_Borough_Council_election",
        note:
          "Labour and Green reproduce the published borough shares and vote counts exactly. The Conservative " +
          "count differs by 10 votes in 22,000, which is a transcription difference in one of the two sources " +
          "and not a defect in the ward feed.",
      },
      shares: signal.shares,
      ranked: ranked(signal.shares),
      turnout_pct: signal.turnout_pct,
      total_valid_votes: signal.total_valid_votes,
      top_party: Object.keys(signal.shares)[0],
      swing_vs_ge2024_pp: swing,
      wards: signal.wards,
      borough_outcome:
        "Labour held the council with 30 of 55 seats, down from 47 in 2022. The Greens went from 1 seat to 11, " +
        "the Liberal Democrats to 10, the Conservatives to 3, and the Camden People's Alliance won 1.",
    },
  },
  watchpoints: [
    "This is not a Reform contest, and that makes it the odd one out. Reform UK took 9.2% across the ten wards " +
      "in May, up 3.1pp on GE2024 but a distant third or fourth depending on whether Primrose Hill is counted. " +
      "Every recent by-election narrative on this site has been about the Reform lane. This one is about the " +
      "Green lane.",
    "The Green Party is up 19.1pp on GE2024 to 29.5% and swept two of the ten wards outright, taking all three " +
      "seats in each of Holborn & Covent Garden and Regent's Park. The Greens also won their first ever " +
      "parliamentary by-election at Gorton and Denton in February 2026, so a strong Green showing here would be " +
      "a second data point, not a novelty.",
    "The Greens have not selected a candidate. Zack Polanski has framed the contest as a national referendum " +
      "and has not ruled himself out, but the party's own statement on 2 September was that a candidate comes " +
      "'in due course'. Who they pick is the single biggest open variable in the seat.",
    "Andrew Feinstein's 18.9% independent vote in 2024 did not evaporate, it reorganised. The Camden People's " +
      "Alliance took 6.3% across the seat from a standing start and won a seat in St Pancras and Somers Town by " +
      "21 votes, unseating Labour's third candidate. Where that lane lands is the difference between a " +
      "comfortable Labour hold and a contest.",
    "Labour's 38.6% in May is 10.3pp below its GE2024 share, on a 37.0% local turnout against 54.1% at the " +
      "general election. Local elections flatter challengers and by-elections flatter them further, so treat " +
      "38.6% as a reading of a bad day rather than a floor.",
    "Turnout is the other unknown. Clacton in August ran at 44.4%; the Camden wards polled at 37.0% in May. A " +
      "low-turnout autumn contest in a seat with a large private-rented and student population is the scenario " +
      "in which a well-organised Green or local-alliance campaign outperforms its share.",
  ],
  sources: [
    {
      label: "2026 Holborn and St Pancras by-election (Wikipedia), for the 1 September announcement to the Camden New Journal, the TBA date and the candidate speculation",
      url: "https://en.wikipedia.org/wiki/2026_Holborn_and_St_Pancras_by-election",
    },
    {
      label: "Green Party press release, 2 September 2026: Polanski on the by-election and on selecting a candidate",
      url: "https://greenparty.org.uk/2026/09/02/polanski-holborn-and-st-pancras-will-be-referendum-on-ending-rip-off-britain/",
    },
    {
      label: "2026 Camden London Borough Council election (Wikipedia), for the borough seat totals and the published borough-wide shares this page validates against",
      url: "https://en.wikipedia.org/wiki/2026_Camden_London_Borough_Council_election",
    },
    {
      label: "Holborn and St Pancras (Wikipedia), for the 2024 turnout and electorate and the Boundary Commission ward composition including Primrose Hill (part)",
      url: "https://en.wikipedia.org/wiki/Holborn_and_St_Pancras",
    },
    { label: "GE2024 result, Holborn and St Pancras (BBC)", url: baseline.source_url },
    {
      label: "Ward-level May 2026 results (Democracy Club, via this site's own results feed)",
      url: "https://candidates.democracyclub.org.uk/",
    },
  ],
};

writeFileSync(p(OUT), JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote ${OUT}`);
console.log(`  wards in seat: ${seatWards.map((w) => w.name).join(", ")}`);
console.log(
  `  Camden signal: ${Object.entries(signal.shares)
    .slice(0, 5)
    .map(([party, share]) => `${party} ${pct1(share)}%`)
    .join(", ")}`,
);
console.log(`  turnout ${pct1(signal.turnout_pct)}% over ${signal.total_valid_votes.toLocaleString()} valid votes`);
