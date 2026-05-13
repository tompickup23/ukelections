#!/usr/bin/env node
/**
 * build-council-cycles.mjs — produce data/identity/council-cycles.json,
 * a per-council next-election lookup that powers the public council index.
 *
 * Status values:
 *   - "scheduled"     — date is statutorily fixed (London 2030, Met thirds 2027,
 *                       fixed-cycle unitary, Welsh principal area, etc.)
 *   - "lgr_pending"   — council sits in a 2-tier area undergoing Local Government
 *                       Reorganisation; next election awaiting Statutory Instrument.
 *   - "tbc"           — date is otherwise uncertain (boundary review,
 *                       restructure consultation, etc.).
 *
 * Source basis (audit before public quoting):
 *   - English Devolution White Paper, Dec 2024 (Priority Programme LGR areas).
 *   - GOV.UK council elections cycle (Local Government Boundary Commission).
 *   - May 7 2026 contesting cohort taken from council-control.json (154 councils).
 *
 * Tom owns the LGR_PENDING_COUNTIES list — update when SIs land.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");

const control = JSON.parse(
  readFileSync(path.join(ROOT, "data/results/may-2026/council-control.json"), "utf8")
);

const LONDON_BOROUGHS = new Set([
  "barking-and-dagenham", "barnet", "bexley", "brent", "bromley", "camden",
  "croydon", "ealing", "enfield", "greenwich", "hackney", "hammersmith-and-fulham",
  "haringey", "harrow", "havering", "hillingdon", "hounslow", "islington",
  "kensington-and-chelsea", "kingston-upon-thames", "lambeth", "lewisham", "merton",
  "newham", "redbridge", "richmond-upon-thames", "southwark", "sutton",
  "tower-hamlets", "waltham-forest", "wandsworth", "westminster",
  "city-of-london",
]);

const METROPOLITAN_BOROUGHS = new Set([
  "barnsley", "birmingham", "bolton", "bradford", "bury", "calderdale",
  "coventry", "doncaster", "dudley", "gateshead", "kirklees", "knowsley",
  "leeds", "liverpool", "manchester", "newcastle-upon-tyne", "north-tyneside",
  "oldham", "rochdale", "rotherham", "salford", "sandwell", "sefton",
  "sheffield", "solihull", "south-tyneside", "st-helens", "stockport",
  "sunderland", "tameside", "trafford", "wakefield", "walsall", "wigan",
  "wirral", "wolverhampton",
]);

// Met boroughs that vote all-up rather than by thirds (i.e. were on the May 7
// ballot as all-up). Sunderland switched to all-up after LGR consultation.
const MET_ALL_UP = new Set([
  "wakefield", "sunderland", "barnsley", "south-tyneside", "gateshead",
  "sandwell", "walsall", "calderdale", "st-helens",
]);

// English unitaries known to vote all-up on a 4-year cycle. These voted in
// 2026 and next vote in 2030. Source: each council's election cycle page.
const UNITARY_ALL_UP_2026 = new Set([
  "isle-of-wight", "hartlepool", "milton-keynes", "kingston-upon-hull",
  "north-east-lincolnshire", "peterborough", "plymouth", "portsmouth",
  "reading", "southampton", "southend-on-sea", "swindon", "thurrock",
  "west-northamptonshire", "somerset", "blackburn-with-darwen",
]);

// Welsh principal areas vote every 5 years; last 2022 → next 2027.
const WELSH_PRINCIPAL_AREAS = new Set(["newport", "powys"]);

// Counties on the May 7 ballot that ARE undergoing LGR (their 2025 election
// was deferred). Status = lgr_pending until the SI lands and a new unitary
// is created or a new election date is set.
const LGR_PENDING_COUNTIES = new Set([
  "essex", "suffolk", "norfolk", "hampshire", "hertfordshire",
  "east-sussex", "west-sussex", "surrey", "gloucestershire",
]);

// Unitaries that vote by thirds (annual, three years in four). Next election
// after May 2026 is May 2027.
const UNITARY_THIRDS = new Set(["halton", "wokingham"]);

// District councils sitting in 2-tier areas. Their county-tier partner is
// either on the LGR_PENDING_COUNTIES list (so the district is LGR-pending
// itself) or already abolished. Curated from the published 2-tier list.
const TWO_TIER_DISTRICTS_BY_COUNTY = {
  cambridgeshire: ["cambridge", "east-cambridgeshire", "fenland", "huntingdonshire", "south-cambridgeshire"],
  derbyshire: ["amber-valley", "bolsover", "chesterfield", "derbyshire-dales", "erewash", "high-peak", "north-east-derbyshire", "south-derbyshire"],
  devon: ["east-devon", "exeter", "mid-devon", "north-devon", "south-hams", "teignbridge", "torridge", "west-devon"],
  "east-sussex": ["eastbourne", "hastings", "lewes", "rother", "wealden"],
  essex: ["basildon", "braintree", "brentwood", "castle-point", "chelmsford", "colchester", "epping-forest", "harlow", "maldon", "rochford", "tendring", "uttlesford"],
  gloucestershire: ["cheltenham", "cotswold", "forest-of-dean", "gloucester", "stroud", "tewkesbury"],
  hampshire: ["basingstoke-and-deane", "east-hampshire", "eastleigh", "fareham", "gosport", "hart", "havant", "new-forest", "rushmoor", "test-valley", "winchester"],
  hertfordshire: ["broxbourne", "dacorum", "east-hertfordshire", "hertsmere", "north-hertfordshire", "stevenage", "st-albans", "three-rivers", "watford", "welwyn-hatfield"],
  kent: ["ashford", "canterbury", "dartford", "dover", "folkestone-and-hythe", "gravesham", "maidstone", "sevenoaks", "swale", "thanet", "tonbridge-and-malling", "tunbridge-wells"],
  lancashire: ["burnley", "chorley", "fylde", "hyndburn", "lancaster", "pendle", "preston", "ribble-valley", "rossendale", "south-ribble", "west-lancashire", "wyre"],
  leicestershire: ["blaby", "charnwood", "harborough", "hinckley-and-bosworth", "melton", "north-west-leicestershire", "oadby-and-wigston"],
  lincolnshire: ["boston", "city-of-lincoln", "east-lindsey", "north-kesteven", "south-holland", "south-kesteven", "west-lindsey"],
  norfolk: ["breckland", "broadland", "great-yarmouth", "kings-lynn-and-west-norfolk", "north-norfolk", "norwich", "south-norfolk"],
  nottinghamshire: ["ashfield", "bassetlaw", "broxtowe", "gedling", "mansfield", "newark-and-sherwood", "rushcliffe"],
  oxfordshire: ["cherwell", "oxford", "south-oxfordshire", "vale-of-white-horse", "west-oxfordshire"],
  staffordshire: ["cannock-chase", "east-staffordshire", "lichfield", "newcastle-under-lyme", "south-staffordshire", "stafford", "staffordshire-moorlands", "tamworth"],
  suffolk: ["babergh", "east-suffolk", "ipswich", "mid-suffolk", "west-suffolk"],
  surrey: ["elmbridge", "epsom-and-ewell", "guildford", "mole-valley", "reigate-and-banstead", "runnymede", "spelthorne", "surrey-heath", "tandridge", "waverley", "woking"],
  warwickshire: ["north-warwickshire", "nuneaton-and-bedworth", "rugby", "stratford-on-avon", "warwick"],
  "west-sussex": ["adur", "arun", "chichester", "crawley", "horsham", "mid-sussex", "worthing"],
  worcestershire: ["bromsgrove", "malvern-hills", "redditch", "worcester", "wychavon", "wyre-forest"],
};

const LGR_DISTRICTS = new Set();
for (const [, districts] of Object.entries(TWO_TIER_DISTRICTS_BY_COUNTY)) {
  for (const d of districts) LGR_DISTRICTS.add(d);
}

const LGR_NOTE = "Two-tier council under English Local Government Reorganisation. Next election date awaiting Statutory Instrument.";

function classify(councilSlug, controlRow) {
  const cycle = controlRow.cycle || {};
  const isAllUp = !!cycle.is_all_up;

  if (LONDON_BOROUGHS.has(councilSlug)) {
    return {
      type: "london_borough",
      status: "scheduled",
      next_election: "2030-05-02",
      next_election_label: "May 2030",
      cycle: "Whole council every 4 years (London cycle).",
    };
  }

  if (LGR_PENDING_COUNTIES.has(councilSlug)) {
    return {
      type: "county_council",
      status: "lgr_pending",
      next_election: null,
      next_election_label: "TBC (Local Government Reorganisation)",
      cycle: "County-tier election deferred. Awaiting SI to vest new unitary authorities.",
      note: LGR_NOTE,
    };
  }

  if (LGR_DISTRICTS.has(councilSlug)) {
    return {
      type: "district_council",
      status: "lgr_pending",
      next_election: null,
      next_election_label: "TBC (Local Government Reorganisation)",
      cycle: "District tier under LGR review. Council may be abolished into a new unitary.",
      note: LGR_NOTE,
    };
  }

  if (METROPOLITAN_BOROUGHS.has(councilSlug)) {
    if (MET_ALL_UP.has(councilSlug)) {
      return {
        type: "metropolitan_borough",
        status: "scheduled",
        next_election: "2030-05-02",
        next_election_label: "May 2030",
        cycle: "Whole council every 4 years.",
      };
    }
    return {
      type: "metropolitan_borough",
      status: "scheduled",
      next_election: "2027-05-06",
      next_election_label: "May 2027",
      cycle: "By thirds, three years in four.",
    };
  }

  if (WELSH_PRINCIPAL_AREAS.has(councilSlug)) {
    return {
      type: "welsh_principal_area",
      status: "scheduled",
      next_election: "2027-05-06",
      next_election_label: "May 2027",
      cycle: "Whole council every 5 years.",
    };
  }

  if (UNITARY_ALL_UP_2026.has(councilSlug)) {
    return {
      type: "unitary_authority",
      status: "scheduled",
      next_election: "2030-05-02",
      next_election_label: "May 2030",
      cycle: "Whole council every 4 years.",
    };
  }

  if (UNITARY_THIRDS.has(councilSlug)) {
    return {
      type: "unitary_authority",
      status: "scheduled",
      next_election: "2027-05-06",
      next_election_label: "May 2027",
      cycle: "By thirds, three years in four.",
    };
  }

  // Any remaining May-7 council without a recognised category — flag for
  // manual review. Defaults to TBC so we never publish a misleading date.
  return {
    type: "unclassified",
    status: "tbc",
    next_election: null,
    next_election_label: "TBC",
    cycle: isAllUp
      ? "Whole council; cycle to be confirmed."
      : "Partial council; cycle to be confirmed.",
    note: "Council type not yet classified in council-cycles.json — verify against LGBCE register and update build-council-cycles.mjs.",
  };
}

const out = {
  metadata: {
    generated_at: new Date().toISOString(),
    universe: "councils contesting the 2026-05-07 ballot",
    cohort_size: control.councils.length,
    source_notes: [
      "Source: English Devolution White Paper (Dec 2024) for LGR-pending list.",
      "Source: Local Government Boundary Commission for England — current cycle pattern by council.",
      "Welsh principal areas: Local Government and Elections (Wales) Act 2021, s. 7 — 5-year cycle.",
      "All dates assume the first Thursday in May per established convention; subject to Statutory Instruments.",
    ],
    review: "Hand-audit before quoting publicly. LGR timetable is moving; flip lgr_pending → scheduled as each SI lands.",
  },
  councils: {},
};

for (const c of control.councils.sort((a, b) => a.council_slug.localeCompare(b.council_slug))) {
  out.councils[c.council_slug] = {
    council_slug: c.council_slug,
    council_name: c.council_name,
    last_election: "2026-05-07",
    ...classify(c.council_slug, c),
  };
}

mkdirSync(path.join(ROOT, "data/identity"), { recursive: true });
writeFileSync(
  path.join(ROOT, "data/identity/council-cycles.json"),
  JSON.stringify(out, null, 2)
);

// Summary
const byStatus = {};
for (const [, row] of Object.entries(out.councils)) {
  byStatus[row.status] = (byStatus[row.status] || 0) + 1;
}
console.log(`Wrote data/identity/council-cycles.json (${Object.keys(out.councils).length} councils).`);
console.log("Status breakdown:", byStatus);

const unclassified = Object.values(out.councils).filter((c) => c.type === "unclassified");
if (unclassified.length) {
  console.warn(`\n⚠ ${unclassified.length} unclassified councils (need a category in build-council-cycles.mjs):`);
  for (const c of unclassified) console.warn(`  - ${c.council_slug} (${c.council_name})`);
}
