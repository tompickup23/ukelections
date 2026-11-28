"""Party level diagnosis of arm C2 (LEVEL_DIAGNOSIS.md). No new fit.

Reads the corrected rebuild's cached forward only forecasts (REBUILD_RESULTS.md,
"Both" column) and asks, per lane, whether C2's first place shortfall is a share
level error, a compression of the lead between first and second, or a product of
renormalising over six lanes.

  uv run python level_diagnose.py

Input: cache/rebuild/corrected/bridge_level_predictions.pkl (written by
rebuild_fit_score.py --polls corrected), cache/rebuild/corrected/fit_meta.pkl,
results/seats_actual_wards.csv (seats_build.py).
Output: results/level_diagnosis.json

The "oracle" rows below use the actual results of the set they are scored on.
They are not forecasts and nothing is chosen from them; they measure how much
of the shortfall a perfectly known level, or a perfectly known level and
spread, would remove.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from common import CACHE, LANES, LANE_KEY, OUT, expit, logit

SRC = CACHE / "rebuild" / "corrected"
SCHEDULED = ["2019-05-02", "2021-05-06", "2022-05-05", "2023-05-04", "2025-05-01", "2026-05-07"]
KEYS = [LANE_KEY[p] for p in LANES]
NAME = dict(zip(KEYS, LANES))


def half(d: str) -> str:
    return f"{d[:4]}H{1 if int(d[5:7]) <= 6 else 2}"


def leaders(mat: np.ndarray) -> np.ndarray:
    """Index of the top lane per row; rows with nothing forecast give -1."""
    m = np.where(np.isnan(mat), -np.inf, mat)
    out = np.argmax(m, axis=1)
    out[~np.isfinite(m).any(axis=1)] = -1
    return out


def renorm(mat: np.ndarray) -> np.ndarray:
    t = np.nansum(mat, axis=1, keepdims=True)
    return mat / np.where(t > 0, t, 1.0)


def describe(sub: pd.DataFrame) -> dict:
    """All diagnostics for one set of forecast rows."""
    n = len(sub)
    F = sub[[f"c2_{k}" for k in KEYS]].to_numpy(dtype=float)  # renormalised forecast, NaN where not standing
    S = sub[[f"s_{k}" for k in KEYS]].to_numpy(dtype=float)
    A = sub[[f"a_{k}" for k in KEYS]].to_numpy(dtype=float)
    O = sub[[f"off_c2_{k}" for k in KEYS]].to_numpy(dtype=float)
    ST = sub[[f"stood_{k}" for k in KEYS]].to_numpy(dtype=bool)
    F = np.where(ST, F, np.nan)
    RAW = np.where(ST, expit(logit(A) + O), np.nan)  # before renormalising
    act_lead = np.argmax(S, axis=1)
    f_lead = leaders(F)
    raw_lead = leaders(RAW)
    hp = sub["has_prev"].fillna(False).to_numpy(dtype=bool)
    tot = np.nansum(RAW, axis=1)

    # target y and the pre-renormalisation logit residual (forecast minus actual)
    Y = logit(S) - logit(A)
    E_raw = np.where(ST, O - Y, np.nan)
    E_post = np.where(ST, logit(np.where(ST, F, 0.5)) - logit(S), np.nan)

    res = {
        "rows": n,
        "leaders_called": int((f_lead == act_lead).sum()),
        "leaders_called_from_raw_unrenormalised": int((raw_lead == act_lead).sum()),
        "rows_where_raw_and_renormalised_leader_differ": int((raw_lead != f_lead).sum()),
        "raw_share_total": {"mean": round(float(np.mean(tot)), 4), "p10": round(float(np.quantile(tot, 0.1)), 4),
                            "p90": round(float(np.quantile(tot, 0.9)), 4)},
        "lanes": {},
    }
    for j, k in enumerate(KEYS):
        st = ST[:, j]
        won = act_lead == j
        called = f_lead == j
        d = {
            "stood": int(st.sum()),
            "won": int(won.sum()),
            "called_first": int(called.sum()),
            "called_first_and_won": int((won & called).sum()),
        }
        if st.sum():
            f, s = F[st, j], S[st, j]
            d["share_signed_error_pp"] = round(100 * float(np.mean(f - s)), 2)
            d["share_signed_error_raw_pp"] = round(100 * float(np.mean(RAW[st, j] - s)), 2)
            d["logit_signed_error_raw"] = round(float(np.mean(E_raw[st, j])), 3)
            d["logit_signed_error_renormalised"] = round(float(np.mean(E_post[st, j])), 3)
            d["mean_forecast_share_pp"] = round(100 * float(np.mean(f)), 2)
            d["mean_actual_share_pp"] = round(100 * float(np.mean(s)), 2)
            d["sd_forecast_share_pp"] = round(100 * float(np.std(f)), 2)
            d["sd_actual_share_pp"] = round(100 * float(np.std(s)), 2)
            if st.sum() > 10 and np.std(f) > 0:
                # calibration slope: actual share on forecast share across wards where it stood.
                # Above 1 means the forecasts are more bunched than the outcomes they predict.
                d["calibration_slope_share"] = round(float(np.polyfit(f, s, 1)[0]), 3)
                lf, ls = logit(f), logit(s)
                d["calibration_slope_logit"] = round(float(np.polyfit(lf, ls, 1)[0]), 3)
            for tag, m in (("with_previous", st & hp), ("no_previous", st & ~hp)):
                d[tag] = {"stood": int(m.sum()), "won": int((won & (hp if tag == "with_previous" else ~hp)).sum()),
                          "called_first": int((called & (hp if tag == "with_previous" else ~hp)).sum()),
                          "share_signed_error_pp": round(100 * float(np.mean(F[m, j] - S[m, j])), 2) if m.sum() else None}
        # lead test: wards the lane won. Forecast lead over the best other lane, against the actual lead.
        if won.sum():
            Fo = F[won].copy()
            Fo[:, j] = np.nan
            So = S[won].copy()
            So[:, j] = -1
            f_gap = F[won, j] - np.nanmax(np.where(np.isnan(Fo), -np.inf, Fo), axis=1)
            a_gap = S[won, j] - So.max(axis=1)
            fin = np.isfinite(f_gap)  # a ward where no other lane has a forecast has no forecast lead
            f_gap, a_gap = f_gap[fin], a_gap[fin]
            d["wards_won"] = {
                "mean_forecast_lead_pp": round(100 * float(np.mean(f_gap)), 2),
                "mean_actual_lead_pp": round(100 * float(np.mean(a_gap)), 2),
                "wards_with_a_rival_forecast": int(fin.sum()),
                "mean_forecast_share_pp": round(100 * float(np.mean(F[won, j])), 2),
                "mean_actual_share_pp": round(100 * float(np.mean(S[won, j])), 2),
                "forecast_lead_negative": int((f_gap < 0).sum()),
            }
            # how the missed ones were lost: forecast share error of this lane, and of the lane called instead
            miss = won & ~called
            if miss.sum():
                rows = np.flatnonzero(miss)
                other = f_lead[rows]
                d["wards_won_not_called"] = {
                    "wards": int(miss.sum()),
                    "this_lane_share_error_pp": round(100 * float(np.mean(F[rows, j] - S[rows, j])), 2),
                    "called_lane_share_error_pp": round(100 * float(np.mean(F[rows, other] - S[rows, other]))
                                                        if (other >= 0).all() else np.nan, 2),
                    "called_instead": {NAME[KEYS[o]]: int((other == o).sum()) for o in sorted(set(other)) if o >= 0},
                }
        res["lanes"][NAME[k]] = d

    # ---- oracles (use this set's actuals; diagnostic only)
    def oracle(adj):
        G = np.where(ST, expit(adj), np.nan)
        G = renorm(np.nan_to_num(G))
        G = np.where(ST, G, np.nan)
        lead = leaders(G)
        return {"leaders_called": int((lead == act_lead).sum()),
                "called_first": {NAME[k]: int((lead == j).sum()) for j, k in enumerate(KEYS)}}

    base = logit(A) + O
    lvl = np.array([np.nanmean(E_raw[:, j]) if ST[:, j].any() else 0.0 for j in range(len(KEYS))])
    res["oracle_level"] = oracle(base - lvl[None, :])
    res["oracle_level"]["shift_logit"] = {NAME[k]: round(float(lvl[j]), 3) for j, k in enumerate(KEYS)}
    # level and spread: per lane least squares of actual logit on forecast logit
    adj = base.copy()
    for j in range(len(KEYS)):
        st = ST[:, j]
        if st.sum() > 10:
            b, a0 = np.polyfit(base[st, j], logit(S[st, j]), 1)
            adj[:, j] = a0 + b * base[:, j]
    res["oracle_level_and_spread"] = oracle(adj)
    # within-ward spread only: stretch each ward's logits about the ward mean by one factor, chosen on this set
    best = None
    for lam in np.arange(0.5, 2.51, 0.05):
        m = np.nanmean(np.where(ST, base, np.nan), axis=1, keepdims=True)
        r = oracle(m + lam * (base - m))
        # ties go to the factor nearest 1 (no stretch)
        if best is None or r["leaders_called"] > best[1]["leaders_called"] or (
                r["leaders_called"] == best[1]["leaders_called"] and abs(lam - 1) < abs(best[0] - 1)):
            best = (round(float(lam), 2), r)
    res["oracle_within_ward_stretch"] = {"lambda": best[0], **best[1]}
    # level oracle per year is computed per set; leader count with each lane's level fixed alone
    res["oracle_level_one_lane"] = {}
    for j, k in enumerate(KEYS):
        one = np.zeros(len(KEYS))
        one[j] = lvl[j]
        res["oracle_level_one_lane"][NAME[k]] = oracle(base - one[None, :])["leaders_called"]
    return res


def main():
    # This folder's own cache (research output written by rebuild_fit_score.py), not untrusted data.
    df = pd.read_pickle(SRC / "bridge_level_predictions.pkl").reset_index(drop=True)
    df["is_by"] = df["is_by"].astype(bool)
    ok = df["unforecastable"].isna() & df[[f"c2_{k}" for k in KEYS]].notna().any(axis=1)
    out = {"source": str((SRC / "bridge_level_predictions.pkl").relative_to(CACHE.parent)), "sets": {}, "unforecastable": {}}

    sets = {}
    for d in SCHEDULED:
        sets[f"may_{d[:4]}"] = (~df.is_by) & (df.date == d)
    by = df.is_by
    for h in sorted(set(df.loc[by, "date"].map(half))):
        sets[f"by_{h}"] = by & (df.date.map(half) == h)
    sets["by_after_2026-05-07"] = by & (df.date > "2026-05-07")
    sets["by_all"] = by
    sets["may_pooled_six"] = (~df.is_by) & df.date.isin(SCHEDULED)

    for name, m in sets.items():
        out["unforecastable"][name] = {"rows": int(m.sum()), "forecast": int((m & ok).sum())}
        out["sets"][name] = describe(df[m & ok])

    # ---- persistence: is a lane's logit level at May T foreshadowed by what was known before T?
    # (i) C2's level at the previous test May (its own forward forecast, made without that May)
    # (ii) C2's forward by-election residuals between the previous first Thursday of May and T,
    #      the C1/C3 window of BRIDGE_LEVEL_SPEC.md, unweighted, before any shrinkage.
    from bridge_level_fit import PREVIOUS_MAY
    pers = {}
    for i, T in enumerate(SCHEDULED):
        y = T[:4]
        pers[y] = {}
        lv_T = out["sets"][f"may_{y}"]["oracle_level"]["shift_logit"]
        prev = out["sets"][f"may_{SCHEDULED[i-1][:4]}"]["oracle_level"]["shift_logit"] if i else None
        w = df[by & ok & (df.date > PREVIOUS_MAY[T]) & (df.date < T)]
        for k in KEYS:
            st = w[f"stood_{k}"].astype(bool)
            e = (w.loc[st, f"off_c2_{k}"] - (logit(w.loc[st, f"s_{k}"]) - logit(w.loc[st, f"a_{k}"]))).to_numpy()
            pers[y][NAME[k]] = {"may_level": lv_T[NAME[k]],
                                "previous_test_may_level": None if prev is None else prev[NAME[k]],
                                "byelections_in_window": int(len(e)),
                                "byelection_window_level": round(float(np.mean(e)), 3) if len(e) else None}

    def agree(key):
        same = opp = 0
        for y in pers:
            for p in LANES:
                a, b = pers[y][p]["may_level"], pers[y][p][key]
                if b is None or a == 0 or b == 0 or (key == "byelection_window_level" and pers[y][p]["byelections_in_window"] < 10):
                    continue
                if a * b > 0:
                    same += 1
                else:
                    opp += 1
        return {"same_sign": same, "opposite_sign": opp}
    out["persistence"] = {"cells": pers, "previous_may_agreement": agree("previous_test_may_level"),
                          "byelection_window_agreement_min10": agree("byelection_window_level")}

    # ---- M0 seat totals for C2 (SEATS_SPEC.md method M0) over the scored set
    seats = pd.read_csv(OUT / "seats_actual_wards.csv").set_index("ballot_paper_id")
    f = df[~df.is_by & ok].set_index("ballot_paper_id")
    seats = seats[seats.index.isin(f.index)]
    F = f.loc[seats.index, [f"c2_{k}" for k in KEYS]].to_numpy(dtype=float)
    lead = leaders(F)
    m0 = {}
    for d in SCHEDULED:
        sel = (seats["date"] == d).to_numpy()
        up = seats["seats_up"].to_numpy()[sel]
        fc = {NAME[k]: int(up[lead[sel] == j].sum()) for j, k in enumerate(KEYS)}
        ac = {NAME[k]: int(seats[f"won_{k}"].to_numpy()[sel].sum()) for k in KEYS}
        five = [p for p in LANES if p != "Others"]
        rmse5 = float(np.sqrt(np.mean([(fc[p] - ac[p]) ** 2 for p in five])))
        m0[d[:4]] = {"wards": int(sel.sum()), "seats": int(up.sum()), "forecast": fc, "actual": ac,
                     "rmse_five": round(rmse5, 1)}
    m0["mean_rmse_five"] = round(float(np.mean([m0[d[:4]]["rmse_five"] for d in SCHEDULED])), 1)
    out["seats_m0_c2"] = m0

    OUT.mkdir(exist_ok=True)
    with open(OUT / "level_diagnosis.json", "w") as fh:
        json.dump(out, fh, indent=1)
        fh.write("\n")

    for name, r in out["sets"].items():
        print(f"{name}: rows {r['rows']} leaders {r['leaders_called']} raw {r['leaders_called_from_raw_unrenormalised']} "
              f"differ {r['rows_where_raw_and_renormalised_leader_differ']} rawtot {r['raw_share_total']['mean']} | "
              f"oracle level {r['oracle_level']['leaders_called']} level+spread {r['oracle_level_and_spread']['leaders_called']} "
              f"stretch {r['oracle_within_ward_stretch']['leaders_called']} (lam {r['oracle_within_ward_stretch']['lambda']})")
        for p, d in r["lanes"].items():
            if not d["stood"]:
                continue
            ww = d.get("wards_won", {})
            print(f"   {p[:4]:4s} stood {d['stood']:5d} won {d['won']:5d} called {d['called_first']:5d} "
                  f"err {d.get('share_signed_error_pp')} raw {d.get('share_signed_error_raw_pp')} lgt {d.get('logit_signed_error_raw')} "
                  f"slope {d.get('calibration_slope_share')} sdF {d.get('sd_forecast_share_pp')} sdA {d.get('sd_actual_share_pp')} "
                  f"lead F {ww.get('mean_forecast_lead_pp')} A {ww.get('mean_actual_lead_pp')} | "
                  f"prev {d['with_previous']['won']}/{d['with_previous']['called_first']} err {d['with_previous']['share_signed_error_pp']} "
                  f"noprev {d['no_previous']['won']}/{d['no_previous']['called_first']} err {d['no_previous']['share_signed_error_pp']} "
                  f"| oracleL {r['oracle_level']['called_first'][p]}")
    print("seats M0 C2", json.dumps(m0))
    print("persistence", json.dumps({k: v for k, v in out["persistence"].items() if k != "cells"}))
    for y, c in out["persistence"]["cells"].items():
        print(" ", y, {p[:3]: (v["may_level"], v["previous_test_may_level"], v["byelections_in_window"], v["byelection_window_level"]) for p, v in c.items()})


if __name__ == "__main__":
    main()
