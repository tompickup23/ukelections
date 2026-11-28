"""Fit one gradient boosting model per lane and freeze it; predict May 2026 and
the post-May by-elections.

Same features, same procedure, same hyperparameter grid for every lane:
  - rows: training contests (before 7 May 2026, with an environment anchor)
    where the lane stood a candidate;
  - target: logit(full-slate share) minus logit(national anchor share), so the
    model learns how far a ward sits from the national level and the national
    level carries through to the forecast;
  - hyperparameters: chosen by 5-fold GroupKFold grouped by council, inside the
    training window only, on out-of-fold share MAE;
  - forecast: expit(logit(anchor) + predicted offset) for every lane standing,
    renormalised to sum to one.

Output: cache/predictions.pkl, cache/fit_meta.pkl
"""
from __future__ import annotations

import itertools
import json

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.model_selection import GroupKFold

from common import CACHE, LANES, LANE_KEY, expit, logit
from prepare import FEATURES_NUMERIC

SEED = 20261127
FEATURES = (
    FEATURES_NUMERIC
    + ["region_code", "is_by", "n_standing", "prev_gap_years", "has_prev"]
    + [f"stood_{LANE_KEY[p]}" for p in LANES]
    + [f"prev_rel_{LANE_KEY[p]}" for p in LANES]
)
CATEGORICAL = [f == "region_code" for f in FEATURES]
GRID = [
    dict(learning_rate=lr, max_leaf_nodes=leaves, min_samples_leaf=msl, max_iter=it, l2_regularization=1.0)
    for lr, leaves, msl, it in itertools.product([0.03, 0.08], [15, 31], [20, 60], [200, 500])
]


def make(params):
    return HistGradientBoostingRegressor(categorical_features=CATEGORICAL, random_state=SEED, **params)


def X(df):
    return df[FEATURES].astype(float).to_numpy()


def main():
    df = pd.read_pickle(CACHE / "dataset.pkl")
    train = df[df.set == "train"]
    targets = df[df.set.isin(["may26", "byelection"])].copy()

    meta = {"features": FEATURES, "grid_size": len(GRID), "lanes": {}}
    for p in LANES:
        k = LANE_KEY[p]
        t = train[train[f"stood_{k}"]].reset_index(drop=True)
        y = logit(t[f"s_{k}"]) - logit(t[f"a_{k}"])
        Xt, groups = X(t), t["council"].to_numpy()
        gkf = GroupKFold(n_splits=5)
        best = None
        for params in GRID:
            oof = np.zeros(len(t))
            for tr, va in gkf.split(Xt, y, groups):
                m = make(params).fit(Xt[tr], y[tr])
                oof[va] = m.predict(Xt[va])
            share_oof = expit(logit(t[f"a_{k}"]) + oof)
            mae = float(np.mean(np.abs(share_oof - t[f"s_{k}"])))
            if best is None or mae < best[0]:
                best = (mae, params, oof)
        mae, params, oof = best
        resid = y - oof
        model = make(params).fit(Xt, y)
        meta["lanes"][p] = {
            "train_rows": int(len(t)),
            "councils": int(t["council"].nunique()),
            "best_params": params,
            "oof_share_mae_pp": round(100 * mae, 2),
            "oof_logit_resid_sd": float(np.std(resid)),
            "oof_share_bias_pp": round(100 * float(np.mean(expit(logit(t[f'a_{k}']) + oof) - t[f's_{k}'])), 2),
        }
        stood = targets[f"stood_{k}"].to_numpy()
        raw = np.zeros(len(targets))
        if stood.any():
            off = model.predict(X(targets[stood]))
            raw[stood] = expit(logit(targets.loc[stood, f"a_{k}"]) + off)
        targets[f"raw_{k}"] = raw
        print(p, json.dumps(meta["lanes"][p]))

    raw_cols = [f"raw_{LANE_KEY[p]}" for p in LANES]
    tot = targets[raw_cols].sum(axis=1)
    for p in LANES:
        k = LANE_KEY[p]
        targets[f"m_{k}"] = targets[f"raw_{k}"] / tot
    targets.to_pickle(CACHE / "predictions.pkl")
    pd.to_pickle(meta, CACHE / "fit_meta.pkl")


if __name__ == "__main__":
    main()
