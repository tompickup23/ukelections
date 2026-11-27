"""Rolling forecasts for OTHERS_SPLIT_SPEC.md: R1 (Others split into Independent
and Minor), R2 (short-memory by-election correction on S1) and R3 (both).

Prints row counts and timings only; scoring is in split_score.py.

Output: cache/split_predictions.pkl
"""
from __future__ import annotations

import glob
import sys
import time

import numpy as np
import pandas as pd

from common import BYELECTION_DIR, CACHE, DC_HISTORY, LANES, LANE_KEY, MAJOR, MAY26_ACTUALS, expit, logit, read_json
from fit_predict import FEATURES
from rolling_fit import FIRST_SCHEDULED, SCHEDULED_TESTS, SHRINK_N, make

KEYS6 = [LANE_KEY[p] for p in LANES]
KEYS7 = ["ref", "lab", "con", "ld", "grn", "ind", "min"]
SHORT_HALF_LIFE = 90.0

FEATURES7 = []
for f in FEATURES:
    if f == "stood_oth":
        FEATURES7 += ["stood_ind", "stood_min"]
    elif f == "prev_rel_oth":
        FEATURES7 += ["prev_rel_ind", "prev_rel_min"]
    elif f == "n_standing":
        FEATURES7.append("n_standing7")
    else:
        FEATURES7.append(f)


def split_others(df: pd.DataFrame) -> pd.DataFrame:
    """Independent and Minor shares and standing flags for every row, from the same sources prepare.py used."""
    hb = read_json(DC_HISTORY)["by_ballot"]
    may = read_json(MAY26_ACTUALS)["by_ballot"]
    files = {}
    for path in glob.glob(str(BYELECTION_DIR / "*.json")):
        if not path.endswith("_meta.json"):
            d = read_json(path)
            files[d["contest"]["ballot_paper_id"]] = d
    s_ind, s_min, st_ind, st_min = [], [], [], []
    for bid, source, sset in zip(df.ballot_paper_id, df.source, df.set):
        ind = mn = 0.0
        si = sm = False
        if source == "byelection_file":
            d = files[bid]
            for party, v in d["result"]["shares"].items():
                if party in MAJOR:
                    continue
                if party == "Independent":
                    ind += v or 0
                else:
                    mn += v or 0
            for c in d["field"]["candidates"]:
                party = c.get("party") or ""
                if party in MAJOR:
                    continue
                if party == "Independent":
                    si = True
                else:
                    sm = True
        elif source == "may26":
            b = may[bid]
            cands = b["candidates"]
            tot = sum(float(c["votes"]) for c in cands)
            for c in cands:
                party = c.get("party_canonical") or ""
                if party in MAJOR:
                    continue
                if party == "Independent":
                    si = True
                    ind += float(c["votes"]) / tot
                else:
                    sm = True
                    mn += float(c["votes"]) / tot
            if sset == "may26":  # yardstick rows take the yardstick's own vote_shares, as prepare.py does
                ind = mn = 0.0
                for party, v in (b.get("vote_shares") or {}).items():
                    if party in MAJOR:
                        continue
                    if party == "Independent":
                        ind += v or 0
                    else:
                        mn += v or 0
        else:
            cands = hb[bid]["candidates"]
            tot = sum(float(c["votes"]) for c in cands)
            for c in cands:
                name = c.get("party_name")
                from common import dc_lane
                if dc_lane(c) != "Others":
                    continue
                if name == "Independent":
                    si = True
                    ind += float(c["votes"]) / tot
                else:
                    sm = True
                    mn += float(c["votes"]) / tot
        s_ind.append(ind); s_min.append(mn); st_ind.append(si); st_min.append(sm)
    df = df.copy()
    df["s_ind"], df["s_min"], df["stood_ind"], df["stood_min"] = s_ind, s_min, st_ind, st_min
    return df


def add_lags(df: pd.DataFrame) -> pd.DataFrame:
    """prev_rel_ind and prev_rel_min, built as prepare.py builds the six lane lags."""
    hist = df[df["gss"].notna() & (df["gss"] != "")][["gss", "d", "s_ind", "s_min", "stood_ind", "stood_min"]].sort_values("d").copy()
    hist["year"] = hist["d"].dt.year
    by_gss = {g: grp for g, grp in hist.groupby("gss")}
    cache = {}

    def year_mean(year, before):
        key = (year, before if before.year == year else None)
        if key not in cache:
            h = hist[(hist.year == year) & (hist.d < before)]
            cache[key] = {k: float(h.loc[h[f"stood_{k}"], f"s_{k}"].mean()) if h[f"stood_{k}"].any() else np.nan for k in ("ind", "min")}
        return cache[key]

    out = {"ind": [], "min": []}
    for g, dd in zip(df["gss"], df["d"]):
        grp = by_gss.get(g)
        prev = None
        if grp is not None:
            earlier = grp[grp.d < dd]
            if len(earlier):
                prev = earlier.iloc[-1]
        for k in ("ind", "min"):
            if prev is None or not prev[f"stood_{k}"]:
                out[k].append(np.nan)
            else:
                out[k].append(prev[f"s_{k}"] - year_mean(prev.d.year, dd)[k])
    df = df.copy()
    df["prev_rel_ind"], df["prev_rel_min"] = out["ind"], out["min"]
    return df


def short_memory(frame: pd.DataFrame, prefix: str, out_prefix: str) -> pd.DataFrame:
    """Add each lane's recency-weighted mean error at earlier by-elections to this arm's by-election forecasts."""
    frame = frame.sort_values("date").copy()
    by = frame.is_by.to_numpy()
    dates = frame.d.to_numpy()
    new = {k: frame[f"{prefix}_{k}"].to_numpy().copy() for k in KEYS6}
    err = {}
    for k in KEYS6:
        f = frame[f"{prefix}_{k}"].to_numpy()
        ok = by & frame[f"stood_{k}"].to_numpy().astype(bool) & (f > 0)
        e = np.full(len(frame), np.nan)
        e[ok] = np.asarray(logit(frame[f"s_{k}"].to_numpy()[ok])) - np.asarray(logit(f[ok]))
        err[k] = e
    for T in np.unique(dates[by]):
        today = by & (dates == T)
        earlier = by & (dates < T)
        age = (T - dates[earlier]).astype("timedelta64[D]").astype(float)
        w_all = 0.5 ** (age / SHORT_HALF_LIFE)
        for k in KEYS6:
            e = err[k][earlier]
            ok = ~np.isnan(e)
            n = w_all[ok].sum()
            corr = float((w_all[ok] * e[ok]).sum() / n * n / (n + SHRINK_N)) if n > 0 else 0.0
            f = frame[f"{prefix}_{k}"].to_numpy()[today]
            live = f > 0
            adj = f.copy()
            adj[live] = expit(np.asarray(logit(f[live])) + corr)
            new[k][today] = adj
    tot = np.sum([np.nan_to_num(new[k]) for k in KEYS6], axis=0)
    for k in KEYS6:
        frame[f"{out_prefix}_{k}"] = np.where(tot > 0, np.nan_to_num(new[k]) / np.where(tot > 0, tot, 1), np.nan)
    return frame


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    # Local caches written by this folder's own scripts.
    full = pd.read_pickle(CACHE / "dataset.pkl")
    params = {p: pd.read_pickle(CACHE / "fit_meta.pkl")["lanes"][p]["best_params"] for p in LANES}
    lane_params = {LANE_KEY[p]: params[p] for p in LANES}
    lane_params["ind"] = lane_params["min"] = params["Others"]

    full = add_lags(split_others(full))
    gap = (full.s_ind + full.s_min - full.s_oth).abs()
    print(f"rows {len(full)}; Independent plus Minor differs from Others by more than 0.0001 on {(gap > 1e-4).sum()} rows; max {gap.max():.6f}")
    df = full[full.anchor_kind.notna()].copy().reset_index(drop=True)
    df["is_by"] = df["is_by"].astype(bool)
    df["a_ind"] = df["a_min"] = df["a_oth"]
    df["n_standing7"] = df[[f"stood_{k}" for k in KEYS7]].astype(bool).sum(axis=1)
    print("standing: independent", int(df.stood_ind.sum()), "minor", int(df.stood_min.sum()), "others", int(df.stood_oth.sum()))

    test = (df.is_by & (df.date > FIRST_SCHEDULED)) | (~df.is_by & df.date.isin(SCHEDULED_TESTS))
    dates = sorted(set(df.date[test]))
    if limit:
        dates = dates[:limit]
    raw = {k: np.full(len(df), np.nan) for k in KEYS7}
    t0 = time.time()
    for n, T in enumerate(dates):
        idx = df.index[test & (df.date == T)]
        rows = df.loc[idx]
        train = df[df.date < T]
        for k in KEYS7:
            t = train[train[f"stood_{k}"].astype(bool)]
            stood = rows[f"stood_{k}"].to_numpy().astype(bool)
            if len(t) < 50 or not stood.any():
                continue
            y = logit(t[f"s_{k}"]) - logit(t[f"a_{k}"])
            m = make(lane_params[k], FEATURES7).fit(t[FEATURES7].astype(float).to_numpy(), y)
            v = np.full(len(rows), np.nan)
            v[stood] = expit(np.asarray(logit(rows.loc[stood, f"a_{k}"])) + m.predict(rows.loc[stood, FEATURES7].astype(float).to_numpy()))
            raw[k][idx] = v
        if n % 10 == 0:
            print(f"  {T} rows {len(rows)} elapsed {time.time()-t0:.0f}s", flush=True)

    r = pd.DataFrame({k: np.nan_to_num(raw[k]) for k in KEYS7})
    tot = r.sum(axis=1)
    for k in KEYS7:
        r[k] = np.where(tot > 0, r[k] / tot.replace(0, np.nan), np.nan)
    for k in ["ref", "lab", "con", "ld", "grn"]:
        df[f"r1_{k}"] = r[k]
    df["r1_oth"] = r["ind"] + r["min"]
    df["r1_ind"], df["r1_min"] = r["ind"], r["min"]
    out = df[test & (tot > 0)].copy()

    roll = pd.read_pickle(CACHE / "rolling_predictions.pkl")[["ballot_paper_id"] + [f"s1_{k}" for k in KEYS6]]
    out = out.merge(roll, on="ballot_paper_id", how="left", validate="one_to_one")
    out = short_memory(out, "s1", "r2")
    out = short_memory(out, "r1", "r3")
    out.to_pickle(CACHE / ("split_predictions.pkl" if not limit else "split_predictions.partial.pkl"))
    print(f"wrote {len(out)} rows in {time.time()-t0:.0f}s; missing S1 for {int(out.s1_ref.isna().sum() if 's1_ref' in out else -1)} rows (lane not standing counts)")


if __name__ == "__main__":
    main()
