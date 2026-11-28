"""Averaged fits of arm C2 (AVERAGING_SPEC.md).

For every (cut, lane) job of bridge_level_fit.py, fits:
  c2  the single fit exactly as bridge_level_fit.py makes it (seed 20261127, every training row);
  a1  seed bag: the mean predicted offset of M fits on every training row, seeds 20261127 + b, b = 0..M-1
      (member 0 is c2 itself);
  a2  council bag: the mean predicted offset of M fits, member b weighting each training row by the
      number of times its council is drawn in bootstrap b of the dataset's councils, seed 20261127 + b.

Means are taken on the logit offset scale, before expit and renormalising, which are as
bridge_level_fit.py. C0, C1 and C3 are not fitted here.

  uv run python averaging_fit.py --polls corrected --reproduce   # c2 only, checked against the rebuild cache
  uv run python averaging_fit.py --polls corrected               # c2, a1, a2

Input (read only): <rebuild>/<polls>/bridge_level_dataset.pkl, fit_meta.pkl, rebuild_manifest.json and
bridge_level_predictions.pkl, where <rebuild> is ~/ukelections-research-cache/corrected-2026-11-28/rebuild
(the cache/rebuild folder of the checked rebuild, PR 211) unless --rebuild is given.
Output: cache/averaging/<polls>/averaging_predictions.pkl and averaging_run.json. Prints row counts,
timings and the reproduction check only; scoring is in averaging_score.py.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from sklearn.ensemble import HistGradientBoostingRegressor
from threadpoolctl import threadpool_limits

from bridge_level_fit import BY_FROM, BY_TO, KEYS, MIN_ROWS, SCHEDULED, STAND, renorm, standing_inputs
from backtest_b_fit import CLEAN
from common import HERE, LANES, LANE_KEY, expit, logit, sha256
from fit_predict import SEED

MEMBERS = 8
FEATS = CLEAN + STAND  # C2's inputs, in bridge_level_fit.py's order
DEFAULT_REBUILD = Path.home() / "ukelections-research-cache/corrected-2026-11-28/rebuild"


def make(params, seed):
    cat = [f == "region_code" for f in FEATS]
    return HistGradientBoostingRegressor(categorical_features=cat, random_state=seed, **params)


def council_weights(councils: np.ndarray, members: int) -> list[np.ndarray]:
    """Per member, each row's weight: how many times its council is drawn in a bootstrap of all councils.

    Drawn once over the sorted list of every council in the dataset, so the draw is the same at every cut,
    for every lane and for both input sets."""
    uniq = np.array(sorted(set(councils)))
    idx = {c: i for i, c in enumerate(uniq)}
    pos = np.array([idx[c] for c in councils])
    out = []
    for b in range(members):
        rng = np.random.default_rng([SEED, b])
        counts = np.bincount(rng.integers(0, len(uniq), len(uniq)), minlength=len(uniq))
        out.append(counts[pos].astype(float))
    return out


def fit_job(params, X, y, tr, te, weights, members, reproduce):
    Xt = X[tr].copy()
    # As bridge_level_fit.py: sklearn's binning fails on a column with no non-missing value.
    Xt[:, np.isnan(Xt).all(axis=0)] = 0.0
    yt = y[tr]
    Xp = X[te]
    out, skipped = {}, 0
    with threadpool_limits(1):
        c2 = make(params, SEED).fit(Xt, yt).predict(Xp)
        out["c2"] = c2
        if reproduce:
            return out, 0
        preds = [c2] + [make(params, SEED + b).fit(Xt, yt).predict(Xp) for b in range(1, members)]
        out["a1"] = np.mean(preds, axis=0)
        preds = []
        for b in range(members):
            w = weights[b][tr]
            keep = w > 0
            if keep.sum() < MIN_ROWS:
                skipped += 1
                continue
            Xb = Xt[keep].copy()
            Xb[:, np.isnan(Xb).all(axis=0)] = 0.0
            preds.append(make(params, SEED + b).fit(Xb, yt[keep], sample_weight=w[keep]).predict(Xp))
        out["a2"] = np.mean(preds, axis=0) if preds else c2
    return out, skipped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--polls", choices=["pr199", "corrected"], required=True)
    ap.add_argument("--reproduce", action="store_true")
    ap.add_argument("--rebuild", type=Path, default=DEFAULT_REBUILD)
    ap.add_argument("--jobs", type=int, default=8)
    args = ap.parse_args()

    src = args.rebuild / args.polls
    man = json.loads((src / "rebuild_manifest.json").read_text())
    if sha256(src / "bridge_level_dataset.pkl") != man["outputs"]["bridge_level_dataset.pkl"]["sha256"]:
        raise SystemExit("STOP: bridge_level_dataset.pkl does not match its rebuild manifest")
    if not sha256(src / "fit_meta.pkl").startswith("936d07ee"):
        raise SystemExit("STOP: fit_meta.pkl is not the frozen settings file")
    out_dir = HERE / "cache" / "averaging" / args.polls
    out_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    # Our own research cache, written by rebuild.py (not untrusted data).
    df = pd.read_pickle(src / "bridge_level_dataset.pkl").reset_index(drop=True)
    params = {p: pd.read_pickle(src / "fit_meta.pkl")["lanes"][p]["best_params"] for p in LANES}
    df["is_by"] = df["is_by"].astype(bool)
    df = standing_inputs(df)
    anch = df.anchor_kind.notna().to_numpy()
    test = (~df.is_by & df.date.isin(SCHEDULED)) | (df.is_by & (df.date >= BY_FROM) & (df.date < BY_TO))
    cut = pd.Series(np.where(df.date.isin(SCHEDULED), df.date, df.date.str[:7] + "-01"), index=df.index)
    df["cut"] = np.where(test, cut, None)
    cuts = sorted(set(df.cut.dropna()))

    X = df[FEATS].astype(float).to_numpy()
    ys = {k: np.asarray(logit(df[f"s_{k}"])) - np.asarray(logit(df[f"a_{k}"])) for k in KEYS}
    stood = {k: df[f"stood_{k}"].to_numpy().astype(bool) for k in KEYS}
    weights = council_weights(df["council"].astype(str).to_numpy(), MEMBERS)

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
                jobs.append(delayed(fit_job)(params[p], X, ys[k], tr, te, weights, MEMBERS, args.reproduce))
                meta.append((k, te))

    missing_lane = np.zeros(len(df), dtype=bool)
    for i in np.flatnonzero(test.to_numpy() & anch):
        if any(stood[k][i] and k not in fitted[df.at[i, "cut"]] for k in KEYS):
            missing_lane[i] = True
    no_anchor = test.to_numpy() & ~anch
    ok = test.to_numpy() & anch & ~missing_lane
    arms = ["c2"] if args.reproduce else ["c2", "a1", "a2"]
    print(f"{args.polls}: test rows {int(test.sum())}, cuts {len(cuts)}, lane jobs {len(jobs)}, arms {arms}, members {MEMBERS}")

    t1 = time.time()
    results = Parallel(n_jobs=args.jobs, verbose=0)(jobs)
    fit_seconds = time.time() - t1
    print(f"fitted {len(jobs)} lane jobs in {fit_seconds:.0f}s", flush=True)

    off = {f"off_{a}_{k}": np.full(len(df), np.nan) for a in arms for k in KEYS}
    skipped = 0
    for (k, te), (res, sk) in zip(meta, results):
        skipped += sk
        for a in arms:
            off[f"off_{a}_{k}"][te] = res[a]
    for c, v in off.items():
        df[c] = v

    # Reproduction check: c2 must equal the rebuild's C2 offsets exactly.
    ref = pd.read_pickle(src / "bridge_level_predictions.pkl").set_index("ballot_paper_id")
    mine = df[test.to_numpy()].set_index("ballot_paper_id")
    diffs = {}
    for k in KEYS:
        a, b = mine[f"off_c2_{k}"], ref.loc[mine.index, f"off_c2_{k}"]
        same_nan = bool((a.isna() == b.isna()).all())
        diffs[k] = {"same_missing": same_nan, "max_abs_diff": float(np.nanmax(np.abs(a - b))) if a.notna().any() else 0.0}
    reproduced = all(v["same_missing"] and v["max_abs_diff"] == 0.0 for v in diffs.values())
    print("reproduction of C2 offsets:", "EXACT" if reproduced else "DIFFERENT", json.dumps(diffs))

    a = {k: np.asarray(logit(df[f"a_{k}"])) for k in KEYS}
    for arm in arms:
        raw = {k: expit(a[k] + df[f"off_{arm}_{k}"]) for k in KEYS}
        for k, v in renorm(raw, ok).items():
            df[f"{arm}_{k}"] = v
    df["unforecastable"] = np.where(no_anchor, "no_anchor", np.where(missing_lane, "standing_lane_without_model", None))
    keep = ["ballot_paper_id", "date", "council", "is_by", "cut", "unforecastable"] + [f"s_{k}" for k in KEYS] \
        + [f"stood_{k}" for k in KEYS] + [f"{arm}_{k}" for arm in arms for k in KEYS] + list(off)
    out = df.loc[test.to_numpy(), keep].copy()
    name = "averaging_reproduce" if args.reproduce else "averaging_predictions"
    out.to_pickle(out_dir / f"{name}.pkl")
    run = {"polls": args.polls, "arms": arms, "members": MEMBERS, "lane_jobs": len(jobs), "cuts": len(cuts),
           "fit_seconds": round(fit_seconds), "council_bag_members_skipped": skipped,
           "c2_reproduced_exactly": reproduced, "c2_offset_check": diffs,
           "input_sha256": {"bridge_level_dataset.pkl": man["outputs"]["bridge_level_dataset.pkl"]["sha256"],
                            "fit_meta.pkl": sha256(src / "fit_meta.pkl")}}
    (out_dir / f"{name}_run.json").write_text(json.dumps(run, indent=1) + "\n")
    print(f"wrote {out_dir / name}.pkl: {len(out)} test rows, {int(ok.sum())} forecast; total {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
