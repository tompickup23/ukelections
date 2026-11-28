"""Build the research dataset: one row per contest with features, full-slate
targets for six lanes, a national environment anchor and ward lag features.

Inputs (see README for sizes and sha256):
  cache/drive07/ward_contests_v2.csv      features for 19,618 contests 2016-2026
  cache/drive07/universe_features_v2.csv  the same features for 8,175 areas, by GSS
  data/history/dc-historic-results.json   candidate votes for the 17,022 DC contests
  data/results/may-2026/local-and-mayor.merged.json   May 2026 actuals
  data/polling/...                        GB Westminster polls (environment anchor)
  data/contests/local-byelections/*.json  council by-elections after 7 May 2026

The matrix's own share columns are not used as targets: in multi-member wards
they hold the best candidate per party, while the site's yardstick scores the
full slate (every candidate's votes summed). Targets are rebuilt from candidate
votes instead. The matrix supplies features only.

Output: cache/dataset.pkl
"""
from __future__ import annotations

import ast
import csv
import glob
from collections import defaultdict
from datetime import date, timedelta

import numpy as np
import pandas as pd

from common import (
    BYELECTION_DIR, CACHE, DC_HISTORY, LANES, LANE_KEY, MATRIX, MAY26, MAY26_ACTUALS,
    POLLS_2025, POLLS_TS, POSTAUDIT, TRAIN_CUTOFF, UNIVERSE, dc_lane, pool_party,
    read_json, slate_shares,
)

FEATURES_NUMERIC = [
    "d_asian_pct", "d_avg_imd_decile", "d_black_pct", "d_christian_pct", "d_degree_pct",
    "d_eu14_born_pct", "d_eu8_born_pct", "d_ft_students_pct", "d_hindu_pct", "d_mixed_pct",
    "d_muslim_pct", "d_no_quals_pct", "d_no_religion_pct", "d_other_eth_pct",
    "d_owned_mortgage_pct", "d_owned_outright_pct", "d_private_rented_pct", "d_retired_pct",
    "d_sikh_pct", "d_social_rented_pct", "d_total_residents", "d_uk_born_pct",
    "d_white_british_pct", "d_white_other_pct",
    "nssec_higher_mgmt", "nssec_routine", "nssec_never_worked",
    "age_20_34", "age_50_64", "age_65_plus", "no_car", "two_plus_cars",
    "nb_d_degree_pct", "nb_nssec_routine", "nb_no_car", "nb_age_65_plus", "nb_ge24_reform",
    "nb_d_white_british_pct",
    "ge24_reform", "ge24_labour", "ge24_con", "mrp_reform", "mrp_labour", "ukip_council_1316",
]
# ukip_peak_ward is in the training matrix but not in the scoring universe, so it
# is left out everywhere rather than imputed for the by-election test.

REGIONS = [
    "East Midlands", "East of England", "London", "North East", "North West", "South East",
    "South West", "West Midlands", "Yorkshire and The Humber",
]


def fnum(v):
    if v is None or v == "":
        return np.nan
    try:
        return float(v)
    except ValueError:
        return np.nan


def region_from_matrix(v: str) -> str | None:
    try:
        return ast.literal_eval(v).get("region_name")
    except Exception:
        return None


# ---------------------------------------------------------------- anchor ----

def ge2024_gb_shares(history: dict) -> dict:
    """GB vote shares at GE2024 from the 650 DC parliamentary ballots.
    A ballot counts as GB when Labour stood (Labour stands in every GB seat
    but the Speaker's and in no Northern Ireland seat)."""
    votes = defaultdict(float)
    n = 0
    for k, b in history["by_ballot"].items():
        if not (k.startswith("parl.") and k.endswith("2024-07-04")):
            continue
        lanes = [dc_lane(c) for c in b["candidates"]]
        if "Labour" not in lanes:
            continue
        n += 1
        for c, p in zip(b["candidates"], lanes):
            votes[p] += float(c["votes"] or 0)
    tot = sum(votes.values())
    return {"ballots": n, "shares": {p: votes[p] / tot for p in LANES}}


def load_polls() -> list[tuple[date, dict]]:
    out = {}
    for p in read_json(POLLS_2025)["polls"]:
        d = date.fromisoformat(p["fieldwork_end"])
        out[(d, p["pollster"], p.get("client"), tuple(sorted(p["shares"].items())))] = (d, p["shares"])
    for p in read_json(POLLS_TS)["polls"]:
        d = date.fromisoformat(p["date"])
        out[(d, p["pollster"], None, tuple(sorted(p["shares"].items())))] = (d, p["shares"])
    # The two files overlap from January 2026; drop exact duplicates by date, pollster and shares.
    seen = set()
    polls = []
    for (d, pollster, _client, shares), v in sorted(out.items(), key=lambda kv: kv[0][0]):
        key = (d, pollster, shares)
        if key in seen:
            continue
        seen.add(key)
        polls.append(v)
    return polls


def poll_anchor(polls, when: date, window=14, min_polls=3, carry_forward=False):
    """14-day trailing mean of GB polls ending on `when`. With carry_forward, a
    date past the end of the polling series uses the last 14-day window that
    was available on the day (used only for the by-election test, because the
    repo's series stops on 8 November 2026)."""
    if carry_forward:
        last = max((d for d, _ in polls if d <= when), default=None)
        if last is not None and (when - last).days <= 21:
            when = last
    lo = when - timedelta(days=window - 1)
    rows = [s for d, s in polls if lo <= d <= when]
    if len(rows) < min_polls:
        return None
    out = {}
    for p in LANES[:-1]:
        vals = [s[p] for s in rows if s.get(p) is not None]
        if len(vals) < min_polls:
            return None
        out[p] = float(np.mean(vals))
    out["Others"] = max(1.0 - sum(out.values()), 0.01)
    return out


# ------------------------------------------------------------------ main ----

def main():
    CACHE.mkdir(exist_ok=True)
    history = read_json(DC_HISTORY)
    hb = history["by_ballot"]
    may = read_json(MAY26_ACTUALS)["by_ballot"]
    postaudit = read_json(POSTAUDIT)
    yard_ids = [r["ballot_paper_id"] for r in postaudit["prereg"]["rows"] if r["ballot_paper_id"].startswith("local.")]

    ge24 = ge2024_gb_shares(history)
    polls = load_polls()

    rows = []
    dropped = defaultdict(int)
    with open(MATRIX, newline="") as f:
        for r in csv.DictReader(f):
            bid = r["ballot_paper_id"]
            if r["source"] == "may26":
                b = may.get(bid)
                if not b or not b.get("candidates"):
                    dropped["may26_no_actuals"] += 1
                    continue
                res = slate_shares(b["candidates"], lambda c: pool_party(c.get("party_canonical") or ""))
            else:
                b = hb.get(bid)
                if not b:
                    dropped["dc_not_in_history"] += 1
                    continue
                res = slate_shares(b["candidates"], dc_lane)
            if res is None:
                dropped["no_votes"] += 1
                continue
            shares, stood = res
            row = {
                "ballot_paper_id": bid, "date": r["date"], "council": r["council_slug"],
                "gss": r["gss"], "is_by": r["is_by"] == "True", "source": r["source"],
                "region": region_from_matrix(r["region"]), "set": None,
            }
            for c in FEATURES_NUMERIC:
                row[c] = fnum(r.get(c))
            for p in LANES:
                k = LANE_KEY[p]
                row[f"s_{k}"] = shares[p]
                row[f"stood_{k}"] = stood[p]
            rows.append(row)

    # May 2026 yardstick wards: replace the matrix's May rows with the yardstick's
    # pooled vote_shares so targets match the scorer exactly.
    df = pd.DataFrame(rows)
    yard = set(yard_ids)
    df.loc[df.ballot_paper_id.isin(yard), "set"] = "may26"
    for i in df.index[df.set == "may26"]:
        b = may[df.at[i, "ballot_paper_id"]]
        pooled = defaultdict(float)
        for party, v in (b.get("vote_shares") or {}).items():
            pooled[pool_party(party)] += v or 0
        for p in LANES:
            df.at[i, f"s_{LANE_KEY[p]}"] = pooled.get(p, 0.0)

    # Post-May by-elections, England, declared: the clean test.
    by_rows = []
    universe = {u["gss"]: u for u in csv.DictReader(open(UNIVERSE, newline=""))}
    by_skipped = defaultdict(list)
    for path in sorted(glob.glob(str(BYELECTION_DIR / "*.json"))):
        if path.endswith("_meta.json"):
            continue
        d = read_json(path)
        c = d["contest"]
        if c.get("territory") != "ENG" or c["polling_day"] <= MAY26:
            continue
        res = d.get("result") or {}
        if d["status"] != "concluded" or not res.get("shares"):
            by_skipped["not_declared"].append(d["slug"])
            continue
        u = universe.get(c.get("ward_gss"))
        if u is None:
            by_skipped["gss_not_in_universe"].append(d["slug"])
            continue
        pooled = defaultdict(float)
        for party, v in res["shares"].items():
            pooled[pool_party(party)] += v or 0
        stood = defaultdict(bool)
        for cand in d["field"]["candidates"]:
            stood[pool_party(cand.get("party") or "")] = True
        fc = d.get("forecast") or {}
        row = {
            "ballot_paper_id": c["ballot_paper_id"], "date": c["polling_day"], "council": c["council_slug"],
            "gss": c["ward_gss"], "is_by": True, "source": "byelection_file", "region": u.get("region_name"),
            "set": "byelection", "slug": d["slug"],
            "site_forecast": fc.get("central"), "site_win_probability": fc.get("win_probability"),
            "prior_result": d.get("prior_result"),
        }
        for col in FEATURES_NUMERIC:
            row[col] = fnum(u.get(col))
        for p in LANES:
            k = LANE_KEY[p]
            row[f"s_{k}"] = pooled.get(p, 0.0)
            row[f"stood_{k}"] = bool(stood.get(p))
        by_rows.append(row)
    df = pd.concat([df, pd.DataFrame(by_rows)], ignore_index=True)

    df["d"] = pd.to_datetime(df["date"])
    df["region_code"] = df["region"].map({r: i for i, r in enumerate(REGIONS)}).astype(float)
    df["n_standing"] = df[[f"stood_{LANE_KEY[p]}" for p in LANES]].sum(axis=1)

    # ---- environment anchor
    anchors = []
    for dstr, sset in zip(df["date"], df["set"]):
        dd = date.fromisoformat(dstr)
        if dd.year == 2024:
            anchors.append(("ge2024_result", ge24["shares"]))
            continue
        a = poll_anchor(polls, dd, carry_forward=(sset == "byelection"))
        anchors.append(("polls_14d", a) if a else (None, None))
    df["anchor_kind"] = [k for k, _ in anchors]
    for p in LANES:
        df[f"a_{LANE_KEY[p]}"] = [a[p] if a else np.nan for _, a in anchors]

    # ---- training set: before May 2026 polling day, with an anchor
    train_mask = (df.set.isna()) & (df["date"] < TRAIN_CUTOFF) & df["anchor_kind"].notna()
    df.loc[train_mask, "set"] = "train"

    # ---- ward lags: the latest earlier contest in the same GSS area
    hist = df[df["gss"].notna() & (df["gss"] != "")][["gss", "d"] + [f"s_{LANE_KEY[p]}" for p in LANES] + [f"stood_{LANE_KEY[p]}" for p in LANES]].copy()
    hist = hist.sort_values("d")
    by_gss = {g: grp for g, grp in hist.groupby("gss")}
    hist["year"] = hist["d"].dt.year

    ym_cache = {}

    def year_mean(year: int, before: pd.Timestamp):
        key = (year, before if before.year == year else None)
        if key not in ym_cache:
            h = hist[(hist.year == year) & (hist.d < before)]
            ym_cache[key] = {
                p: float(h.loc[h[f"stood_{LANE_KEY[p]}"], f"s_{LANE_KEY[p]}"].mean()) if h[f"stood_{LANE_KEY[p]}"].any() else np.nan
                for p in LANES
            }
        return ym_cache[key]

    lag_cols = {f"prev_rel_{LANE_KEY[p]}": [] for p in LANES}
    gap, has_prev = [], []
    for g, dd in zip(df["gss"], df["d"]):
        grp = by_gss.get(g)
        prev = None
        if grp is not None:
            earlier = grp[grp.d < dd]
            if len(earlier):
                prev = earlier.iloc[-1]
        if prev is None:
            for p in LANES:
                lag_cols[f"prev_rel_{LANE_KEY[p]}"].append(np.nan)
            gap.append(np.nan)
            has_prev.append(0)
            continue
        ym = year_mean(prev.d.year, dd)
        for p in LANES:
            k = LANE_KEY[p]
            lag_cols[f"prev_rel_{k}"].append(prev[f"s_{k}"] - ym[p] if prev[f"stood_{k}"] else np.nan)
        gap.append((dd - prev.d).days / 365.25)
        has_prev.append(1)
    for c, v in lag_cols.items():
        df[c] = v
    df["prev_gap_years"] = gap
    df["has_prev"] = has_prev

    df.to_pickle(CACHE / "dataset.pkl")
    meta = {
        "ge2024_gb": ge24,
        "polls_loaded": len(polls),
        "dropped": dict(dropped),
        "byelection_skipped": {k: v for k, v in by_skipped.items()},
        "counts": df["set"].value_counts(dropna=False).to_dict(),
        "train_by_anchor": df[df.set == "train"]["anchor_kind"].value_counts().to_dict(),
        "train_by_year": df[df.set == "train"]["d"].dt.year.value_counts().sort_index().to_dict(),
        "may26_yardstick_wards": len(yard_ids),
        "may26_in_matrix": int((df.set == "may26").sum()),
        "may26_anchor": {p: float(df.loc[df.set == "may26", f"a_{LANE_KEY[p]}"].iloc[0]) for p in LANES},
    }
    pd.to_pickle(meta, CACHE / "dataset_meta.pkl")
    import json
    print(json.dumps(meta, indent=1, default=str))


if __name__ == "__main__":
    main()
