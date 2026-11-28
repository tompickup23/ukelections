"""The estate series check (ESTATE_SPEC.md): one run.

Do the ward model's (C2) misses by local authority district line up with
dated local series held on the sister sites? Descriptive; nothing is refitted.

  uv run python estate_check.py --dry   code check on random residuals (no result read)
  uv run python estate_check.py         the one run

Output: results/estate_summary.json (the one run only)
"""
from __future__ import annotations

import hashlib
import json
import sys

import numpy as np
import pandas as pd

from common import OUT
from estate_common import ELECTIONS, KEYS, MEASURES, SOURCES, ballot_weights, build_measures, place_rows, region_of_lad, scheduled_rows

MIN_WARDS = 5          # wards where the lane stood, per district and election
MIN_DISTRICTS = 10     # districts needed to run a correlation
PERMS = 10_000
FDR_Q = 0.10
CONFIRM_P = 0.05
LANE_NAME = {"ref": "Reform UK", "lab": "Labour", "con": "Conservative", "ld": "Liberal Democrats", "grn": "Green Party", "oth": "Others"}


def seed_for(*parts) -> int:
    return int(hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()[:8], 16)


def ranks(x: np.ndarray) -> np.ndarray:
    return pd.Series(x).rank(method="average").to_numpy()


def spearman_perm(x, y, seed):
    """Spearman's rho of x and y, two-sided permutation p (x shuffled)."""
    rx, ry = ranks(x), ranks(y)
    rx = (rx - rx.mean()) / rx.std()
    ry = (ry - ry.mean()) / ry.std()
    rho = float(np.mean(rx * ry))
    rng = np.random.default_rng(seed)
    perm = np.argsort(rng.random((PERMS, len(rx))), axis=1)
    null = (rx[perm] * ry).mean(axis=1)
    p = (1 + int(np.sum(np.abs(null) >= abs(rho) - 1e-12))) / (PERMS + 1)
    return rho, p


def fifths(x, y):
    r = ranks(x)
    n = len(x)
    lo, hi = y[r <= n / 5], y[r > 4 * n / 5]
    return float(lo.mean()), float(hi.mean()), float(hi.mean() - lo.mean()), int(len(lo)), int(len(hi))


def bh(pvals: dict, q: float) -> dict:
    """Benjamini and Hochberg step-up: key -> passes."""
    items = sorted(pvals.items(), key=lambda kv: kv[1])
    m = len(items)
    k_max = 0
    for k, (_, p) in enumerate(items, start=1):
        if p <= q * k / m:
            k_max = k
    return {key: (i < k_max) for i, (key, _) in enumerate(items)}


def district_residuals(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for (T, lad), g in df.groupby(["date", "lad"]):
        for k in KEYS:
            s = g[g[f"stood_{k}"].astype(bool)]
            s = s[s.w.notna() & (s.w > 0)]
            n = len(s)
            if n == 0:
                continue
            res = float(np.average(100 * (s[f"s_{k}"] - s[f"c2_{k}"]), weights=s.w)) if n else np.nan
            rows.append({"date": T, "lad": lad, "lane": k, "wards": n, "resid_pp": res})
    return pd.DataFrame(rows)


def main(dry: bool):
    df = scheduled_rows()
    df["lad"], df["rule"] = place_rows(df)
    w, how = ballot_weights(list(df.ballot_paper_id))
    df["w"] = df.ballot_paper_id.map(w)
    unplaced = df.lad.isna()
    no_weight = df.w.isna() | (df.w <= 0)
    if dry:
        rng = np.random.default_rng(1)
        for k in KEYS:
            df[f"s_{k}"] = df[f"c2_{k}"] + rng.normal(0, 0.05, len(df))
    dr = district_residuals(df[~unplaced])
    region = region_of_lad()
    dr["region"] = dr.lad.map(region)
    vals, prov = build_measures()

    left_out = {}
    for T in ELECTIONS:
        for k in KEYS:
            x = dr[(dr.date == T) & (dr.lane == k)]
            left_out[f"{T}|{k}"] = {"districts_with_lane": int(len(x)), "under_5_wards": int((x.wards < MIN_WARDS).sum())}
    dr = dr[dr.wards >= MIN_WARDS].copy()
    # Within-region residual: take out each region's mean (unweighted over districts) per election and lane.
    dr["resid_within_pp"] = dr.resid_pp - dr.groupby(["date", "lane", "region"]).resid_pp.transform("mean")

    tests = {}
    for m, label, fam in MEASURES:
        for T, role in ELECTIONS.items():
            v = vals[m][T]
            for k in KEYS:
                x = dr[(dr.date == T) & (dr.lane == k) & dr.lad.isin(v)]
                key = f"{m}|{k}|{T}"
                if len(x) < MIN_DISTRICTS:
                    tests[key] = {"measure": m, "lane": k, "election": T, "role": role, "districts": int(len(x)), "run": False}
                    continue
                mv = x.lad.map(v).to_numpy(float)
                y = x.resid_pp.to_numpy(float)
                yw = x.resid_within_pp.to_numpy(float)
                rho, p = spearman_perm(mv, y, seed_for(m, k, T))
                rho_w, p_w = spearman_perm(mv, yw, seed_for(m, k, T, "within"))
                lo, hi, diff, nlo, nhi = fifths(mv, y)
                tests[key] = {"measure": m, "lane": k, "election": T, "role": role, "districts": int(len(x)), "run": True,
                              "rho": round(rho, 4), "p": round(p, 5),
                              "bottom_fifth_mean_resid_pp": round(lo, 3), "top_fifth_mean_resid_pp": round(hi, 3),
                              "top_minus_bottom_pp": round(diff, 3), "fifth_sizes": [nlo, nhi],
                              "within_region_rho": round(rho_w, 4), "within_region_p": round(p_w, 5)}

    # Discovery family: tested-family measures, every lane, May 2026, tests that ran.
    fam_keys = {f"{m}|{k}": tests[f"{m}|{k}|2026-05-07"]["p"] for m, _, fam in MEASURES if fam == "tested" for k in KEYS
                if tests[f"{m}|{k}|2026-05-07"]["run"]}
    disc = bh(fam_keys, FDR_Q)
    verdicts = {}
    for m, label, fam in MEASURES:
        for k in KEYS:
            d = tests[f"{m}|{k}|2026-05-07"]
            c = tests[f"{m}|{k}|2025-05-01"]
            mk = f"{m}|{k}"
            if fam != "tested":
                verdict = "excluded: no value dated before May 2025 polling day, so it cannot be confirmed; discovery reported as description only"
                dpass = cpass = None
            elif not d["run"]:
                verdict, dpass, cpass = "not tested: too few districts in discovery", False, None
            else:
                dpass = bool(disc.get(mk, False))
                cpass = bool(c["run"] and dpass and np.sign(c["rho"]) == np.sign(d["rho"]) and c["p"] < CONFIRM_P) if dpass else None
                verdict = "lines up" if (dpass and cpass) else ("passed discovery, not confirmed" if dpass else "not supported")
            within = None
            if verdict == "lines up":
                same = lambda t: np.sign(t["within_region_rho"]) == np.sign(d["rho"]) and t["within_region_p"] < CONFIRM_P
                within = "holds within region" if (same(d) and same(c)) else "does not hold within region"
            verdicts[mk] = {"measure": m, "lane": k, "family": fam, "discovery_pass_bh": dpass, "confirmation_pass": cpass,
                            "verdict": verdict, "within_region": within}

    summary = {
        "spec": "ESTATE_SPEC.md", "dry_run": dry,
        "rules": {"min_wards": MIN_WARDS, "min_districts": MIN_DISTRICTS, "permutations": PERMS, "bh_q": FDR_Q,
                  "confirmation_p": CONFIRM_P, "discovery_family_size": len(fam_keys)},
        "rows": {"scheduled_rows": int(len(df)), "by_election": {T: int((df.date == T).sum()) for T in ELECTIONS},
                 "unplaced": {T: int((unplaced & (df.date == T)).sum()) for T in ELECTIONS},
                 "no_weight": {T: int((no_weight & (df.date == T)).sum()) for T in ELECTIONS},
                 "weight_source": how, "placement_rules": {T: df[df.date == T].rule.value_counts().to_dict() for T in ELECTIONS}},
        "districts_left_out_under_5_wards": left_out,
        "district_counts": {f"{T}|{k}": int(((dr.date == T) & (dr.lane == k)).sum()) for T in ELECTIONS for k in KEYS},
        "measures": {m: {"label": label, "family": fam, "source": SOURCES[m], "value_used": prov[m]} for m, label, fam in MEASURES},
        "verdicts": verdicts,
        "tests": tests,
    }
    if dry:
        n_pass = sum(v["verdict"] == "lines up" for v in verdicts.values())
        n_disc = sum(bool(v["discovery_pass_bh"]) for v in verdicts.values())
        print("DRY RUN on random residuals: family", len(fam_keys), "discovery passes", n_disc, "lines up", n_pass)
        print(json.dumps(summary["rows"], indent=1))
        print(json.dumps(summary["district_counts"]))
        return
    OUT.mkdir(exist_ok=True)
    (OUT / "estate_summary.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False) + "\n")
    print("family", len(fam_keys))
    for mk, v in verdicts.items():
        d = tests[f"{mk}|2026-05-07"]; c = tests[f"{mk}|2025-05-01"]
        print(f"{mk:28s} disc rho={d.get('rho')} p={d.get('p')} n={d['districts']} | conf rho={c.get('rho')} p={c.get('p')} n={c['districts']} | {v['verdict']} {v['within_region'] or ''}")


if __name__ == "__main__":
    main(dry="--dry" in sys.argv)
