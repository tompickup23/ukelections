"""Local strength inputs (STRENGTH_SPEC.md): forward only forecasts under L0 (C2 of
BRIDGE_LEVEL_SPEC.md as it is), L1 (L0 plus the ward level strength inputs) and
L2 (L1 plus the council level strength inputs), of the scheduled elections of May
2019, 2021, 2022, 2023, 2025 and 2026 and of every by-election from May 2018 to
November 2026.

Cuts, lane rules, settings and renormalisation are bridge_level_fit.py's: one fit
per scheduled test day, one per calendar month for by-elections on contests dated
before the first of the month, every (cut, lane) pair one job fitting all three
arms, eight jobs at a time, each single threaded, settings from fit_meta.pkl.

  uv run python strength_fit.py --reproduce   fits C2 alone on the six scheduled
      cuts and checks its offsets against cache/bridge_level_predictions.pkl
      (copied read only from the PR 197 worktree). Prints C2's leaders called,
      which PR 197 already published; no strength arm is fitted.
  uv run python strength_fit.py               the one run.

Input: cache/bridge_level_dataset.pkl (copied read only from the PR 197 worktree)
Output: cache/strength_predictions.pkl, cache/strength_run.pkl
"""
from __future__ import annotations

import sys
import time

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from threadpoolctl import threadpool_limits

from backtest_b_fit import CLEAN
from bridge_level_fit import BY_FROM, BY_TO, MIN_ROWS, SCHEDULED, STAND, renorm, standing_inputs
from common import CACHE, LANES, LANE_KEY, expit, logit
from rolling_fit import make
from strength_inputs import COUNCIL, WARD, build

KEYS = [LANE_KEY[p] for p in LANES]
FEATS = {"l0": CLEAN + STAND, "l1": CLEAN + STAND + WARD, "l2": CLEAN + STAND + WARD + COUNCIL}


def fit_cut(params, X, cols, y, train_idx, test_idx, arms):
    Xt = X[train_idx].copy()
    # As PR 197: sklearn's binning fails on a column with no non-missing value;
    # a column never split leaves forecasts as they are.
    Xt[:, np.isnan(Xt).all(axis=0)] = 0.0
    Xp = X[test_idx]
    out = {}
    with threadpool_limits(1):
        for arm in arms:
            j = [cols.index(f) for f in FEATS[arm]]
            out[arm] = make(params, FEATS[arm]).fit(Xt[:, j], y[train_idx]).predict(Xp[:, j])
    return out


def main():
    reproduce = "--reproduce" in sys.argv
    arms = ["l0"] if reproduce else list(FEATS)
    t0 = time.time()
    # This folder's own cache (research output copied from the PR 197 worktree, not untrusted data).
    df = pd.read_pickle(CACHE / "bridge_level_dataset.pkl").reset_index(drop=True)
    params = {p: pd.read_pickle(CACHE / "fit_meta.pkl")["lanes"][p]["best_params"] for p in LANES}
    df["is_by"] = df["is_by"].astype(bool)
    df = standing_inputs(df)
    t_in = time.time()
    df = build(df).copy()
    print(f"strength inputs built in {time.time()-t_in:.0f}s")
    anch = df.anchor_kind.notna().to_numpy()

    if reproduce:
        test = ~df.is_by & df.date.isin(SCHEDULED)
    else:
        test = (~df.is_by & df.date.isin(SCHEDULED)) | (df.is_by & (df.date >= BY_FROM) & (df.date < BY_TO))
    cut = pd.Series(np.where(df.date.isin(SCHEDULED), df.date, df.date.str[:7] + "-01"), index=df.index)
    df["cut"] = np.where(test, cut, None)
    cuts = sorted(set(df.cut.dropna()))

    cols = list(dict.fromkeys(CLEAN + STAND + WARD + COUNCIL))
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
                jobs.append(delayed(fit_cut)(params[p], X, cols, ys[k], tr, te, arms))
                meta.append((k, te))

    missing_lane = np.zeros(len(df), dtype=bool)
    for i in np.flatnonzero(test.to_numpy() & anch):
        if any(stood[k][i] and k not in fitted[df.at[i, "cut"]] for k in KEYS):
            missing_lane[i] = True
    no_anchor = test.to_numpy() & ~anch
    ok = test.to_numpy() & anch & ~missing_lane
    print(f"test rows {int(test.sum())}, cuts {len(cuts)}, lane jobs {len(jobs)}, arms fitted per job {len(arms)}")
    print(f"unforecastable: no anchor {int(no_anchor.sum())}, a standing lane without a model {int(missing_lane.sum())}")

    t1 = time.time()
    results = Parallel(n_jobs=8, verbose=0)(jobs)
    fit_seconds = time.time() - t1
    print(f"fitted {len(jobs)} lane jobs x {len(arms)} arms in {fit_seconds:.0f}s", flush=True)

    off = {f"off_{a}_{k}": np.full(len(df), np.nan) for a in arms for k in KEYS}
    for (k, te), res in zip(meta, results):
        for a in arms:
            off[f"off_{a}_{k}"][te] = res[a]
    df = pd.concat([df, pd.DataFrame(off, index=df.index)], axis=1)
    a_ = {k: np.asarray(logit(df[f"a_{k}"])) for k in KEYS}
    for arm in arms:
        raw = {k: expit(a_[k] + df[f"off_{arm}_{k}"]) for k in KEYS}
        for k, v in renorm(raw, ok).items():
            df[f"{arm}_{k}"] = v
    df["unforecastable"] = np.where(no_anchor, "no_anchor", np.where(missing_lane, "standing_lane_without_model", None))
    out = df[test.to_numpy()].copy()

    if reproduce:
        ref = pd.read_pickle(CACHE / "bridge_level_predictions.pkl").set_index("ballot_paper_id")
        o = out.set_index("ballot_paper_id")
        worst = 0.0
        for k in KEYS:
            d = (o[f"off_l0_{k}"] - ref.loc[o.index, f"off_c2_{k}"]).abs()
            assert (o[f"off_l0_{k}"].isna() == ref.loc[o.index, f"off_c2_{k}"].isna()).all(), k
            worst = max(worst, float(d.max(skipna=True) if d.notna().any() else 0.0))
        print(f"largest absolute offset difference against PR 197 C2: {worst:.3e}")
        from score import top
        for T in SCHEDULED:
            s = o[o.date == T]
            n = 0
            for _, r in s.iterrows():
                f = {p: r[f"l0_{LANE_KEY[p]}"] for p in LANES}
                if any(pd.isna(v) for v in f.values()):
                    continue
                n += top(f) == top({p: r[f"s_{LANE_KEY[p]}"] for p in LANES})
            print(f"  {T}: C2 reproduced, leaders called {n} of {len(s)}")
        return

    out.to_pickle(CACHE / "strength_predictions.pkl")
    pd.to_pickle({"fit_seconds": fit_seconds, "lane_jobs": len(jobs), "cuts": len(cuts), "total_seconds": time.time() - t0},
                 CACHE / "strength_run.pkl")
    print(f"wrote {len(out)} test rows, {int(ok.sum())} with a forecast, total {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
