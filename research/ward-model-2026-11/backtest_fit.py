"""Back-test stage A (BACKTEST_SPEC.md): forward only forecasts of the scheduled
elections of May 2021, 2022 and 2023 and the by-elections of 2020 to April 2024,
under S1 (unweighted) and W365 (0.5 ** (age days / 365)).

One fit per scheduled election day; one per calendar month for by-elections,
on contests dated before the first of the month (a by-election on a scheduled
day uses that day's fit). Every (fit, lane) pair runs as its own job, eight at
a time, each single threaded. Prints row counts and timings only; scoring is
in backtest_score.py.

Input: cache/backtest_dataset.pkl (this folder's own cache, written by backtest_anchor.py)
Output: cache/backtest_predictions.pkl
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

SCHEDULED = ["2021-05-06", "2022-05-05", "2023-05-04"]
BY_FROM, BY_TO = "2020-01-01", "2024-05-01"
ARMS = {"s1": None, "w365": 365.0}
KEYS = [LANE_KEY[p] for p in LANES]
MIN_ROWS = 50


def fit_cut(params, X, y, w_age, train_idx, test_idx):
    """Fit both arms for one lane at one cut; return {arm: predicted offsets for test_idx}."""
    with threadpool_limits(1):
        out = {}
        for arm, half in ARMS.items():
            sw = None if half is None else 0.5 ** (w_age / half)
            m = make(params, FEATURES).fit(X[train_idx], y[train_idx], sample_weight=sw)
            out[arm] = m.predict(X[test_idx])
        return out


def main():
    t0 = time.time()
    # This folder's own cache.
    df = pd.read_pickle(CACHE / "backtest_dataset.pkl").reset_index(drop=True)
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
    unforecastable = {"no_anchor": 0, "no_training_rows": 0}
    train_sizes = {}
    for c in cuts:
        rows = np.flatnonzero((df.cut == c).to_numpy() & anch)
        unforecastable["no_anchor"] += int(((df.cut == c).to_numpy() & ~anch).sum())
        before = anch & (df.date < c).to_numpy()
        train_sizes[c] = int(before.sum())
        age = (pd.Timestamp(c) - df["d"]).dt.days.to_numpy().astype(float)
        any_lane = False
        for p in LANES:
            k = LANE_KEY[p]
            tr = np.flatnonzero(before & stood[k])
            te = rows[stood[k][rows]]
            if len(tr) < MIN_ROWS or len(te) == 0:
                continue
            any_lane = True
            jobs.append(delayed(fit_cut)(params[p], X, ys[k], age[tr], tr, te))
            meta.append((k, te))
        if not any_lane:
            unforecastable["no_training_rows"] += len(rows)
    print(f"test rows {int(test.sum())}, fits {len(cuts)}, lane jobs {len(jobs)}; unforecastable {unforecastable}")
    for c in cuts:
        print(f"  cut {c}: test rows {int((df.cut == c).sum())}, anchored training rows {train_sizes[c]}")

    t1 = time.time()
    results = Parallel(n_jobs=8, verbose=0)(jobs)
    print(f"fitted {len(jobs)} lane jobs x {len(ARMS)} arms in {time.time()-t1:.0f}s")

    raw = {f"{a}_{k}": np.full(len(df), np.nan) for a in ARMS for k in KEYS}
    for (k, te), res in zip(meta, results):
        a = np.asarray(logit(df.loc[te, f"a_{k}"]))
        for arm in ARMS:
            raw[f"{arm}_{k}"][te] = expit(a + res[arm])
    out = df[test].copy()
    for arm in ARMS:
        r = pd.DataFrame({k: raw[f"{arm}_{k}"][test.to_numpy()] for k in KEYS}, index=out.index).fillna(0.0)
        tot = r.sum(axis=1)
        for k in KEYS:
            out[f"{arm}_{k}"] = np.where(tot > 0, r[k] / tot.replace(0, np.nan), np.nan)
    out.to_pickle(CACHE / "backtest_predictions.pkl")
    n_fc = int(out[[f"s1_{k}" for k in KEYS]].notna().any(axis=1).sum())
    print(f"wrote {len(out)} test rows, {n_fc} with a forecast, total {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
