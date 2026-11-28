"""Rolling forecasts for the two-layer test (TWO_LAYER_SPEC.md).

Every forecast for a contest on day T uses only contests dated before T.
Prints row counts and timings only; scoring is in rolling_score.py.

Output: cache/rolling_predictions.pkl
"""
from __future__ import annotations

import sys
import time

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge

from common import CACHE, LANES, LANE_KEY, expit, logit
from fit_predict import FEATURES, SEED

FIRST_SCHEDULED = "2024-05-02"
SCHEDULED_TESTS = ["2025-05-01", "2026-05-07"]
HALF_LIFE_DAYS = 365.0
SHRINK_N = 20.0
RIDGE_ALPHA = 10.0
MIN_LAYER_ROWS = 40

FEATURES_BASE = [f for f in FEATURES if f != "is_by"]
KEYS = [LANE_KEY[p] for p in LANES]


def make(params, features):
    cat = [f == "region_code" for f in features]
    return HistGradientBoostingRegressor(categorical_features=cat, random_state=SEED, **params)


def fit_lanes(train: pd.DataFrame, features, params):
    models = {}
    for p in LANES:
        k = LANE_KEY[p]
        t = train[train[f"stood_{k}"]]
        if len(t) < 50:
            models[k] = None
            continue
        y = logit(t[f"s_{k}"]) - logit(t[f"a_{k}"])
        models[k] = make(params[p], features).fit(t[features].astype(float).to_numpy(), y)
    return models


def predict_offsets(models, rows: pd.DataFrame, features):
    """Predicted offset per lane on the logit scale; NaN where the lane does not stand or has no model."""
    out = {}
    for k in KEYS:
        v = np.full(len(rows), np.nan)
        stood = rows[f"stood_{k}"].to_numpy().astype(bool)
        if models[k] is not None and stood.any():
            v[stood] = models[k].predict(rows.loc[stood, features].astype(float).to_numpy())
        out[k] = v
    return out


def months_since_may(d: pd.Timestamp) -> float:
    """Months since the most recent first Thursday of May election day (approximated as 5 May)."""
    year = d.year if (d.month, d.day) >= (5, 5) else d.year - 1
    return (d - pd.Timestamp(year=year, month=5, day=5)).days / 30.44


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    # Both pickles are this folder's own local cache, written by prepare.py and fit_predict.py.
    df = pd.read_pickle(CACHE / "dataset.pkl")
    params = {p: pd.read_pickle(CACHE / "fit_meta.pkl")["lanes"][p]["best_params"] for p in LANES}
    df = df[df.anchor_kind.notna()].copy().reset_index(drop=True)
    df["is_by"] = df["is_by"].astype(bool)
    df["msm"] = df["d"].map(months_since_may)

    by_test = df[df.is_by & (df.date > FIRST_SCHEDULED)]
    sched_test = df[~df.is_by & df.date.isin(SCHEDULED_TESTS)]
    dates = sorted(set(by_test.date) | set(sched_test.date))
    if limit:
        dates = dates[:limit]
    print(f"by-elections {len(by_test)}, scheduled test rows {len(sched_test)}, polling days {len(dates)}")

    cols = {}
    for arm in ["base", "s1", "s2", "s3"]:
        for k in KEYS:
            cols[f"{arm}_{k}"] = np.full(len(df), np.nan)
    for k in KEYS:
        cols[f"e_base_{k}"] = np.full(len(df), np.nan)   # base error, logit scale
        cols[f"e_s2_{k}"] = np.full(len(df), np.nan)     # error after the S2 offset
        cols[f"sd_by_{k}"] = np.full(len(df), np.nan)    # rolling by-election sd (NaN until 40 rows)
        cols[f"off_s2_{k}"] = np.full(len(df), np.nan)   # S2 offset applied
    layer_rows = np.zeros(len(df))

    sched = df[~df.is_by]
    base_cache = {}
    t0 = time.time()
    for n, T in enumerate(dates):
        idx = df.index[(df.date == T) & ((df.is_by & (df.date > FIRST_SCHEDULED)) | (~df.is_by & df.date.isin(SCHEDULED_TESTS)))]
        rows = df.loc[idx]
        # ---- base: scheduled contests before T
        tr = sched[sched.date < T]
        if len(tr) not in base_cache:
            base_cache[len(tr)] = fit_lanes(tr, FEATURES_BASE, params)
        base_off = predict_offsets(base_cache[len(tr)], rows, FEATURES_BASE)
        # ---- S1 pooled: every contest before T
        pooled = fit_lanes(df[df.date < T], FEATURES, params)
        s1_off = predict_offsets(pooled, rows, FEATURES)

        isby = rows.is_by.to_numpy()
        # earlier by-elections with a base error
        earlier = df.index[df.is_by & (df.date > FIRST_SCHEDULED) & (df.date < T)]
        age = (pd.Timestamp(T) - df.loc[earlier, "d"]).dt.days.to_numpy()
        w_all = 0.5 ** (age / HALF_LIFE_DAYS)
        for k in KEYS:
            a = logit(rows[f"a_{k}"])
            cols[f"base_{k}"][idx] = expit(a + base_off[k])
            cols[f"s1_{k}"][idx] = expit(a + s1_off[k])
            e_prev = cols[f"e_base_{k}"][earlier]
            ok = ~np.isnan(e_prev)
            w, e = w_all[ok], e_prev[ok]
            nsum = w.sum()
            offset = float((w * e).sum() / nsum * nsum / (nsum + SHRINK_N)) if nsum > 0 else 0.0
            s2 = np.where(isby, base_off[k] + offset, base_off[k])
            s3 = s2.copy()
            if ok.sum() >= MIN_LAYER_ROWS and isby.any():
                hist = df.loc[earlier[ok]]
                def design(frame, base_logit):
                    gap = frame["prev_gap_years"].fillna(0.0).to_numpy()
                    return np.column_stack([base_logit, gap, frame["has_prev"].to_numpy(), frame["n_standing"].to_numpy(), frame["msm"].to_numpy()])
                Xh = design(hist, logit(cols[f"base_{k}"][earlier[ok]]))
                mu, sd = Xh.mean(axis=0), Xh.std(axis=0)
                sd[sd == 0] = 1.0
                ridge = Ridge(alpha=RIDGE_ALPHA).fit((Xh - mu) / sd, e, sample_weight=w)
                Xt = design(rows, a + base_off[k])
                corr = ridge.predict((np.nan_to_num(Xt) - mu) / sd)
                s3 = np.where(isby, base_off[k] + corr, base_off[k])
            cols[f"s2_{k}"][idx] = expit(a + s2)
            cols[f"s3_{k}"][idx] = expit(a + s3)
            cols[f"off_s2_{k}"][idx] = offset
            # rolling by-election sd from earlier post-layer errors
            e2 = cols[f"e_s2_{k}"][earlier]
            ok2 = ~np.isnan(e2)
            if ok2.sum() >= MIN_LAYER_ROWS:
                w2 = w_all[ok2]
                m2 = (w2 * e2[ok2]).sum() / w2.sum()
                cols[f"sd_by_{k}"][idx] = float(np.sqrt((w2 * (e2[ok2] - m2) ** 2).sum() / w2.sum()))
            # store this day's errors for later days (by-elections only)
            y = np.asarray(logit(rows[f"s_{k}"])) - np.asarray(a)
            stood = rows[f"stood_{k}"].to_numpy().astype(bool)
            eb = np.where(stood & isby, y - base_off[k], np.nan)
            cols[f"e_base_{k}"][idx] = eb
            cols[f"e_s2_{k}"][idx] = np.where(stood & isby, y - s2, np.nan)
        layer_rows[idx] = len(earlier)
        if n % 10 == 0:
            print(f"  {T} rows {len(rows)} earlier by-elections {len(earlier)} elapsed {time.time()-t0:.0f}s", flush=True)

    out = df.copy()
    for c, v in cols.items():
        out[c] = v
    out["layer_rows"] = layer_rows
    # renormalise each arm over the lanes standing
    for arm in ["base", "s1", "s2", "s3"]:
        raw = out[[f"{arm}_{k}" for k in KEYS]].fillna(0.0)
        tot = raw.sum(axis=1)
        for k in KEYS:
            out[f"{arm}_{k}"] = np.where(tot > 0, raw[f"{arm}_{k}"] / tot.replace(0, np.nan), np.nan)
    scored = out[out[[f"base_{k}" for k in KEYS]].notna().any(axis=1)]
    scored.to_pickle(CACHE / ("rolling_predictions.pkl" if not limit else "rolling_predictions.partial.pkl"))
    print(f"wrote {len(scored)} forecast rows in {time.time()-t0:.0f}s; base fits {len(base_cache)}")


if __name__ == "__main__":
    main()
