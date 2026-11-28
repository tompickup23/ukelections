"""Back-test stage B (BACKTEST_B_SPEC.md): forward only forecasts of the
scheduled elections of May 2018, 2019, 2021, 2022 and 2023 and the by-elections
of 2018 to April 2024, under S1, W365, S1c and W365c.

One fit per scheduled election day; one per calendar month for by-elections,
on contests dated before the first of the month (a by-election on a scheduled
day uses that day's fit). Every (fit, lane) pair is one job fitting all four
arms, eight jobs at a time, each single threaded. A row is forecast only if
every lane standing in it has a fitted model. Prints row counts and timings
only; scoring is in backtest_b_score.py.

Input: cache/backtest_b_dataset.pkl (this folder's own cache, written by backtest_b_anchor.py)
Output: cache/backtest_b_predictions.pkl
"""
from __future__ import annotations

import time

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from threadpoolctl import threadpool_limits

from common import CACHE, LANES, LANE_KEY, expit, logit
from fit_predict import FEATURES
from rolling_fit import make

SCHEDULED = ["2018-05-03", "2019-05-02", "2021-05-06", "2022-05-05", "2023-05-04"]
BY_FROM, BY_TO = "2018-01-01", "2024-05-01"
FUTURE = ["ge24_reform", "ge24_labour", "ge24_con", "nb_ge24_reform", "mrp_reform", "mrp_labour"]
CLEAN = [f for f in FEATURES if f not in FUTURE]
# arm: (feature list, half-life in days or None)
ARMS = {"s1": (FEATURES, None), "w365": (FEATURES, 365.0), "s1c": (CLEAN, None), "w365c": (CLEAN, 365.0)}
KEYS = [LANE_KEY[p] for p in LANES]
MIN_ROWS = 50


def fit_cut(params, X, cols, y, w_age, train_idx, test_idx):
    """Fit all four arms for one lane at one cut; return {arm: predicted offsets for test_idx}."""
    Xt = X[train_idx].copy()
    # As stage A: sklearn's binning fails on a column with no non-missing value;
    # a single-value column is never split, so filling it leaves forecasts as they are.
    Xt[:, np.isnan(Xt).all(axis=0)] = 0.0
    Xp = X[test_idx]
    out = {}
    with threadpool_limits(1):
        for arm, (feats, half) in ARMS.items():
            j = [cols.index(f) for f in feats]
            sw = None if half is None else 0.5 ** (w_age / half)
            m = make(params, feats).fit(Xt[:, j], y[train_idx], sample_weight=sw)
            out[arm] = m.predict(Xp[:, j])
    return out


def main():
    t0 = time.time()
    # This folder's own cache.
    df = pd.read_pickle(CACHE / "backtest_b_dataset.pkl").reset_index(drop=True)
    params = {p: pd.read_pickle(CACHE / "fit_meta.pkl")["lanes"][p]["best_params"] for p in LANES}
    df["is_by"] = df["is_by"].astype(bool)
    anch = df.anchor_kind.notna().to_numpy()

    test = (~df.is_by & df.date.isin(SCHEDULED)) | (df.is_by & (df.date >= BY_FROM) & (df.date < BY_TO))
    cut = pd.Series(np.where(df.date.isin(SCHEDULED), df.date, df.date.str[:7] + "-01"), index=df.index)
    df["cut"] = np.where(test, cut, None)
    cuts = sorted(set(df.cut.dropna()))

    X = df[FEATURES].astype(float).to_numpy()
    ys = {k: np.asarray(logit(df[f"s_{k}"])) - np.asarray(logit(df[f"a_{k}"])) for k in KEYS}
    stood = {k: df[f"stood_{k}"].to_numpy().astype(bool) for k in KEYS}

    jobs, meta = [], []
    fitted = {}  # cut -> set of lane keys with a model
    for c in cuts:
        rows = np.flatnonzero((df.cut == c).to_numpy() & anch)
        before = anch & (df.date < c).to_numpy()
        age = (pd.Timestamp(c) - df["d"]).dt.days.to_numpy().astype(float)
        fitted[c] = set()
        for p in LANES:
            k = LANE_KEY[p]
            tr = np.flatnonzero(before & stood[k])
            te = rows[stood[k][rows]]
            if len(tr) < MIN_ROWS:
                continue
            fitted[c].add(k)
            if len(te) == 0:
                continue
            jobs.append(delayed(fit_cut)(params[p], X, FEATURES, ys[k], age[tr], tr, te))
            meta.append((k, te))

    # rows where a standing lane has no model
    missing_lane = np.zeros(len(df), dtype=bool)
    for i in np.flatnonzero(test.to_numpy() & anch):
        c = df.at[i, "cut"]
        if any(stood[k][i] and k not in fitted[c] for k in KEYS):
            missing_lane[i] = True
    no_anchor = test.to_numpy() & ~anch
    print(f"test rows {int(test.sum())}, fits {len(cuts)}, lane jobs {len(jobs)}, arms {len(ARMS)}")
    print(f"unforecastable: no anchor {int(no_anchor.sum())}, a standing lane without a model {int(missing_lane.sum())}")
    for c in SCHEDULED:
        n_train = int((anch & (df.date < c).to_numpy()).sum())
        print(f"  {c}: test rows {int((df.cut == c).sum())}, anchored training rows {n_train}, lanes fitted {sorted(fitted.get(c, []))}, rows lacking a lane model {int((missing_lane & (df.cut == c).to_numpy()).sum())}")

    t1 = time.time()
    results = Parallel(n_jobs=8, verbose=0)(jobs)
    print(f"fitted {len(jobs)} lane jobs x {len(ARMS)} arms in {time.time()-t1:.0f}s")

    raw = {f"{a}_{k}": np.full(len(df), np.nan) for a in ARMS for k in KEYS}
    for (k, te), res in zip(meta, results):
        a = np.asarray(logit(df.loc[te, f"a_{k}"]))
        for arm in ARMS:
            raw[f"{arm}_{k}"][te] = expit(a + res[arm])
    keep = test.to_numpy()
    ok = keep & anch & ~missing_lane
    out = df[keep].copy()
    for arm in ARMS:
        r = pd.DataFrame({k: raw[f"{arm}_{k}"][keep] for k in KEYS}, index=out.index).fillna(0.0)
        tot = r.sum(axis=1)
        good = pd.Series(ok[keep], index=out.index) & (tot > 0)
        for k in KEYS:
            out[f"{arm}_{k}"] = np.where(good, r[k] / tot.replace(0, np.nan), np.nan)
    out["unforecastable"] = np.where(no_anchor[keep], "no_anchor", np.where(missing_lane[keep], "standing_lane_without_model", None))
    out.to_pickle(CACHE / "backtest_b_predictions.pkl")
    n_fc = int(out[[f"s1c_{k}" for k in KEYS]].notna().any(axis=1).sum())
    print(f"wrote {len(out)} test rows, {n_fc} with a forecast, total {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
