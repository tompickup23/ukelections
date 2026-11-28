"""Rolling forecasts with recency weights in training (RECENCY_SPEC.md): W365 and W180.

Prints row counts and timings only; scoring is in recency_score.py.

Output: cache/recency_predictions.pkl
"""
from __future__ import annotations

import sys
import time

import numpy as np
import pandas as pd

from common import CACHE, LANES, LANE_KEY, expit, logit
from fit_predict import FEATURES
from rolling_fit import FIRST_SCHEDULED, SCHEDULED_TESTS, make

KEYS = [LANE_KEY[p] for p in LANES]
ARMS = {"w365": 365.0, "w180": 180.0}


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    # Local caches written by this folder's own scripts.
    df = pd.read_pickle(CACHE / "dataset.pkl")
    params = {p: pd.read_pickle(CACHE / "fit_meta.pkl")["lanes"][p]["best_params"] for p in LANES}
    df = df[df.anchor_kind.notna()].copy().reset_index(drop=True)
    df["is_by"] = df["is_by"].astype(bool)
    test = (df.is_by & (df.date > FIRST_SCHEDULED)) | (~df.is_by & df.date.isin(SCHEDULED_TESTS))
    dates = sorted(set(df.date[test]))
    if limit:
        dates = dates[:limit]
    raw = {f"{a}_{k}": np.full(len(df), np.nan) for a in ARMS for k in KEYS}
    t0 = time.time()
    for n, T in enumerate(dates):
        idx = df.index[test & (df.date == T)]
        rows = df.loc[idx]
        train = df[df.date < T]
        age = (pd.Timestamp(T) - train["d"]).dt.days.to_numpy().astype(float)
        for p in LANES:
            k = LANE_KEY[p]
            m = train[f"stood_{k}"].to_numpy().astype(bool)
            stood = rows[f"stood_{k}"].to_numpy().astype(bool)
            if m.sum() < 50 or not stood.any():
                continue
            t = train[m]
            X = t[FEATURES].astype(float).to_numpy()
            y = logit(t[f"s_{k}"]) - logit(t[f"a_{k}"])
            Xr = rows.loc[stood, FEATURES].astype(float).to_numpy()
            a = np.asarray(logit(rows.loc[stood, f"a_{k}"]))
            for arm, half in ARMS.items():
                model = make(params[p], FEATURES).fit(X, y, sample_weight=0.5 ** (age[m] / half))
                v = np.full(len(rows), np.nan)
                v[stood] = expit(a + model.predict(Xr))
                raw[f"{arm}_{k}"][idx] = v
        if n % 10 == 0:
            print(f"  {T} rows {len(rows)} elapsed {time.time()-t0:.0f}s", flush=True)
    out = df.copy()
    for arm in ARMS:
        r = pd.DataFrame({k: np.nan_to_num(raw[f"{arm}_{k}"]) for k in KEYS})
        tot = r.sum(axis=1)
        for k in KEYS:
            out[f"{arm}_{k}"] = np.where(tot > 0, r[k] / tot.replace(0, np.nan), np.nan)
    out = out[test & out[[f"w365_{k}" for k in KEYS]].notna().any(axis=1)]
    roll = pd.read_pickle(CACHE / "rolling_predictions.pkl")[["ballot_paper_id"] + [f"s1_{k}" for k in KEYS]]
    out = out.merge(roll, on="ballot_paper_id", how="left", validate="one_to_one")
    out.to_pickle(CACHE / ("recency_predictions.pkl" if not limit else "recency_predictions.partial.pkl"))
    print(f"wrote {len(out)} rows in {time.time()-t0:.0f}s; rows without an S1 forecast {int(out[[f's1_{k}' for k in KEYS]].isna().all(axis=1).sum())}")


if __name__ == "__main__":
    main()
