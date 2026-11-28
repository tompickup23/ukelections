"""Reform UK ward signals (SPREAD_SPEC.md): forward only forecasts under C2
(reproduction), S1 (GE2024 ward inputs from the August 2024 cut) and S2
(council Reform UK inputs at every cut), on the corrected inputs.

  uv run python spread_fit.py

Same cuts, settings, minimum rows and renormalisation as bridge_level_fit.py.
Stops before writing anything if the refitted C2 offsets differ from the cached
ones. Prints row counts and timings only; scoring is in spread_score.py.

Input: cache/rebuild/corrected/bridge_level_dataset.pkl, cache/rebuild/corrected/fit_meta.pkl,
cache/rebuild/corrected/bridge_level_predictions.pkl (this folder's own research
caches, hash checked; not untrusted data)
Output: cache/spread/spread_predictions.pkl, cache/spread/spread_run.json
"""
from __future__ import annotations

import json
import sys
import time

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from threadpoolctl import threadpool_limits

from bridge_level_fit import FEATS, KEYS, MIN_ROWS, SCHEDULED, BY_FROM, BY_TO, renorm, standing_inputs
from common import CACHE, LANES, LANE_KEY, expit, logit, sha256
from rolling_fit import make
from spread_diagnose import HASH, DATA, META, PRED

OUTDIR = CACHE / "spread"
GE24 = ["ge24_reform", "ge24_labour", "ge24_con", "nb_ge24_reform"]
COU = ["cou_ref_prev_off", "cou_ref_prev_stand", "cou_ref_prev_age"]
S1_FROM = "2024-08-01"
ARM_FEATS = {"c2": FEATS["c2"], "s1": FEATS["c2"] + GE24, "s2": FEATS["c2"] + COU}


def council_reform_inputs(df: pd.DataFrame) -> pd.DataFrame:
    """S2's three inputs: council's Reform UK offset at its latest earlier scheduled day where Reform UK stood."""
    sch = df[~df.is_by]
    day = sch.groupby(["council", "date"]).agg(rows=("stood_ref", "size"), stood=("stood_ref", "sum"))
    st = sch[sch.stood_ref.astype(bool)]
    day["mean_share"] = st.groupby(["council", "date"]).s_ref.mean()
    day["anchor"] = sch.groupby(["council", "date"]).a_ref.first()
    day = day[(day.stood > 0) & day.anchor.notna() & day.mean_share.notna()].reset_index()
    day["off"] = np.asarray(logit(day.mean_share)) - np.asarray(logit(day.anchor))
    day["stand"] = day.stood / day.rows
    day["d_prev"] = pd.to_datetime(day.date)
    day = day.sort_values("d_prev")
    left = df[["council", "d"]].reset_index().sort_values("d")
    m = pd.merge_asof(left, day[["council", "d_prev", "off", "stand"]], left_on="d", right_on="d_prev",
                      by="council", allow_exact_matches=False, direction="backward").set_index("index").sort_index()
    df["cou_ref_prev_off"] = m["off"].astype(float)
    df["cou_ref_prev_stand"] = m["stand"].astype(float)
    df["cou_ref_prev_age"] = ((m["d"] - m["d_prev"]).dt.days / 365.25).astype(float)
    return df


def fit_cut(params, X, cols, y, train_idx, test_idx, arms):
    Xt = X[train_idx].copy()
    Xt[:, np.isnan(Xt).all(axis=0)] = 0.0  # as bridge_level_fit: a column never split leaves forecasts as they are
    Xp = X[test_idx]
    out = {}
    with threadpool_limits(1):
        for arm in arms:
            j = [cols.index(f) for f in ARM_FEATS[arm]]
            out[arm] = make(params, ARM_FEATS[arm]).fit(Xt[:, j], y[train_idx]).predict(Xp[:, j])
    return out


def main():
    t0 = time.time()
    for p, want in HASH.items():
        if sha256(p) != want:
            sys.exit(f"STOP: {p} does not match its hash")
    df = pd.read_pickle(DATA).reset_index(drop=True)
    params = {p: pd.read_pickle(META)["lanes"][p]["best_params"] for p in LANES}
    df["is_by"] = df["is_by"].astype(bool)
    df = standing_inputs(df)
    df = council_reform_inputs(df)
    anch = df.anchor_kind.notna().to_numpy()

    test = (~df.is_by & df.date.isin(SCHEDULED)) | (df.is_by & (df.date >= BY_FROM) & (df.date < BY_TO))
    cut = pd.Series(np.where(df.date.isin(SCHEDULED), df.date, df.date.str[:7] + "-01"), index=df.index)
    df["cut"] = np.where(test, cut, None)
    cuts = sorted(set(df.cut.dropna()))

    cols = list(dict.fromkeys(FEATS["c2"] + GE24 + COU))
    X = df[cols].astype(float).to_numpy()
    ys = {k: np.asarray(logit(df[f"s_{k}"])) - np.asarray(logit(df[f"a_{k}"])) for k in KEYS}
    stood = {k: df[f"stood_{k}"].to_numpy().astype(bool) for k in KEYS}

    jobs, meta, fitted = [], [], {}
    for c in cuts:
        rows = np.flatnonzero((df.cut == c).to_numpy() & anch)
        before = anch & (df.date < c).to_numpy()
        arms = ["c2", "s2"] + (["s1"] if c >= S1_FROM else [])
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
                meta.append((k, te, arms))

    missing_lane = np.zeros(len(df), dtype=bool)
    for i in np.flatnonzero(test.to_numpy() & anch):
        if any(stood[k][i] and k not in fitted[df.at[i, "cut"]] for k in KEYS):
            missing_lane[i] = True
    ok = test.to_numpy() & anch & ~missing_lane
    cov = {}
    for c in SCHEDULED:
        sel = (df.cut == c).to_numpy() & ~df.is_by.to_numpy()
        cov[c] = {"rows": int(sel.sum()), "cou_ref_prev_off_present": int(df.loc[sel, "cou_ref_prev_off"].notna().sum()),
                  "ge24_reform_present": int(df.loc[sel, "ge24_reform"].notna().sum())}
    print(f"test rows {int(test.sum())}, cuts {len(cuts)}, lane jobs {len(jobs)}; input coverage {json.dumps(cov)}", flush=True)

    t1 = time.time()
    results = Parallel(n_jobs=8, verbose=0)(jobs)
    fit_seconds = time.time() - t1
    print(f"fitted {len(jobs)} lane jobs in {fit_seconds:.0f}s", flush=True)

    off = {f"off_{a}_{k}": np.full(len(df), np.nan) for a in ARM_FEATS for k in KEYS}
    for (k, te, arms), res in zip(meta, results):
        for a in arms:
            off[f"off_{a}_{k}"][te] = res[a]
    # S1 before August 2024 is C2 by definition (SPREAD_SPEC.md)
    early = (df.cut.notna() & (df.cut < S1_FROM)).to_numpy()
    for k in KEYS:
        off[f"off_s1_{k}"][early] = off[f"off_c2_{k}"][early]

    # ---- reproduction check against the cached C2 offsets
    cached = pd.read_pickle(PRED).set_index("ballot_paper_id")
    mine = pd.DataFrame({k: off[f"off_c2_{k}"] for k in KEYS}, index=df.ballot_paper_id)[test.to_numpy()]
    worst = 0.0
    for k in KEYS:
        a, b = mine[k].to_numpy(), cached.loc[mine.index, f"off_c2_{k}"].to_numpy()
        if not np.array_equal(np.isnan(a), np.isnan(b)):
            sys.exit(f"STOP: C2 reproduction differs in which rows lane {k} is forecast")
        d = np.nanmax(np.abs(a - b)) if (~np.isnan(a)).any() else 0.0
        worst = max(worst, float(d))
    if worst > 1e-9:
        sys.exit(f"STOP: C2 reproduction differs from the cached offsets by up to {worst}")
    print(f"C2 reproduction: largest absolute offset difference {worst}", flush=True)

    for c, v in off.items():
        df[c] = v
    a = {k: np.asarray(logit(df[f"a_{k}"])) for k in KEYS}
    for arm in ARM_FEATS:
        raw = {k: expit(a[k] + df[f"off_{arm}_{k}"]) for k in KEYS}
        for k, v in renorm(raw, ok).items():
            df[f"{arm}_{k}"] = v
    no_anchor = test.to_numpy() & ~anch
    df["unforecastable"] = np.where(no_anchor, "no_anchor", np.where(missing_lane, "standing_lane_without_model", None))
    OUTDIR.mkdir(exist_ok=True)
    keep = ["ballot_paper_id", "date", "council", "gss", "is_by", "has_prev", "prev_rel_ref", "unforecastable", "cut"] + \
        [f"{x}_{k}" for x in ("s", "a", "stood") for k in KEYS] + COU + GE24 + \
        [f"{arm}_{k}" for arm in ARM_FEATS for k in KEYS] + [f"off_{arm}_{k}" for arm in ARM_FEATS for k in KEYS]
    df.loc[test.to_numpy(), keep].to_pickle(OUTDIR / "spread_predictions.pkl")
    run = {"fit_seconds": round(fit_seconds), "lane_jobs": len(jobs), "cuts": len(cuts), "s1_from": S1_FROM,
           "c2_reproduction_max_abs_offset_difference": worst, "input_coverage_scheduled": cov,
           "total_seconds": round(time.time() - t0)}
    (OUTDIR / "spread_run.json").write_text(json.dumps(run, indent=1) + "\n")
    print(json.dumps(run))


if __name__ == "__main__":
    main()
