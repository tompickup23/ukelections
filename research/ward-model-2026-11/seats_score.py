"""National seat totals from ward forecasts (SEATS_SPEC.md): methods M0 to M5,
on C0 and C2, leave one election out over six May elections, scored by the
root mean square error of national seat totals over five and six lanes.

Research only.

Inputs (read only):
  cache/bridge_level_predictions.pkl   C0 and C2 forecasts (this folder's own cache)
  cache/bridge_level_dataset.pkl       national anchors per date (this folder's own cache)
  cache/fit_meta.pkl                   per lane out of fold logit residual spread
  results/seats_actual_wards.csv       written by seats_build.py
Output:
  results/seats_summary.json

`--selftest` replaces every actual seat count with random seats before any
fitting or scoring and writes to the scratch path given, so the code can be
checked without producing a real score.
"""
from __future__ import annotations

import argparse
import json
import math
import time
from collections import defaultdict

import numpy as np
import pandas as pd

from common import CACHE, LANES, LANE_KEY, MAJOR, OUT, expit, logit
from score import DRAWS, SEED

SCHEDULED = ["2019-05-02", "2021-05-06", "2022-05-05", "2023-05-04", "2025-05-01", "2026-05-07"]
YEAR = {d: d[:4] for d in SCHEDULED}
KEYS = [LANE_KEY[p] for p in LANES]
ARMS = ["c0", "c2"]

# Fixed in advance (SEATS_SPEC.md). Not tuned.
LAMBDA_GRID = np.round(np.arange(0.50, 3.0001, 0.05), 2)
CALIB_SHRINK = 0.5
CALIB_PSEUDO = 1.0
M4_MIN_MATCHED = 0.60
SPLIT_GAP = 0.05
CHUNK = 250


# ------------------------------------------------------------- helpers ----

def win_chances(sh: np.ndarray, sig: np.ndarray, z: np.ndarray) -> np.ndarray:
    """Chance each lane leads, for every ward: the same rule as score.Mapper
    (logit share plus lane spread times one shared set of normal draws, argmax),
    vectorised. sh: wards by lanes, zero where a lane has no forecast."""
    out = np.zeros_like(sh)
    for a in range(0, len(sh), CHUNK):
        s = sh[a:a + CHUNK]
        live = s > 0
        lg = np.where(live, logit(np.where(live, s, 0.5)), -np.inf)
        dr = lg[None, :, :] + z[:, None, :] * sig[None, None, :]
        dr[:, ~live] = -np.inf
        w = np.argmax(dr, axis=2)
        for k in range(sh.shape[1]):
            out[a:a + CHUNK, k] = (w == k).mean(axis=0)
    return out


def split_seats(sh: np.ndarray, sig: np.ndarray, z: np.ndarray, up: np.ndarray, deterministic: bool) -> np.ndarray:
    """Split rule (question d): in a ward with two or more seats, if the gap
    between the first and second lane's share is under SPLIT_GAP the leader takes
    ceil(m/2) seats and the second floor(m/2); otherwise the leader takes all.
    Deterministic for M0s; averaged over the same draws for M1s."""
    def alloc(shares, m):
        res = np.zeros_like(shares)
        order = np.argsort(-shares, axis=-1)
        first, second = order[..., 0], order[..., 1]
        s1 = np.take_along_axis(shares, first[..., None], -1)[..., 0]
        s2 = np.take_along_axis(shares, second[..., None], -1)[..., 0]
        split = (m >= 2) & (s1 - s2 < SPLIT_GAP) & (s2 > 0)
        lead_seats = np.where(split, np.ceil(m / 2), m)
        sec_seats = np.where(split, np.floor(m / 2), 0)
        np.put_along_axis(res, first[..., None], lead_seats[..., None], -1)
        np.put_along_axis(res, second[..., None], (np.take_along_axis(res, second[..., None], -1)[..., 0] + sec_seats)[..., None], -1)
        return res

    if deterministic:
        return alloc(sh, up.astype(float))
    out = np.zeros_like(sh)
    for a in range(0, len(sh), CHUNK):
        s = sh[a:a + CHUNK]
        live = s > 0
        lg = np.where(live, logit(np.where(live, s, 0.5)), -np.inf)
        dr = lg[None, :, :] + z[:, None, :] * sig[None, None, :]
        e = np.where(np.isfinite(dr), np.exp(np.clip(dr, -50, 50)), 0.0)
        p = e / (1 + e)
        p = p / p.sum(axis=2, keepdims=True)
        m = np.broadcast_to(up[a:a + CHUNK][None, :].astype(float), p.shape[:2])
        out[a:a + CHUNK] = alloc(p, m).mean(axis=0)
    return out


def stretch(sh: np.ndarray, lam: float) -> np.ndarray:
    """M2: one stretch factor on forecast logit shares around each lane's mean
    over the election's forecast wards (lanes with a forecast only), then renormalise."""
    live = sh > 0
    lg = np.where(live, logit(np.where(live, sh, 0.5)), np.nan)
    mean = np.nanmean(lg, axis=0)
    x = mean[None, :] + lam * (lg - mean[None, :])
    s = np.where(live, expit(np.nan_to_num(x)), 0.0)
    return s / s.sum(axis=1, keepdims=True)


def brier(p: np.ndarray, lead: np.ndarray) -> float:
    y = np.zeros_like(p)
    y[np.arange(len(p)), lead] = 1.0
    return float(((p - y) ** 2).sum(axis=1).mean())


def rmse(pred: dict, act: dict, lanes) -> float:
    return float(math.sqrt(np.mean([(pred[p] - act[p]) ** 2 for p in lanes])))


def totals(mat: np.ndarray) -> dict:
    return {p: float(mat[:, j].sum()) for j, p in enumerate(LANES)}


# ---------------------------------------------------------------- main ----

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", metavar="OUT_JSON")
    args = ap.parse_args()
    t_start = time.time()

    # This folder's own caches, written by its own scripts (our research output, not untrusted data).
    pred = pd.read_pickle(CACHE / "bridge_level_predictions.pkl").set_index("ballot_paper_id")
    ds = pd.read_pickle(CACHE / "bridge_level_dataset.pkl")
    fit_meta = pd.read_pickle(CACHE / "fit_meta.pkl")
    sig = np.array([fit_meta["lanes"][p]["oof_logit_resid_sd"] for p in LANES])
    z = np.random.default_rng(SEED).standard_normal((DRAWS, len(LANES)))
    anchor = ds[ds.anchor_kind.notna()].groupby("date")[[f"a_{k}" for k in KEYS]].first()

    seats = pd.read_csv(OUT / "seats_actual_wards.csv")
    if args.selftest:
        rng = np.random.default_rng(1)
        for k in KEYS:
            seats[f"won_{k}"] = 0
        pick = rng.integers(0, len(KEYS), size=len(seats))
        for j, k in enumerate(KEYS):
            seats.loc[pick == j, f"won_{k}"] = seats.loc[pick == j, "seats_up"]

    # Per election arrays, same rows for every method and arm.
    E = {}
    for d in SCHEDULED:
        s = seats[seats.date == d].reset_index(drop=True)
        p = pred.loc[s.ballot_paper_id]
        e = {"ids": s.ballot_paper_id.tolist(), "council": s.council.to_numpy(), "up": s.seats_up.to_numpy(),
             "won": s[[f"won_{k}" for k in KEYS]].to_numpy(dtype=float)}
        # Ward leader by vote share, from the dataset's full slate actual shares.
        e["lead"] = p[[f"s_{k}" for k in KEYS]].to_numpy(dtype=float).argmax(axis=1)
        if args.selftest:
            e["lead"] = np.random.default_rng(2).integers(0, len(KEYS), size=len(s))
        for a in ARMS:
            sh = np.nan_to_num(p[[f"{a}_{k}" for k in KEYS]].to_numpy(dtype=float))
            assert (sh.sum(axis=1) > 0).all()
            e[a] = sh / sh.sum(axis=1, keepdims=True)
        # M4 inputs: previous contest of the same ward.
        has = s.prev_ballot.notna().to_numpy()
        e["m4_matched_share"] = float(s.seats_up[has].sum() / s.seats_up.sum())
        if has.any():
            sm = s[has]
            w = sm.seats_up.to_numpy(dtype=float)
            prev_share = sm[[f"prev_won_{k}" for k in KEYS]].to_numpy(dtype=float) / sm.prev_seats_up.to_numpy(dtype=float)[:, None]
            # A lane not yet polled at the previous date (Reform UK before February 2019) has anchor zero there.
            a_prev = np.nan_to_num(anchor.loc[sm.prev_date, [f"a_{k}" for k in KEYS]].to_numpy(dtype=float))
            a_now = anchor.loc[d, [f"a_{k}" for k in KEYS]].to_numpy(dtype=float)
            e["m4_d"] = (w[:, None] * prev_share).sum(axis=0) / w.sum()
            e["m4_delta"] = a_now - (w[:, None] * a_prev).sum(axis=0) / w.sum()
            # Lanes standing in at least one scored ward that day (known from nominations before polling day).
            e["m4_stood"] = p[[f"stood_{k}" for k in KEYS]].astype(bool).to_numpy().any(axis=0)
            e["m4_actual_share"] = sm[[f"won_{k}" for k in KEYS]].to_numpy(dtype=float).sum(axis=0) / w.sum()
        E[d] = e
    m4_years = [d for d in SCHEDULED if E[d]["m4_matched_share"] >= M4_MIN_MATCHED]
    t_prep = time.time() - t_start

    # Win chances for every lambda, per election and arm (no actual used).
    t0 = time.time()
    WC = {a: {d: {} for d in SCHEDULED} for a in ARMS}
    for a in ARMS:
        for d in SCHEDULED:
            for lam in LAMBDA_GRID:
                sh = E[d][a] if lam == 1.0 else stretch(E[d][a], lam)
                WC[a][d][float(lam)] = win_chances(sh, sig, z)
    t_chances = time.time() - t0

    t0 = time.time()
    res = {"arms": {}, "fits": {}, "coverage": {}}
    for d in SCHEDULED:
        res["coverage"][YEAR[d]] = {"scored_wards": len(E[d]["ids"]), "scored_seats": int(E[d]["up"].sum()),
                                   "m4_matched_seat_share": round(E[d]["m4_matched_share"], 4)}
    res["m4_years"] = [YEAR[d] for d in m4_years]
    actual = {YEAR[d]: totals(E[d]["won"]) for d in SCHEDULED}
    res["actual_seats"] = actual

    # M4 does not use a ward forecast, so it is the same for both arms.
    m4 = {}
    m4_fit = {}
    for t in m4_years:
        tr = [d for d in m4_years if d != t]
        x = np.concatenate([E[d]["m4_delta"][E[d]["m4_stood"]] for d in tr])
        y = np.concatenate([(E[d]["m4_actual_share"] - E[d]["m4_d"])[E[d]["m4_stood"]] for d in tr])
        beta = float((x * y).sum() / (x * x).sum())
        s = np.where(E[t]["m4_stood"], np.maximum(E[t]["m4_d"] + beta * E[t]["m4_delta"], 0), 0.0)
        s = s / s.sum()
        m4[YEAR[t]] = {p: float(s[j] * E[t]["up"].sum()) for j, p in enumerate(LANES)}
        m4_fit[YEAR[t]] = {"beta": round(beta, 4), "training_years": [YEAR[d] for d in tr]}
    res["fits"]["m4"] = m4_fit

    for a in ARMS:
        meth = {m: {} for m in ["M0", "M1", "M2", "M3", "M4", "M5"]}
        ward = {m: {} for m in ["M0", "M1", "M2", "M3"]}
        fits = {}
        reliab = {}
        split = {}
        for t in SCHEDULED:
            y = YEAR[t]
            tr = [d for d in SCHEDULED if d != t]
            e = E[t]
            # M0
            m0 = np.zeros_like(e[a])
            m0[np.arange(len(m0)), e[a].argmax(axis=1)] = e["up"]
            # M1
            p1 = WC[a][t][1.0]
            m1 = p1 * e["up"][:, None]
            # M2: lambda minimising mean leader Brier over every ward of the five other elections.
            obj = {}
            for lam in LAMBDA_GRID:
                lam = float(lam)
                num = sum(brier(WC[a][d][lam], E[d]["lead"]) * len(E[d]["ids"]) for d in tr)
                obj[lam] = num / sum(len(E[d]["ids"]) for d in tr)
            lam_t = min(obj, key=lambda k: (obj[k], abs(k - 1.0)))
            p2 = WC[a][t][lam_t]
            m2 = p2 * e["up"][:, None]
            # M3: M2 with a per lane seat ratio from the five other elections (each with lam_t), shrunk.
            A = sum(E[d]["won"].sum(axis=0) for d in tr)
            X = sum((WC[a][d][lam_t] * E[d]["up"][:, None]).sum(axis=0) for d in tr)
            r = CALIB_SHRINK * np.log((A + CALIB_PSEUDO) / (X + CALIB_PSEUDO))
            m3 = m2 * np.exp(r)[None, :]
            m3 = m3 / m3.sum(axis=1, keepdims=True) * e["up"][:, None]
            fits[y] = {"lambda": lam_t, "calibration_log_ratio": {p: round(float(r[j]), 4) for j, p in enumerate(LANES)},
                       "calibration_multiplier": {p: round(float(np.exp(r[j])), 4) for j, p in enumerate(LANES)}}
            for m, mat in [("M0", m0), ("M1", m1), ("M2", m2), ("M3", m3)]:
                meth[m][y] = totals(mat)
                ward[m][y] = mat
            if y in m4:
                meth["M4"][y] = m4[y]
                meth["M5"][y] = {p: (meth["M3"][y][p] + m4[y][p]) / 2 for p in LANES}
            # (c) ten band table for M1 win chances, and Brier for M1 and M2.
            live = e[a] > 0
            pv = p1[live]
            yv = (np.arange(len(LANES))[None, :] == e["lead"][:, None])[live]
            bands = []
            for b in range(10):
                lo, hi = b / 10, (b + 1) / 10
                mk = (pv >= lo) & ((pv < hi) if b < 9 else (pv <= hi))
                bands.append({"band": f"{lo:.1f} to {hi:.1f}", "lane_wards": int(mk.sum()),
                              "mean_chance": round(float(pv[mk].mean()), 4) if mk.any() else None,
                              "share_led": round(float(yv[mk].mean()), 4) if mk.any() else None})
            reliab[y] = {"bands": bands, "brier_m1": round(brier(p1, e["lead"]), 4), "brier_m2": round(brier(p2, e["lead"]), 4),
                         "m1_expected_leaders": {p: round(float(p1[:, j].sum()), 1) for j, p in enumerate(LANES)},
                         "actual_leaders": {p: int((e["lead"] == j).sum()) for j, p in enumerate(LANES)}}
            # (d) split rule
            m0s = split_seats(e[a], sig, z, e["up"], True)
            m1s = split_seats(e[a], sig, z, e["up"], False)
            split[y] = {"M0s": totals(m0s), "M1s": totals(m1s)}

        # Scores
        sc = {m: {} for m in meth}
        for m in meth:
            for y, pr in meth[m].items():
                sc[m][y] = {"rmse_five": round(rmse(pr, actual[y], MAJOR), 2), "rmse_six": round(rmse(pr, actual[y], LANES), 2),
                            "signed_error": {p: round(pr[p] - actual[y][p], 1) for p in LANES},
                            "seats": {p: round(pr[p], 1) for p in LANES}}
        years = [YEAR[d] for d in SCHEDULED]
        m4y = [YEAR[d] for d in m4_years]

        def mean_of(m, ys, key="rmse_five"):
            return round(float(np.mean([sc[m][y][key] for y in ys])), 2)

        qa = {}
        for m in meth:
            ys = years if m in ("M0", "M1", "M2", "M3") else m4y
            r = {"years": ys, "mean_rmse_five": mean_of(m, ys), "mean_rmse_six": mean_of(m, ys, "rmse_six"),
                 "m0_mean_same_years": mean_of("M0", ys), "m1_mean_same_years": mean_of("M1", ys),
                 "years_lower_than_m1": [y for y in ys if sc[m][y]["rmse_five"] < sc["M1"][y]["rmse_five"]]}
            if m in ("M0", "M1"):
                r["supported"] = None
            else:
                need = 4
                r["supported"] = bool(r["mean_rmse_five"] < r["m0_mean_same_years"] and r["mean_rmse_five"] < r["m1_mean_same_years"]
                                      and len(r["years_lower_than_m1"]) >= need)
            qa[m] = r
        supported = [m for m in qa if qa[m]["supported"]]
        best = min(supported, key=lambda m: qa[m]["mean_rmse_five"]) if supported else None
        best_unsupported = min(["M2", "M3", "M4", "M5"], key=lambda m: qa[m]["mean_rmse_five"])

        # (d) per council scoring for M0 to M3, and split rule scores.
        per_council = {}
        for m in ["M0", "M1", "M2", "M3"]:
            per_council[m] = {}
            for t in SCHEDULED:
                y = YEAR[t]
                e = E[t]
                tot5 = []
                for c in np.unique(e["council"]):
                    mk = e["council"] == c
                    pr = ward[m][y][mk].sum(axis=0)
                    ac = e["won"][mk].sum(axis=0)
                    tot5.append(math.sqrt(np.mean([(pr[j] - ac[j]) ** 2 for j, p in enumerate(LANES) if p in MAJOR])))
                per_council[m][y] = {"councils": len(tot5), "sum_council_rmse_five": round(float(np.sum(tot5)), 1)}
        split_scores = {v: {y: round(rmse(split[y][v], actual[y], MAJOR), 2) for y in years} for v in ["M0s", "M1s"]}
        for v in split_scores:
            split_scores[v]["mean"] = round(float(np.mean([split_scores[v][y] for y in years])), 2)

        res["arms"][a] = {"scores": sc, "question_a": qa, "supported": supported, "best_supported": best,
                          "lowest_mean_of_m2_to_m5": best_unsupported, "fits": fits, "question_c": reliab,
                          "question_d": {"per_council": per_council, "split_rule_rmse_five": split_scores,
                                         "split_rule_seats": {y: {v: {p: round(x, 1) for p, x in split[y][v].items()} for v in split[y]} for y in split}}}
    t_fit_score = time.time() - t0
    res["timing_seconds"] = {"prepare": round(t_prep, 1), "win_chances_all_lambdas": round(t_chances, 1),
                             "fit_and_score": round(t_fit_score, 1), "total": round(time.time() - t_start, 1)}
    res["constants"] = {"lambda_grid": [float(LAMBDA_GRID[0]), float(LAMBDA_GRID[-1]), 0.05], "calibration_shrink": CALIB_SHRINK,
                        "calibration_pseudo_seats": CALIB_PSEUDO, "m4_min_matched_seat_share": M4_MIN_MATCHED,
                        "split_gap": SPLIT_GAP, "draws": DRAWS, "seed": SEED}
    res["selftest_random_seats"] = bool(args.selftest)
    path = args.selftest or (OUT / "seats_summary.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=1)
    print("written", path, "timing", res["timing_seconds"])


if __name__ == "__main__":
    main()
