"""Forecast the bridged May 2026 wards with the November model (BRIDGE_SPEC.md).

Prints counts and the reproduction check only. Output: cache/bridge_predictions.pkl
"""
from __future__ import annotations

import csv
from collections import defaultdict

import numpy as np
import pandas as pd

from common import CACHE, LANES, LANE_KEY, MAY26, MAY26_ACTUALS, UNIVERSE, expit, logit, pool_party, read_json
from fit_predict import FEATURES, make
from prepare import FEATURES_NUMERIC, REGIONS, fnum

KEYS = [LANE_KEY[p] for p in LANES]


def main():
    # Local caches written by this folder's own scripts.
    df = pd.read_pickle(CACHE / "dataset.pkl")
    bridge = pd.read_pickle(CACHE / "bridge.pkl")
    fit_meta = pd.read_pickle(CACHE / "fit_meta.pkl")
    stored = pd.read_pickle(CACHE / "predictions.pkl")
    universe = {u["gss"]: u for u in csv.DictReader(open(UNIVERSE, newline=""))}
    may = read_json(MAY26_ACTUALS)["by_ballot"]
    target = pd.Timestamp(MAY26)
    anchor = df[df.set == "may26"].iloc[0]

    hist = df[df["gss"].notna() & (df["gss"] != "") & (df.d < target)].sort_values("d")
    latest = hist.groupby("gss").tail(1).set_index("gss")
    hist_year = hist.assign(year=hist.d.dt.year)
    ym_cache = {}

    def year_mean(year):
        if year not in ym_cache:
            h = hist_year[hist_year.year == year]
            ym_cache[year] = {k: float(h.loc[h[f"stood_{k}"].astype(bool), f"s_{k}"].mean()) if h[f"stood_{k}"].astype(bool).any() else np.nan for k in KEYS}
        return ym_cache[year]

    rows = []
    for bid, b in bridge.items():
        parents = b["parents"]
        row = {"ballot_paper_id": bid, "date": MAY26, "council": b["council"], "gss": b["code"], "is_by": False,
               "layer": b["layer"], "n_parents": len(parents), "result_cover": b["result_cover"]}
        for c in FEATURES_NUMERIC:
            num = den = 0.0
            for p, w in parents.items():
                v = fnum(universe[p].get(c)) if p in universe else np.nan
                if not np.isnan(v):
                    num += w * v
                    den += w
            row[c] = num / den if den > 0 else np.nan
        row["d_total_residents"] = b["population"]
        top_parent = max(parents, key=parents.get)
        row["region"] = universe.get(top_parent, {}).get("region_name")
        row["region_code"] = float(REGIONS.index(row["region"])) if row["region"] in REGIONS else np.nan

        act = defaultdict(float)
        for party, v in (may[bid].get("vote_shares") or {}).items():
            act[pool_party(party)] += v or 0
        stood = defaultdict(bool)
        for c in may[bid]["candidates"]:
            stood[pool_party(c.get("party_canonical") or "")] = True
        for p in LANES:
            k = LANE_KEY[p]
            row[f"s_{k}"] = act.get(p, 0.0)
            row[f"stood_{k}"] = bool(stood.get(p))
            row[f"a_{k}"] = float(anchor[f"a_{k}"])
        row["n_standing"] = sum(row[f"stood_{k}"] for k in KEYS)

        with_result = {p: w for p, w in parents.items() if p in latest.index}
        cover = sum(with_result.values())
        if cover >= 0.5:
            dom = max(with_result, key=with_result.get)
            ym = year_mean(int(latest.at[dom, "d"].year))
            for k in KEYS:
                share = sum(w * float(latest.at[p, f"s_{k}"]) for p, w in with_result.items()) / cover
                row[f"prev_rel_{k}"] = share - ym[k] if share > 0 else np.nan
            row["prev_gap_years"] = (target - latest.at[dom, "d"]).days / 365.25
            row["has_prev"] = 1
        else:
            for k in KEYS:
                row[f"prev_rel_{k}"] = np.nan
            row["prev_gap_years"] = np.nan
            row["has_prev"] = 0
        rows.append(row)
    new = pd.DataFrame(rows)
    print("bridged rows", len(new), "with a notional previous result", int(new.has_prev.sum()), "features missing per row (max)", int(new[FEATURES_NUMERIC].isna().sum(axis=1).max()))

    train = df[df.set == "train"]
    check = df[df.set == "may26"].copy()
    raw_new, raw_chk = {}, {}
    for p in LANES:
        k = LANE_KEY[p]
        t = train[train[f"stood_{k}"]].reset_index(drop=True)
        m = make(fit_meta["lanes"][p]["best_params"]).fit(t[FEATURES].astype(float).to_numpy(), logit(t[f"s_{k}"]) - logit(t[f"a_{k}"]))
        for frame, store in [(new, raw_new), (check, raw_chk)]:
            v = np.zeros(len(frame))
            st = frame[f"stood_{k}"].to_numpy().astype(bool)
            if st.any():
                v[st] = expit(np.asarray(logit(frame.loc[st, f"a_{k}"])) + m.predict(frame.loc[st, FEATURES].astype(float).to_numpy()))
            store[k] = v
    for frame, store in [(new, raw_new), (check, raw_chk)]:
        tot = np.sum([store[k] for k in KEYS], axis=0)
        for k in KEYS:
            frame[f"m_{k}"] = store[k] / tot
    ref = stored[stored.set == "may26"].set_index("ballot_paper_id")
    chk = check.set_index("ballot_paper_id").loc[ref.index]
    diff = max(float((chk[f"m_{k}"] - ref[f"m_{k}"]).abs().max()) for k in KEYS)
    print(f"reproduction check on {len(ref)} stored May 2026 forecasts: largest difference {diff:.2e}")
    assert diff < 1e-9, "refit does not reproduce the November model"
    new.to_pickle(CACHE / "bridge_predictions.pkl")


if __name__ == "__main__":
    main()
