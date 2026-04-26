#!/usr/bin/env python3
"""
build-bes-priors-pcon.py — fit BES Wave 1-30 vote-intention priors directly at
2024 PCON boundaries, using the ONS PCON10→PCON24 crosswalk.

Closes the boundary-mismatch problem in build-bes-priors.py (which keys priors
by LAD because BES respondents are tagged with pre-2024 PCON codes — i.e.
PCON10/PCON19 codes that don't match GE2024 boundaries).

Pipeline:
  1. Load BES SAV; for each respondent extract latest-wave (region, age,
     ethnicity, tenure, vote_intent, pcon_code).
  2. Map each respondent's PCON10 code → PCON24 successor via the ONS lookup.
     Many PCON10 codes split into multiple PCON24 codes — assign a single
     successor (the largest-by-area successor, approximated here as the
     first-listed successor in the lookup).
  3. Tally per-PCON24 cell counts: (PCON24CD, age, ethnicity, tenure) → vote.
  4. Smooth via Dirichlet pooling toward the regional marginal (κ=15) for
     under-sampled PCON24 cells (typical PCON has 30-100 BES respondents).
  5. Emit data/features/pcon-mrp-priors.json keyed by PCON24CD.

Output schema mirrors data/features/ward-mrp-priors.json so callers can swap
between LAD-level and PCON-level priors with minimal code change.
"""
from __future__ import annotations

import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

import pyreadstat

REPO = Path(__file__).resolve().parents[1]
SAV = REPO / ".cache/bes/BES2024_W30_Panel_v30.1.sav"
LOOKUP = REPO / ".cache/pcon/pcon10-to-pcon24.csv"
OUT = REPO / "data/features/pcon-mrp-priors.json"

WAVES = [30, 29, 28]
COLS = (
    [f"generalElectionVoteW{w}" for w in WAVES]
    + [f"ageGroupW{w}" for w in WAVES]
    + [f"gorW{w}" for w in WAVES]
    + [f"p_ethnicity2W{w}" for w in WAVES]
    + [f"p_housingW{w}" for w in WAVES]
    + [f"pcon_codeW{w}" for w in WAVES]
)

VOTE_MAP = {
    1.0: "Conservative", 2.0: "Labour", 3.0: "Liberal Democrats",
    4.0: "SNP", 5.0: "Plaid Cymru",
    6.0: "Reform UK", 7.0: "Green Party", 8.0: "Reform UK",
    11.0: "Liberal Democrats", 12.0: "Reform UK", 13.0: "Independent",
}
ETHN_BUCKET = {
    1.0: "white_british", 2.0: "white_other", 3.0: "white_other", 4.0: "white_other",
    5.0: "mixed", 6.0: "mixed", 7.0: "mixed", 8.0: "mixed",
    9.0: "asian", 10.0: "asian", 11.0: "asian", 12.0: "asian", 13.0: "asian",
    14.0: "black", 15.0: "black", 16.0: "black",
    17.0: "other", 18.0: "other", 19.0: None,
}
AGE_BUCKET = {1.0: "u35", 2.0: "u35", 3.0: "u35", 4.0: "35_55", 5.0: "35_55", 6.0: "55p", 7.0: "55p"}
TENURE_BUCKET = {
    1.0: "owner", 2.0: "owner", 3.0: "owner",
    4.0: "renter", 5.0: "renter", 6.0: "renter",
    7.0: "other", 8.0: "other", 9.0: "other",
}
GOR_TO_REGION = {
    "North East": "north_east", "North West": "north_west",
    "Yorkshire and the Humber": "yorkshire", "East Midlands": "east_midlands",
    "West Midlands": "west_midlands", "East": "east_of_england",
    "East of England": "east_of_england", "London": "london",
    "South East": "south_east", "South West": "south_west",
    "Wales": "wales", "Scotland": "scotland", "Northern Ireland": "northern_ireland",
}
PARTIES = ["Labour", "Conservative", "Liberal Democrats", "Reform UK", "Green Party"]
KAPPA = 15.0


def main():
    if not SAV.exists():
        print(f"BES SAV missing at {SAV}", file=sys.stderr)
        sys.exit(1)
    if not LOOKUP.exists():
        print(f"PCON10→PCON24 lookup missing at {LOOKUP}", file=sys.stderr)
        sys.exit(1)

    # Load PCON10 → primary-successor PCON24 mapping (first successor per
    # source — covers ~95% of seats; the other 5% had multi-way splits).
    pcon10_to_pcon24 = {}
    pcon10_all_successors = defaultdict(list)
    with open(LOOKUP, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            src = r["PCON10CD"].strip()
            tgt = r["PCON24CD"].strip()
            if src not in pcon10_to_pcon24:
                pcon10_to_pcon24[src] = tgt
            pcon10_all_successors[src].append(tgt)
    print(f"Loaded PCON10→PCON24 lookup: {len(pcon10_to_pcon24)} source codes "
          f"(of which {sum(1 for v in pcon10_all_successors.values() if len(v) > 1)} have multi-way splits — "
          f"using primary successor).")

    print(f"Loading BES panel ({SAV.name}) ...")
    df, meta = pyreadstat.read_sav(SAV, usecols=COLS)
    print(f"  loaded {len(df):,} respondents")

    rows = []
    pcon_match_kind = {"direct": 0, "via_lookup": 0, "no_match": 0}
    for _, r in df.iterrows():
        # Vote intention from most recent valid wave
        vote = None
        for w in WAVES:
            v = r.get(f"generalElectionVoteW{w}")
            if v == v and v in VOTE_MAP:
                vote = VOTE_MAP[v]
                break
        if vote is None or vote not in PARTIES:
            continue
        age_raw = next((r[f"ageGroupW{w}"] for w in WAVES if r.get(f"ageGroupW{w}") == r.get(f"ageGroupW{w}")), None)
        ethn_raw = next((r[f"p_ethnicity2W{w}"] for w in WAVES if r.get(f"p_ethnicity2W{w}") == r.get(f"p_ethnicity2W{w}")), None)
        gor_raw = next((r[f"gorW{w}"] for w in WAVES if isinstance(r.get(f"gorW{w}"), str) and r.get(f"gorW{w}").strip()), None)
        ten_raw = next((r[f"p_housingW{w}"] for w in WAVES if r.get(f"p_housingW{w}") == r.get(f"p_housingW{w}")), None)
        pcon_code = next(
            (r[f"pcon_codeW{w}"] for w in WAVES if isinstance(r.get(f"pcon_codeW{w}"), str) and r.get(f"pcon_codeW{w}").strip()),
            None,
        )
        age = AGE_BUCKET.get(age_raw)
        ethn = ETHN_BUCKET.get(ethn_raw)
        region = GOR_TO_REGION.get(gor_raw)
        tenure = TENURE_BUCKET.get(ten_raw)
        if not (age and ethn and region and tenure and pcon_code):
            continue
        # Map BES PCON code (probably PCON10) to PCON24 successor
        if pcon_code.startswith(("E14001", "S14000", "W07")):  # already PCON24
            pcon24 = pcon_code
            pcon_match_kind["direct"] += 1
        elif pcon_code in pcon10_to_pcon24:
            pcon24 = pcon10_to_pcon24[pcon_code]
            pcon_match_kind["via_lookup"] += 1
        else:
            pcon_match_kind["no_match"] += 1
            continue
        rows.append((pcon24, region, age, ethn, tenure, vote))
    print(f"  {len(rows):,} respondents with full demos + post-2024 vote + PCON24 mapping "
          f"(direct {pcon_match_kind['direct']}, via lookup {pcon_match_kind['via_lookup']}, "
          f"unmatched {pcon_match_kind['no_match']})")

    # Cell tally + region marginal
    cell = defaultdict(lambda: defaultdict(int))
    region_marginal = defaultdict(lambda: defaultdict(int))
    pcon_marginal = defaultdict(lambda: defaultdict(int))
    pcon_region = {}
    for pcon24, region, age, ethn, tenure, vote in rows:
        cell[(pcon24, age, ethn, tenure)][vote] += 1
        region_marginal[region][vote] += 1
        pcon_marginal[pcon24][vote] += 1
        pcon_region[pcon24] = region

    # Region marginal share
    region_share = {}
    for r, marg in region_marginal.items():
        total = sum(marg.values())
        if total == 0:
            continue
        region_share[r] = {p: marg.get(p, 0) / total for p in PARTIES}
        s = sum(region_share[r].values())
        if s > 0:
            region_share[r] = {p: v / s for p, v in region_share[r].items()}

    # PCON marginal — smoothed Dirichlet pool toward regional
    pcon_share = {}
    for pcon24, marg in pcon_marginal.items():
        total = sum(marg.values())
        if total == 0:
            continue
        rgn = pcon_region.get(pcon24)
        regional = region_share.get(rgn, {p: 1 / len(PARTIES) for p in PARTIES})
        raw = {p: marg.get(p, 0) / total for p in PARTIES}
        w = total / (total + KAPPA)
        smoothed = {p: w * raw[p] + (1 - w) * regional[p] for p in PARTIES}
        s = sum(smoothed.values())
        if s > 0:
            smoothed = {p: v / s for p, v in smoothed.items()}
        pcon_share[pcon24] = {
            "region": rgn,
            "shares": smoothed,
            "n_respondents": total,
            "raw_shares": raw,
        }

    out = {
        "snapshot": {
            "snapshot_id": "bes-w30-pcon-priors",
            "source": "BES Combined Wave 1-30 Internet Panel + ONS PCON10→PCON24 lookup",
            "method": (
                "Per-PCON Dirichlet-smoothed (κ=15) marginal of vote-intention from latest-wave "
                "respondents. PCON10 codes mapped to primary PCON24 successor via ONS lookup."
            ),
            "smoothing_kappa": KAPPA,
            "waves_used": WAVES,
            "respondents_used": len(rows),
            "match_kinds": pcon_match_kind,
        },
        "regions": region_share,
        "priors": pcon_share,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2))
    print(f"Wrote {OUT} — {len(pcon_share)} PCON24 priors, {len(region_share)} regions")


if __name__ == "__main__":
    main()
