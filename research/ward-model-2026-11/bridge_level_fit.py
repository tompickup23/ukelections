"""By-election level and standing rates (BRIDGE_LEVEL_SPEC.md): forward only
forecasts under C0, C1, C2 and C3 of the scheduled elections of May 2019, 2021,
2022, 2023, 2025 and 2026, and of every by-election from May 2018 to November 2026.

One fit per scheduled test day; one per calendar month for by-elections, on
contests dated before the first of the month (a by-election on a test day uses
that day's fit). Every (cut, lane) pair is one job fitting C0 and C2, eight
jobs at a time, each single threaded. C1 and C3 are built afterwards from the
forward only by-election residuals of C0 and C2. Prints row counts and timings
only; scoring is in bridge_level_score.py.

Input: cache/bridge_level_dataset.pkl (this folder's own cache, written by bridge_level_anchor.py)
Output: cache/bridge_level_predictions.pkl, cache/bridge_level_levels.pkl
"""
from __future__ import annotations

import time

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from threadpoolctl import threadpool_limits

from backtest_b_fit import CLEAN
from common import CACHE, LANES, LANE_KEY, expit, logit
from rolling_fit import make

SCHEDULED = ["2019-05-02", "2021-05-06", "2022-05-05", "2023-05-04", "2025-05-01", "2026-05-07"]
# The first Thursday of May in the year before each test election.
PREVIOUS_MAY = {"2019-05-02": "2018-05-03", "2021-05-06": "2020-05-07", "2022-05-05": "2021-05-06",
                "2023-05-04": "2022-05-05", "2025-05-01": "2024-05-02", "2026-05-07": "2025-05-01"}
BY_FROM, BY_TO = "2018-05-01", "2026-12-01"
KEYS = [LANE_KEY[p] for p in LANES]
STAND = [f"{kind}_stand_{k}" for kind in ("nat", "cou", "prev_nat") for k in KEYS]
FEATS = {"c0": CLEAN, "c2": CLEAN + STAND}
MIN_ROWS = 50
HALF_LIFE_DAYS = 90.0
SHRINK = 20.0


def standing_inputs(df: pd.DataFrame) -> pd.DataFrame:
    """The 18 C2 inputs. Rates are over every dataset row on the day, anchored or not."""
    for k in KEYS:
        s = df[f"stood_{k}"].astype(float)
        df[f"nat_stand_{k}"] = s.groupby(df["date"]).transform("mean")
        df[f"cou_stand_{k}"] = s.groupby([df["date"], df["council"]]).transform("mean")
    nat = df.groupby("date")[[f"nat_stand_{k}" for k in KEYS]].first()
    sched = df.loc[~df.is_by & df.gss.notna() & (df.gss != ""), ["gss", "d"]].drop_duplicates().sort_values("d")
    sched = sched.rename(columns={"d": "prev_sched_d"})
    sched["prev_sched_key"] = sched["prev_sched_d"]
    left = df[["gss", "d"]].reset_index().sort_values("d")
    m = pd.merge_asof(left, sched, left_on="d", right_on="prev_sched_key", by="gss",
                      allow_exact_matches=False, direction="backward").set_index("index").sort_index()
    prev_date = m["prev_sched_d"].dt.strftime("%Y-%m-%d")
    for k in KEYS:
        df[f"prev_nat_stand_{k}"] = prev_date.map(nat[f"nat_stand_{k}"]).astype(float)
    df["prev_sched_date"] = prev_date
    return df


def fit_cut(params, X, cols, y, train_idx, test_idx):
    """Fit C0 and C2 for one lane at one cut; return {arm: predicted offsets for test_idx}."""
    Xt = X[train_idx].copy()
    # As stage B: sklearn's binning fails on a column with no non-missing value;
    # a column never split leaves forecasts as they are.
    Xt[:, np.isnan(Xt).all(axis=0)] = 0.0
    Xp = X[test_idx]
    out = {}
    with threadpool_limits(1):
        for arm, feats in FEATS.items():
            j = [cols.index(f) for f in feats]
            out[arm] = make(params, feats).fit(Xt[:, j], y[train_idx]).predict(Xp[:, j])
    return out


def renorm(raw: dict, ok: np.ndarray) -> dict:
    r = pd.DataFrame(raw).fillna(0.0)
    tot = r.sum(axis=1).to_numpy()
    good = ok & (tot > 0)
    return {k: np.where(good, r[k].to_numpy() / np.where(tot > 0, tot, 1.0), np.nan) for k in KEYS}


def main():
    t0 = time.time()
    # This folder's own cache (our research output, not untrusted data).
    df = pd.read_pickle(CACHE / "bridge_level_dataset.pkl").reset_index(drop=True)
    params = {p: pd.read_pickle(CACHE / "fit_meta.pkl")["lanes"][p]["best_params"] for p in LANES}
    df["is_by"] = df["is_by"].astype(bool)
    df = standing_inputs(df)
    anch = df.anchor_kind.notna().to_numpy()

    test = (~df.is_by & df.date.isin(SCHEDULED)) | (df.is_by & (df.date >= BY_FROM) & (df.date < BY_TO))
    cut = pd.Series(np.where(df.date.isin(SCHEDULED), df.date, df.date.str[:7] + "-01"), index=df.index)
    df["cut"] = np.where(test, cut, None)
    cuts = sorted(set(df.cut.dropna()))

    cols = list(dict.fromkeys(CLEAN + STAND))
    X = df[cols].astype(float).to_numpy()
    ys = {k: np.asarray(logit(df[f"s_{k}"])) - np.asarray(logit(df[f"a_{k}"])) for k in KEYS}
    stood = {k: df[f"stood_{k}"].to_numpy().astype(bool) for k in KEYS}

    jobs, meta, fitted = [], [], {}
    for c in cuts:
        rows = np.flatnonzero((df.cut == c).to_numpy() & anch)
        before = anch & (df.date < c).to_numpy()
        fitted[c] = set()
        for p in LANES:
            k = LANE_KEY[p]
            tr = np.flatnonzero(before & stood[k])
            te = rows[stood[k][rows]]
            if len(tr) < MIN_ROWS:
                continue
            fitted[c].add(k)
            if len(te):
                jobs.append(delayed(fit_cut)(params[p], X, cols, ys[k], tr, te))
                meta.append((k, te))

    missing_lane = np.zeros(len(df), dtype=bool)
    for i in np.flatnonzero(test.to_numpy() & anch):
        if any(stood[k][i] and k not in fitted[df.at[i, "cut"]] for k in KEYS):
            missing_lane[i] = True
    no_anchor = test.to_numpy() & ~anch
    ok = test.to_numpy() & anch & ~missing_lane
    print(f"test rows {int(test.sum())}, cuts {len(cuts)}, lane jobs {len(jobs)}, arms fitted per job {len(FEATS)}")
    print(f"unforecastable: no anchor {int(no_anchor.sum())}, a standing lane without a model {int(missing_lane.sum())}")
    for c in SCHEDULED:
        sel = (df.cut == c).to_numpy()
        print(f"  {c}: test rows {int(sel.sum())} (scheduled {int((sel & ~df.is_by.to_numpy()).sum())}), "
              f"anchored training rows {int((anch & (df.date < c).to_numpy()).sum())}, lanes fitted {sorted(fitted[c])}, "
              f"rows lacking a lane model {int((missing_lane & sel).sum())}, prev scheduled date known {int(df.loc[sel, 'prev_sched_date'].notna().sum())}")

    t1 = time.time()
    results = Parallel(n_jobs=8, verbose=0)(jobs)
    fit_seconds = time.time() - t1
    print(f"fitted {len(jobs)} lane jobs x {len(FEATS)} arms in {fit_seconds:.0f}s", flush=True)

    off = {f"off_{a}_{k}": np.full(len(df), np.nan) for a in FEATS for k in KEYS}
    for (k, te), res in zip(meta, results):
        for a in FEATS:
            off[f"off_{a}_{k}"][te] = res[a]
    for c, v in off.items():
        df[c] = v

    # ---- C1 and C3: by-election levels from forward only residuals
    levels = {}
    lvl = {f"lvl_{a}_{k}": np.zeros(len(df)) for a in ("c1", "c3") for k in KEYS}
    for T in SCHEDULED:
        P = PREVIOUS_MAY[T]
        win = np.flatnonzero(df.is_by.to_numpy() & ok & (df.date > P).to_numpy() & (df.date < T).to_numpy())
        age = (pd.Timestamp(T) - df.loc[win, "d"]).dt.days.to_numpy().astype(float)
        w_all = 0.5 ** (age / HALF_LIFE_DAYS)
        rows_T = np.flatnonzero((df.cut == T).to_numpy() & ~df.is_by.to_numpy())
        levels[T] = {"window_after": P, "window_before": T, "byelections_in_window_forecast": int(len(win))}
        for arm, base in (("c1", "c0"), ("c3", "c2")):
            for k in KEYS:
                e = ys[k][win] - df[f"off_{base}_{k}"].to_numpy()[win]
                use = stood[k][win] & ~np.isnan(e)
                w, e = w_all[use], e[use]
                n_w = float(w.sum())
                mean = float((w * e).sum() / n_w) if n_w > 0 else None
                L = mean * n_w / (n_w + SHRINK) if mean is not None else 0.0
                levels[T][f"{arm}_{k}"] = {"contests": int(use.sum()), "weight_sum": n_w, "weighted_mean_residual": mean, "level": L}
                lvl[f"lvl_{arm}_{k}"][rows_T] = L
    for c, v in lvl.items():
        df[c] = v

    a = {k: np.asarray(logit(df[f"a_{k}"])) for k in KEYS}
    shares = {
        "c0": {k: expit(a[k] + df[f"off_c0_{k}"]) for k in KEYS},
        "c1": {k: expit(a[k] + df[f"off_c0_{k}"] + df[f"lvl_c1_{k}"]) for k in KEYS},
        "c2": {k: expit(a[k] + df[f"off_c2_{k}"]) for k in KEYS},
        "c3": {k: expit(a[k] + df[f"off_c2_{k}"] + df[f"lvl_c3_{k}"]) for k in KEYS},
    }
    for arm, raw in shares.items():
        for k, v in renorm(raw, ok).items():
            df[f"{arm}_{k}"] = v
    df["unforecastable"] = np.where(no_anchor, "no_anchor", np.where(missing_lane, "standing_lane_without_model", None))
    out = df[test.to_numpy()].copy()
    out.to_pickle(CACHE / "bridge_level_predictions.pkl")
    pd.to_pickle({"levels": levels, "fit_seconds": fit_seconds, "lane_jobs": len(jobs), "cuts": len(cuts)}, CACHE / "bridge_level_levels.pkl")
    print(f"wrote {len(out)} test rows, {int(ok.sum())} with a forecast, total {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
