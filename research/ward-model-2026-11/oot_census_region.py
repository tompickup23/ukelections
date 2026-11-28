"""Ward Census correction (A) and regional level proxy (B), out of time
(OOT_CENSUS_REGION_SPEC.md). Arms C2, C2+A, C2+B, C2+A+B on two test sets:
the 107 council by-elections after 7 May 2026 (fitted on May 2026) and the
2,576 scheduled May 2026 wards (fitted on May 2025). One run.

  uv run python oot_census_region.py

Inputs (read only, this folder's own cache, checked by hash):
  cache/rebuild/corrected/bridge_level_predictions.pkl   C2 forward only forecasts (PR 211)
  cache/fit_meta.pkl                                     lane residual spread for the common mapping
  cache/seats_actual_wards.csv                           `git show origin/main:research/ward-model-2026-11/results/seats_actual_wards.csv` (PR 203)
Output: results/oot_census_region_summary.json
"""
from __future__ import annotations

import json
import time

import numpy as np
import pandas as pd

from common import CACHE, LANES, LANE_KEY, MAJOR, OUT, expit, logit, sha256
from score import Mapper, score_arm, top

PRED = CACHE / "rebuild" / "corrected" / "bridge_level_predictions.pkl"
PRED_SHA = "bb7586ce43bded0159aa7dca8af41fbf1532a26ac7ae3a5337c363d6d8e25d8a"
META_SHA = "936d07ee4d9004d1cdd811796f60dbfb1b22a723e7575789b56292c287ac67ad"
SEATS = CACHE / "seats_actual_wards.csv"
KEYS = [LANE_KEY[p] for p in LANES]
MAJ = [LANE_KEY[p] for p in MAJOR]
SCHEDULED = ["2019-05-02", "2021-05-06", "2022-05-05", "2023-05-04", "2025-05-01", "2026-05-07"]
CENSUS = ["d_white_british_pct", "d_asian_pct", "d_black_pct", "d_muslim_pct", "d_degree_pct", "d_no_quals_pct",
          "d_retired_pct", "d_ft_students_pct", "d_owned_outright_pct", "d_social_rented_pct",
          "d_private_rented_pct", "d_avg_imd_decile"]
LAMBDA = 1.0
SHRINK = 20.0
BOOT = 10_000
SEED = 20261128
ARMS = ["c2", "c2a", "c2b", "c2ab"]


def c2_shares(df):
    return df[[f"c2_{k}" for k in KEYS]].fillna(0.0).to_numpy()


def stood(df):
    return df[[f"stood_{k}" for k in KEYS]].to_numpy().astype(bool)


def actual(df):
    return df[[f"s_{k}" for k in KEYS]].fillna(0.0).to_numpy()


def renorm(m):
    t = m.sum(axis=1, keepdims=True)
    assert (t > 0).all()
    return m / t


def region_levels(fit):
    """D(r, k): regional deviation of C2's logit residual from the national mean, shrunk."""
    st = stood(fit)
    e = (np.asarray(logit(fit[[f"s_{k}" for k in KEYS]])) - np.asarray(logit(fit[[f"a_{k}" for k in KEYS]]))
         - fit[[f"off_c2_{k}" for k in KEYS]].to_numpy())
    reg = fit["region"].fillna("").to_numpy()
    out, detail = {}, {}
    for j, k in enumerate(KEYS):
        ok = st[:, j] & ~np.isnan(e[:, j])
        nat = float(e[ok, j].mean())
        for r in sorted(set(reg) - {""}):
            sel = ok & (reg == r)
            n = int(sel.sum())
            d = (float(e[sel, j].mean()) - nat) * n / (n + SHRINK) if n else 0.0
            out[(r, k)] = d
            detail.setdefault(r, {})[k] = {"wards": n, "deviation_logit": round(d, 4)}
    return out, detail


def apply_b(df, D):
    a = np.asarray(logit(df[[f"a_{k}" for k in KEYS]]))
    off = df[[f"off_c2_{k}" for k in KEYS]].to_numpy()
    reg = df["region"].fillna("").to_numpy()
    add = np.array([[D.get((r, k), 0.0) for k in KEYS] for r in reg])
    raw = np.where(stood(df) & ~np.isnan(off), expit(a + np.nan_to_num(off) + add), 0.0)
    return renorm(raw)


def design(df, means):
    c = df[CENSUS].astype(float).copy()
    c["d_avg_imd_decile"] = c["d_avg_imd_decile"] / 10.0
    c = c.fillna(means)
    sh = df[[f"c2_{k}" for k in MAJ]].fillna(0.0).to_numpy()
    lon = (df["region"] == "London").to_numpy().astype(float)[:, None]
    nop = (~df["has_prev"].astype(bool)).to_numpy().astype(float)[:, None]
    return np.hstack([np.ones((len(df), 1)), c.to_numpy(), sh, lon, nop])


def fit_a(fit):
    means = fit[CENSUS].astype(float).assign(d_avg_imd_decile=lambda x: x.d_avg_imd_decile / 10.0).mean()
    X = design(fit, means)
    Y = actual(fit) - c2_shares(fit)
    pen = LAMBDA * np.eye(X.shape[1])
    pen[0, 0] = 0.0
    beta = np.linalg.solve(X.T @ X + pen, X.T @ Y)
    return beta, means


def apply_a(df, base, beta, means):
    corr = design(df, means) @ beta
    m = np.where(stood(df), np.maximum(base + corr, 0.0), 0.0)
    return renorm(m)


def as_arm(ids, m):
    out = {}
    for i, row in zip(ids, m):
        sh = {p: float(row[j]) for j, p in enumerate(LANES) if row[j] > 0}
        out[i] = {"leader": top(sh), "shares": sh}
    return out


def row_stats(ids, arm, act):
    """Per row: leader correct, sum of absolute lane errors, count of lanes scored (score_arm's convention)."""
    c, s, n = [], [], []
    for i in ids:
        e = arm[i]
        c.append(e["leader"] == top(act[i]))
        errs = [abs(e["shares"].get(p, 0) - act[i].get(p, 0)) for p in LANES
                if not (e["shares"].get(p, 0) == 0 and act[i].get(p, 0) == 0)]
        s.append(sum(errs))
        n.append(len(errs))
    return np.array(c, float), np.array(s), np.array(n, float)


def paired(ids, groups, arm, base, act, rng):
    ca, sa, na = row_stats(ids, arm, act)
    cb, sb, nb = row_stats(ids, base, act)
    g = pd.factorize(np.asarray(groups))[0]
    G = g.max() + 1
    agg = lambda v: np.bincount(g, weights=v, minlength=G)
    dc, sa_, na_, sb_, nb_ = agg(ca - cb), agg(sa), agg(na), agg(sb), agg(nb)
    draws = rng.integers(0, G, size=(BOOT, G))
    d_lead = dc[draws].sum(axis=1)
    d_mae = 100 * (sa_[draws].sum(1) / na_[draws].sum(1) - sb_[draws].sum(1) / nb_[draws].sum(1))
    return {
        "leader_difference": int(round(dc.sum())),
        "leader_difference_ci95": [float(np.percentile(d_lead, 2.5)), float(np.percentile(d_lead, 97.5))],
        "gained": int(((ca == 1) & (cb == 0)).sum()),
        "lost": int(((ca == 0) & (cb == 1)).sum()),
        "share_mae_difference_pp": round(100 * (sa.sum() / na.sum() - sb.sum() / nb.sum()), 3),
        "share_mae_difference_ci95": [round(float(np.percentile(d_mae, 2.5)), 3), round(float(np.percentile(d_mae, 97.5)), 3)],
        "resampled_units": int(G),
    }


def seats_m0(ids, arm, seats):
    s = seats.set_index("ballot_paper_id")
    use = [i for i in ids if i in s.index]
    pred = {k: 0.0 for k in MAJ}
    won = {k: float(s.loc[use, f"won_{k}"].sum()) for k in MAJ}
    for i in use:
        k = LANE_KEY[arm[i]["leader"]]
        if k in pred:
            pred[k] += float(s.at[i, "seats_up"])
    err = {k: pred[k] - won[k] for k in MAJ}
    return {"wards": len(use), "predicted": pred, "won": won, "error": err,
            "rmse_five": round(float(np.sqrt(np.mean([v * v for v in err.values()]))), 1)}


def verdict(fwd, by, fwd_mae, by_mae):
    s1 = bool(fwd["leader_difference_ci95"][0] > 0)
    s2 = bool(by["leader_difference"] >= 0)
    s3 = bool(fwd_mae <= 0 and by_mae <= 0)
    if fwd["leader_difference"] <= 0 or by["leader_difference_ci95"][1] < 0 or (fwd_mae > 0 and by_mae > 0):
        v = "not supported"
    elif s1 and s2 and s3:
        v = "supported"
    else:
        v = "inconclusive"
    return {"verdict": v, "rule_1_forward_lower_bound_above_zero": s1, "rule_2_byelection_difference_zero_or_more": s2,
            "rule_3_share_error_no_higher_both": s3}


def main():
    t0 = time.time()
    assert sha256(PRED) == PRED_SHA, "predictions changed since the specification"
    assert sha256(CACHE / "fit_meta.pkl") == META_SHA
    df = pd.read_pickle(PRED).reset_index(drop=True)
    df["is_by"] = df["is_by"].astype(bool)
    fit_meta = pd.read_pickle(CACHE / "fit_meta.pkl")
    mapper = Mapper({p: fit_meta["lanes"][p]["oof_logit_resid_sd"] for p in LANES})
    has = df[[f"c2_{k}" for k in KEYS]].notna().any(axis=1)

    tests = {
        "byelections_after_may_2026": (df.is_by & (df.date > "2026-05-07"), "2026-05-07", "ballot_paper_id"),
        "may_2026_forward_check": (~df.is_by & (df.date == "2026-05-07"), "2025-05-01", "council"),
    }
    rng = np.random.default_rng(SEED)
    res = {"spec": "OOT_CENSUS_REGION_SPEC.md", "inputs": {"predictions_sha256": PRED_SHA, "fit_meta_sha256": META_SHA,
                                                           "seats_actual_sha256": sha256(SEATS)},
           "settings": {"lambda": LAMBDA, "shrink": SHRINK, "bootstrap": BOOT, "seed": SEED, "census_features": CENSUS},
           "sets": {}}
    seats = pd.read_csv(SEATS)
    for name, (sel, M, grp) in tests.items():
        tgt = df[sel.to_numpy()].copy()
        assert has[sel].all(), "a test row lacks a C2 forecast"
        fit = df[(~df.is_by & (df.date == M) & has).to_numpy()].copy()
        # Leakage guards: the fitting election precedes every target, and no target row is in the fit.
        assert fit.date.max() < tgt.date.min() and not set(fit.ballot_paper_id) & set(tgt.ballot_paper_id)
        assert max(d for d in SCHEDULED if d < tgt.date.min()) == M
        D, detail = region_levels(fit)
        beta, means = fit_a(fit)
        base = c2_shares(tgt)
        mB = apply_b(tgt, D)
        m = {"c2": renorm(np.where(stood(tgt), base, 0.0)), "c2a": apply_a(tgt, base, beta, means), "c2b": mB}
        corr = design(tgt, means) @ beta
        m["c2ab"] = renorm(np.where(stood(tgt), np.maximum(mB + corr, 0.0), 0.0))
        # The C2 arm must reproduce the rebuild's C2 shares exactly.
        assert np.allclose(m["c2"], base, atol=1e-9)
        ids = tgt.ballot_paper_id.tolist()
        act = {i: {p: float(v) for p, v in zip(LANES, row)} for i, row in zip(ids, actual(tgt))}
        lead = {i: top(act[i]) for i in ids}
        arms = {a: as_arm(ids, m[a]) for a in ARMS}
        scores = {a: score_arm(ids, arms[a], act, lead, mapper) for a in ARMS}
        out = {"rows": len(ids), "date_range": [tgt.date.min(), tgt.date.max()], "fitted_on": M,
               "fitting_wards": int(len(fit)), "arms": scores,
               "paired_vs_c2": {a: paired(ids, tgt[grp].to_numpy(), arms[a], arms["c2"], act, rng) for a in ARMS[1:]},
               "region_deviation": detail,
               "ridge_coefficients": {k: dict(zip(["intercept"] + CENSUS + [f"c2_share_{x}" for x in MAJ] + ["london", "no_previous"],
                                                  [round(float(b), 5) for b in beta[:, j]])) for j, k in enumerate(KEYS)}}
        if name == "may_2026_forward_check":
            out["seats_m0"] = {a: seats_m0(ids, arms[a], seats) for a in ARMS}
        res["sets"][name] = out
        print(f"{name}: {len(ids)} rows, fitted on {M} ({len(fit)} wards)")

    by, fw = res["sets"]["byelections_after_may_2026"], res["sets"]["may_2026_forward_check"]
    res["verdicts"] = {}
    for a, label in (("c2a", "A"), ("c2b", "B")):
        res["verdicts"][label] = verdict(fw["paired_vs_c2"][a], by["paired_vs_c2"][a],
                                         fw["paired_vs_c2"][a]["share_mae_difference_pp"],
                                         by["paired_vs_c2"][a]["share_mae_difference_pp"])
    OUT.mkdir(exist_ok=True)
    (OUT / "oot_census_region_summary.json").write_text(json.dumps(res, indent=1, default=str) + "\n")
    print(f"wrote results/oot_census_region_summary.json in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
