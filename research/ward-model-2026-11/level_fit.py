"""Out of fold residuals inside C2's training window (LEVEL_SPEC.md).

For every cut and lane C2 forecast at, refit C2's lane model on five council
folds of its own training rows and predict the rows of the latest 372 days that
each fold holds out. From those residuals, the level (L1) and slope (L2) per
cut and lane. C2 itself is not refitted: its cached offsets are the base.

Prints row counts, timings and the estimated levels and slopes only; these come
from training rows and are not scores. Scoring is in level_score.py.

  uv run python level_fit.py

Input: cache/rebuild/corrected/bridge_level_dataset.pkl, fit_meta.pkl and
bridge_level_predictions.pkl (this folder's own research cache, written by
rebuild.py and rebuild_fit_score.py, not untrusted data).
Output: cache/level/level_corrections.pkl
"""
from __future__ import annotations

import time

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from sklearn.model_selection import GroupKFold
from threadpoolctl import threadpool_limits

from bridge_level_fit import BY_FROM, BY_TO, FEATS, MIN_ROWS, SCHEDULED, STAND, standing_inputs
from backtest_b_fit import CLEAN
from common import CACHE, LANES, LANE_KEY, logit
from rolling_fit import make

SRC = CACHE / "rebuild" / "corrected"
DST = CACHE / "level"
KEYS = [LANE_KEY[p] for p in LANES]
WINDOW_DAYS = 372
MIN_WINDOW = 30
FOLDS = 5
SHRINK_LEVEL = 100.0
SHRINK_SLOPE = 400.0
SLOPE_RANGE = (0.5, 2.0)


def oof_job(params, X, cols, y, groups, train_idx, win_idx):
    """Out of fold C2 predictions for the window rows win_idx (a subset of train_idx)."""
    j = [cols.index(f) for f in FEATS["c2"]]
    pred = np.full(len(win_idx), np.nan)
    pos = {r: i for i, r in enumerate(win_idx)}
    with threadpool_limits(1):
        for fit_part, held in GroupKFold(n_splits=FOLDS).split(train_idx, groups=groups[train_idx]):
            held_rows = train_idx[held]
            want = [r for r in held_rows if r in pos]
            if not want:
                continue
            tr = train_idx[fit_part]
            Xt = X[tr][:, j].copy()
            # as bridge_level_fit.fit_cut: a column with no value is zero filled
            Xt[:, np.isnan(Xt).all(axis=0)] = 0.0
            m = make(params, FEATS["c2"]).fit(Xt, y[tr])
            pred[[pos[r] for r in want]] = m.predict(X[want][:, j])
    return pred


def main():
    t0 = time.time()
    # This folder's own cache (research output), not untrusted data.
    df = pd.read_pickle(SRC / "bridge_level_dataset.pkl").reset_index(drop=True)
    params = {p: pd.read_pickle(SRC / "fit_meta.pkl")["lanes"][p]["best_params"] for p in LANES}
    df["is_by"] = df["is_by"].astype(bool)
    df = standing_inputs(df)
    anch = df.anchor_kind.notna().to_numpy()

    # cuts exactly as bridge_level_fit.main
    test = (~df.is_by & df.date.isin(SCHEDULED)) | (df.is_by & (df.date >= BY_FROM) & (df.date < BY_TO))
    cut = pd.Series(np.where(df.date.isin(SCHEDULED), df.date, df.date.str[:7] + "-01"), index=df.index)
    df["cut"] = np.where(test, cut, None)
    cuts = sorted(set(df.cut.dropna()))

    cols = list(dict.fromkeys(CLEAN + STAND))
    X = df[cols].astype(float).to_numpy()
    ys = {k: np.asarray(logit(df[f"s_{k}"])) - np.asarray(logit(df[f"a_{k}"])) for k in KEYS}
    stood = {k: df[f"stood_{k}"].to_numpy().astype(bool) for k in KEYS}
    groups = df["council"].astype(str).to_numpy()
    dts = pd.to_datetime(df["date"]).to_numpy()

    jobs, meta, skipped = [], [], []
    for c in cuts:
        rows = np.flatnonzero((df.cut == c).to_numpy() & anch)
        before = anch & (df.date < c).to_numpy()
        start = np.datetime64(pd.Timestamp(c) - pd.Timedelta(days=WINDOW_DAYS))
        for p in LANES:
            k = LANE_KEY[p]
            tr = np.flatnonzero(before & stood[k])
            te = rows[stood[k][rows]]
            if len(tr) < MIN_ROWS or not len(te):
                continue  # C2 has no model here, or nothing to correct
            win = tr[dts[tr] >= start]
            if len(win) < MIN_WINDOW:
                skipped.append((c, k, int(len(win))))
                continue
            jobs.append(delayed(oof_job)(params[p], X, cols, ys[k], groups, tr, win))
            meta.append((c, k, tr, win))
    print(f"cuts {len(cuts)}, lane jobs {len(jobs)} x {FOLDS} folds, (cut, lane) pairs with a window under {MIN_WINDOW} rows: {len(skipped)}", flush=True)

    t1 = time.time()
    results = Parallel(n_jobs=8, verbose=0)(jobs)
    fit_seconds = time.time() - t1
    print(f"fitted in {fit_seconds:.0f}s", flush=True)

    corr = {}
    for (c, k, tr, win), pred in zip(meta, results):
        y = ys[k][win]
        good = ~np.isnan(pred)
        y, pr = y[good], pred[good]
        n = int(len(y))
        r = y - pr
        b = float(np.polyfit(pr, y, 1)[0]) if n >= MIN_WINDOW and np.std(pr) > 0 else 1.0
        level = float(r.mean()) * n / (n + SHRINK_LEVEL)
        b_star = float(np.clip(1.0 + (b - 1.0) * n / (n + SHRINK_SLOPE), *SLOPE_RANGE))
        corr[(c, k)] = {"n": n, "window_rows": int(len(win)), "mean_residual": float(r.mean()), "level": level,
                        "mean_oof_prediction": float(pr.mean()), "slope": b, "slope_shrunk": b_star,
                        "window_byelection_rows": int(df.is_by.to_numpy()[win][good].sum())}
    for c, k, nw in skipped:
        corr[(c, k)] = {"n": nw, "window_rows": nw, "mean_residual": None, "level": 0.0,
                        "mean_oof_prediction": None, "slope": None, "slope_shrunk": 1.0, "window_byelection_rows": None}

    DST.mkdir(parents=True, exist_ok=True)
    pd.to_pickle({"corrections": corr, "fit_seconds": fit_seconds, "lane_jobs": len(jobs), "cuts": len(cuts),
                  "skipped_small_window": skipped}, DST / "level_corrections.pkl")
    for c in SCHEDULED:
        print(c, {k: (corr[(c, k)]["n"], round(corr[(c, k)]["level"], 3), round(corr[(c, k)]["slope_shrunk"], 3))
                  for k in KEYS if (c, k) in corr})
    for c in [x for x in cuts if x >= "2026-06-01"]:
        print(c, {k: (corr[(c, k)]["n"], round(corr[(c, k)]["level"], 3), round(corr[(c, k)]["slope_shrunk"], 3))
                  for k in KEYS if (c, k) in corr})
    print(f"total {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
