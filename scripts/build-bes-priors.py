#!/usr/bin/env python3
"""
build-bes-priors.py — derive ward-level vote-intention priors from the BES
Combined Wave 1-30 panel (.sav) and the AI DOGE per-LAD demographic stack.

Pipeline:
  1. Load the most recent post-GE2024 wave for each respondent (W30 → W29 → W28).
  2. Bucket each respondent into (region, age_band, ethnicity_band, tenure_band).
  3. Compute per-bucket party-vote shares smoothed via Dirichlet-prior pooling
     toward the regional marginal (k=15 effective sample size).
  4. Post-stratify to each LAD using AI DOGE's la-ethnic-projections + IMD
     (proxy for tenure: low-IMD councils skew owner-occupier, high-IMD skew
     renter — coarse but workable until LAD tenure feeds land).
  5. Emit data/features/ward-mrp-priors.json keyed by LAD24CD with a five-party
     prior vector that downstream model code can mix into the baseline.

Caveat: this is a regional-cell post-stratification, not a full Bayesian MRP
(no random effects). It captures the dominant signal — Reform shares are much
higher in 56-65 / 66+ owner-occupier non-graduate White respondents in the
North East / East Midlands than the national average — and is a meaningful
prior beyond the 2024-anchored baseline.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

import pyreadstat

REPO = Path(__file__).resolve().parents[1]
SAV = REPO / ".cache/bes/BES2024_W30_Panel_v30.1.sav"
OUT_PRIORS = REPO / "data/features/ward-mrp-priors.json"
LA_ETHNIC = REPO / "data/features/la-ethnic-projections.json"
LA_IMD = REPO / "data/features/la-imd.json"

WAVES = [30, 29, 28]  # most recent first; W28 first opened post-GE2024
COLS = (
    [f"generalElectionVoteW{w}" for w in WAVES]
    + [f"ageGroupW{w}" for w in WAVES]
    + [f"gorW{w}" for w in WAVES]
    + [f"p_ethnicity2W{w}" for w in WAVES]
    + [f"p_housingW{w}" for w in WAVES]
    + [f"p_educationW{w}" for w in WAVES]
    + [f"oslauaW{w}" for w in WAVES]
    + [f"wave{w}" for w in WAVES]
)

# BES vote codes → canonical AI DOGE party labels.
VOTE_MAP = {
    1.0: "Conservative",
    2.0: "Labour",
    3.0: "Liberal Democrats",
    4.0: "SNP",
    5.0: "Plaid Cymru",
    6.0: "Reform UK",         # UKIP folds into Reform UK lineage
    7.0: "Green Party",
    8.0: "Reform UK",         # BNP voters now overwhelmingly Reform UK
    11.0: "Liberal Democrats", # Change UK rump → LD/None — small N
    12.0: "Reform UK",
    13.0: "Independent",
}

# Coarsen 19-category BES ethnicity into the 4 buckets the AI DOGE model uses.
ETHN_BUCKET = {
    1.0: "white_british",
    2.0: "white_other",
    3.0: "white_other",
    4.0: "white_other",
    5.0: "mixed",
    6.0: "mixed",
    7.0: "mixed",
    8.0: "mixed",
    9.0: "asian",
    10.0: "asian",
    11.0: "asian",
    12.0: "asian",
    13.0: "asian",
    14.0: "black",
    15.0: "black",
    16.0: "black",
    17.0: "other",
    18.0: "other",
    19.0: None,
}

AGE_BUCKET = {
    1.0: "u35",
    2.0: "u35",
    3.0: "u35",
    4.0: "35_55",
    5.0: "35_55",
    6.0: "55p",
    7.0: "55p",
}

TENURE_BUCKET = {
    1.0: "owner",
    2.0: "owner",
    3.0: "owner",
    4.0: "renter",
    5.0: "renter",
    6.0: "renter",
    7.0: "other",
    8.0: "other",
    9.0: "other",
}

# BES gor* fields are populated as the human-readable region name string.
GOR_TO_REGION = {
    "North East": "north_east",
    "North West": "north_west",
    "Yorkshire and the Humber": "yorkshire",
    "East Midlands": "east_midlands",
    "West Midlands": "west_midlands",
    "East": "east_of_england",
    "East of England": "east_of_england",
    "London": "london",
    "South East": "south_east",
    "South West": "south_west",
    "Wales": "wales",
    "Scotland": "scotland",
    "Northern Ireland": "northern_ireland",
}

PARTIES = ["Labour", "Conservative", "Liberal Democrats", "Reform UK", "Green Party"]


def latest_wave_value(row, col_template):
    for w in WAVES:
        v = row.get(f"{col_template}W{w}")
        if v is not None and v == v and v != 9999.0:
            return v
    return None


def main():
    if not SAV.exists():
        print(f"BES SAV missing at {SAV}", file=sys.stderr)
        sys.exit(1)

    print(f"Loading BES panel ({SAV.name}) — this takes ~30s ...")
    df, meta = pyreadstat.read_sav(SAV, usecols=COLS)
    print(f"  loaded {len(df):,} respondents")

    # Collapse each respondent to their most recent wave's values
    rows = []
    for _, r in df.iterrows():
        # Vote intention from most recent wave with a valid response
        vote_raw = None
        for w in WAVES:
            v = r.get(f"generalElectionVoteW{w}")
            if v == v and v in VOTE_MAP:
                vote_raw = VOTE_MAP[v]
                break
        if vote_raw is None:
            continue
        if vote_raw not in PARTIES:
            continue
        age_raw = next((r[f"ageGroupW{w}"] for w in WAVES if r.get(f"ageGroupW{w}") == r.get(f"ageGroupW{w}")), None)
        ethn_raw = next((r[f"p_ethnicity2W{w}"] for w in WAVES if r.get(f"p_ethnicity2W{w}") == r.get(f"p_ethnicity2W{w}")), None)
        gor_raw = next(
            (r[f"gorW{w}"] for w in WAVES if isinstance(r.get(f"gorW{w}"), str) and r.get(f"gorW{w}").strip()),
            None,
        )
        ten_raw = next((r[f"p_housingW{w}"] for w in WAVES if r.get(f"p_housingW{w}") == r.get(f"p_housingW{w}")), None)
        age = AGE_BUCKET.get(age_raw)
        ethn = ETHN_BUCKET.get(ethn_raw)
        region = GOR_TO_REGION.get(gor_raw)
        tenure = TENURE_BUCKET.get(ten_raw)
        if not (age and ethn and region and tenure):
            continue
        rows.append((region, age, ethn, tenure, vote_raw))

    print(f"  {len(rows):,} respondents with full demos + post-2024 vote intent")

    # Tally cell counts: (region, age, ethn, tenure) -> party -> count
    cell = defaultdict(lambda: defaultdict(int))
    region_marginal = defaultdict(lambda: defaultdict(int))
    for region, age, ethn, tenure, vote in rows:
        key = (region, age, ethn, tenure)
        cell[key][vote] += 1
        region_marginal[region][vote] += 1

    # Build a LAD24CD → region mapping by majority-vote across BES respondents.
    lad_to_region_count = defaultdict(lambda: defaultdict(int))
    for _, r in df.iterrows():
        gor_raw = next(
            (r[f"gorW{w}"] for w in WAVES if isinstance(r.get(f"gorW{w}"), str) and r.get(f"gorW{w}").strip()),
            None,
        )
        oslaua_raw = next(
            (r[f"oslauaW{w}"] for w in WAVES if r.get(f"oslauaW{w}") and isinstance(r.get(f"oslauaW{w}"), str)),
            None,
        )
        if not oslaua_raw:
            continue
        region = GOR_TO_REGION.get(gor_raw)
        if not region:
            continue
        lad_to_region_count[oslaua_raw][region] += 1
    lad_to_region = {
        lad: max(counts.items(), key=lambda kv: kv[1])[0]
        for lad, counts in lad_to_region_count.items()
    }
    print(f"  derived LAD→region mapping for {len(lad_to_region):,} LADs from BES")

    # Smooth via Dirichlet pooling toward the regional marginal (k=15).
    KAPPA = 15.0
    smoothed = {}
    for key, counts in cell.items():
        region = key[0]
        n = sum(counts.values())
        if n == 0:
            continue
        marg = region_marginal[region]
        marg_total = sum(marg.values())
        marg_share = {p: marg.get(p, 0) / marg_total for p in PARTIES} if marg_total > 0 else {p: 1 / len(PARTIES) for p in PARTIES}
        cell_share = {p: counts.get(p, 0) / n for p in PARTIES}
        w = n / (n + KAPPA)
        smoothed_share = {p: w * cell_share[p] + (1 - w) * marg_share[p] for p in PARTIES}
        # Re-normalise (may drift slightly due to non-PARTIES votes excluded)
        s = sum(smoothed_share.values())
        if s > 0:
            smoothed_share = {p: v / s for p, v in smoothed_share.items()}
        smoothed[key] = {"n": n, "raw": cell_share, "smoothed": smoothed_share}

    print(f"  populated {len(smoothed):,} (region, age, ethn, tenure) cells")

    # Region-level marginals (always populated — used as fallback)
    region_share = {}
    for region, marg in region_marginal.items():
        total = sum(marg.values())
        if total == 0:
            continue
        region_share[region] = {p: marg.get(p, 0) / total for p in PARTIES}
        s = sum(region_share[region].values())
        if s > 0:
            region_share[region] = {p: v / s for p, v in region_share[region].items()}

    # Post-stratification: for each LAD, blend the BES cells into a single
    # 5-party prior using the LAD's demographic composition. Tenure uses an
    # IMD-proxy: deciles 1-3 → 60% renter, 4-6 → 40% renter, 7-10 → 20% renter.
    print("Loading AI DOGE LA features for post-stratification ...")
    la_ethn = json.loads(LA_ETHNIC.read_text())
    la_imd = json.loads(LA_IMD.read_text())

    # LAD→region: BES-derived where available, otherwise drop.
    region_of_lad = dict(lad_to_region)

    def tenure_split(decile):
        if decile is None:
            return {"owner": 0.55, "renter": 0.4, "other": 0.05}
        d = float(decile)
        if d <= 3:
            return {"owner": 0.30, "renter": 0.65, "other": 0.05}
        if d <= 6:
            return {"owner": 0.55, "renter": 0.40, "other": 0.05}
        return {"owner": 0.75, "renter": 0.20, "other": 0.05}

    def age_split(white_british_pct):
        # Older voter share rises with W-B pct in England — coarse calibration.
        if white_british_pct is None:
            return {"u35": 0.35, "35_55": 0.32, "55p": 0.33}
        if white_british_pct >= 0.85:
            return {"u35": 0.25, "35_55": 0.30, "55p": 0.45}
        if white_british_pct >= 0.65:
            return {"u35": 0.32, "35_55": 0.32, "55p": 0.36}
        return {"u35": 0.42, "35_55": 0.34, "55p": 0.24}

    def ethn_split(payload):
        wb = payload.get("white_british_pct_projected", payload.get("white_british_pct", 0)) or 0
        asian = payload.get("asian_pct_projected", payload.get("asian_pct", 0)) or 0
        black = payload.get("black_pct_projected", payload.get("black_pct", 0)) or 0
        mixed = payload.get("mixed_pct_projected", payload.get("mixed_pct", 0)) or 0
        white_other = max(0.0, 1.0 - wb - asian - black - mixed)
        other = max(0.0, 1.0 - wb - white_other - asian - black - mixed)
        return {
            "white_british": wb,
            "white_other": white_other,
            "asian": asian,
            "black": black,
            "mixed": mixed,
            "other": other,
        }

    priors_by_lad = {}
    misses = 0
    for code, payload in la_ethn.get("projections", {}).items():
        region = region_of_lad.get(code)
        if not region or region not in region_share:
            misses += 1
            continue
        imd_payload = la_imd.get("imd", {}).get(code, {})
        ten_split = tenure_split(imd_payload.get("avg_decile"))
        age_split_v = age_split(payload.get("white_british_pct_projected", payload.get("white_british_pct")))
        ethn_split_v = ethn_split(payload)

        prior_acc = {p: 0.0 for p in PARTIES}
        weight_sum = 0.0
        for age_b, age_w in age_split_v.items():
            for ethn_b, ethn_w in ethn_split_v.items():
                if ethn_w <= 0:
                    continue
                for ten_b, ten_w in ten_split.items():
                    cell_w = age_w * ethn_w * ten_w
                    if cell_w <= 0:
                        continue
                    cell_payload = smoothed.get((region, age_b, ethn_b, ten_b))
                    if cell_payload is None:
                        # Fallback: regional marginal
                        share = region_share[region]
                    else:
                        share = cell_payload["smoothed"]
                    for p in PARTIES:
                        prior_acc[p] += cell_w * share.get(p, 0)
                    weight_sum += cell_w
        if weight_sum > 0:
            for p in PARTIES:
                prior_acc[p] /= weight_sum
            s = sum(prior_acc.values())
            if s > 0:
                prior_acc = {p: v / s for p, v in prior_acc.items()}
        priors_by_lad[code] = {
            "region": region,
            "shares": prior_acc,
            "n_respondents_in_region": sum(region_marginal[region].values()),
        }

    print(f"  generated priors for {len(priors_by_lad)} LADs ({misses} missed region mapping)")

    out = {
        "snapshot": {
            "snapshot_id": "bes-w30-priors",
            "source": "British Election Study Combined Wave 1-30 Internet Panel (BES2024_W30_Panel_v30.1.sav)",
            "method": "Dirichlet-smoothed (region, age, ethnicity, tenure) cells post-stratified to LAD demographics",
            "smoothing_kappa": KAPPA,
            "waves_used": WAVES,
            "respondents_used": len(rows),
        },
        "regions": region_share,
        "priors": priors_by_lad,
    }
    OUT_PRIORS.parent.mkdir(parents=True, exist_ok=True)
    OUT_PRIORS.write_text(json.dumps(out, indent=2))
    print(f"Wrote {OUT_PRIORS} — {len(priors_by_lad)} LAD priors, {len(region_share)} regions")


if __name__ == "__main__":
    main()
