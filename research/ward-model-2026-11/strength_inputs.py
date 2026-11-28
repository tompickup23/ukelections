"""Local strength inputs (STRENGTH_SPEC.md). Every input for a row dated T is built
only from dataset contests dated strictly before T, and is defined the same way
for each of the six lanes.

Ward level (arm L1), per lane k, at the ward's previous contest (the latest earlier
contest with the same GSS code, the contest the existing prev_* inputs use):
  prev_top_k     1 if lane k had the largest pooled share, else 0 (NaN with no previous contest)
  prev_rank_k    rank of lane k among the lanes that stood (1 = largest); NaN if k did not stand
  prev_margin_k  lane k's share minus the largest other lane's share, in points; NaN if k did not stand
  prev_seats_k   seats lane k won over seats filled, from the candidates' elected flags; NaN where the
                 previous contest's record has no elected flag or no one elected
  by_top_k       1 if lane k topped the poll at any by-election in the ward dated after the ward's
                 latest earlier scheduled contest (all earlier by-elections if it has none) and before T,
                 0 if there was such a by-election and k never topped one, NaN if there was none
Council level (arm L2), per lane k, over the wards of the same council whose most recent
contest before T is no more than COUNCIL_LOOKBACK_DAYS old, at that most recent contest:
  cou_top_share_k  share of those wards where lane k topped the poll (NaN if there are none)
  cou_top_n_k      count of those wards where lane k topped the poll (NaN if there are none)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from common import DC_HISTORY, LANES, LANE_KEY, MAY26_ACTUALS, dc_lane, pool_party, read_json

KEYS = [LANE_KEY[p] for p in LANES]
COUNCIL_LOOKBACK_DAYS = 2000
WARD = ([f"prev_top_{k}" for k in KEYS] + [f"prev_rank_{k}" for k in KEYS] + [f"prev_margin_{k}" for k in KEYS]
        + [f"prev_seats_{k}" for k in KEYS] + [f"by_top_{k}" for k in KEYS])
COUNCIL = [f"cou_top_share_{k}" for k in KEYS] + [f"cou_top_n_{k}" for k in KEYS]


def leader(shares: np.ndarray, stood: np.ndarray) -> int:
    """Index of the lane with the largest share among lanes that stood (first on ties, lane order)."""
    s = np.where(stood, shares, -np.inf)
    return int(np.argmax(s))


def seats_won() -> dict:
    """ballot_paper_id -> {lane key: seats won} and total seats filled, from elected flags."""
    out = {}
    hist = read_json(DC_HISTORY)["by_ballot"]
    may = read_json(MAY26_ACTUALS)["by_ballot"]
    for src, lane_of in ((hist, dc_lane), (may, lambda c: pool_party(c.get("party_canonical") or ""))):
        for bid, b in src.items():
            won = {k: 0 for k in KEYS}
            n = 0
            for c in b.get("candidates") or []:
                if c.get("elected") is True:
                    won[LANE_KEY[lane_of(c)]] += 1
                    n += 1
            if n > 0 and bid not in out:
                out[bid] = (won, n)
    return out


def build(df: pd.DataFrame) -> pd.DataFrame:
    """Adds WARD and COUNCIL columns to df (index 0..n-1). Returns df."""
    S = df[[f"s_{k}" for k in KEYS]].to_numpy(float)
    ST = df[[f"stood_{k}" for k in KEYS]].to_numpy().astype(bool)
    lead = np.array([leader(S[i], ST[i]) for i in range(len(df))])
    df["_lead"] = lead

    # The previous contest, chosen exactly as backtest_b_anchor.py chose it for prev_*.
    hist = df[df["gss"].notna() & (df["gss"] != "")].sort_values("d")
    by_gss = {g: grp for g, grp in hist.groupby("gss")}
    prev_idx = np.full(len(df), -1)
    for i, (g, dd) in enumerate(zip(df["gss"], df["d"])):
        grp = by_gss.get(g)
        if grp is not None:
            e = grp[grp.d < dd]
            if len(e):
                prev_idx[i] = e.index[-1]
    has = prev_idx >= 0
    # Same previous contest as the existing prev_date column.
    pd_check = pd.Series(np.where(has, df["date"].to_numpy()[np.maximum(prev_idx, 0)], None))
    assert (pd_check.fillna("") == df["prev_date"].astype(object).where(df["prev_date"].notna(), "").astype(str).str[:10]).all()

    won = seats_won()
    cols = {c: np.full(len(df), np.nan) for c in WARD}
    for i in np.flatnonzero(has):
        j = prev_idx[i]
        s, st = S[j], ST[j]
        L = lead[j]
        order = sorted([m for m in range(len(KEYS)) if st[m]], key=lambda m: -s[m])
        w = won.get(df.at[j, "ballot_paper_id"])
        for m, k in enumerate(KEYS):
            cols[f"prev_top_{k}"][i] = 1.0 if m == L else 0.0
            if st[m]:
                cols[f"prev_rank_{k}"][i] = order.index(m) + 1
                other = max((s[o] for o in range(len(KEYS)) if o != m and st[o]), default=0.0)
                cols[f"prev_margin_{k}"][i] = 100.0 * (s[m] - other)
            if w is not None:
                cols[f"prev_seats_{k}"][i] = w[0][k] / w[1]

    # By-elections since the ward's latest earlier scheduled contest.
    isby = df["is_by"].astype(bool).to_numpy()
    for i, (g, dd) in enumerate(zip(df["gss"], df["d"])):
        grp = by_gss.get(g)
        if grp is None:
            continue
        e = grp[grp.d < dd]
        if not len(e):
            continue
        sched = e[~isby[e.index]]
        start = sched.d.max() if len(sched) else pd.Timestamp.min
        bys = e[isby[e.index] & (e.d > start).to_numpy()]
        if not len(bys):
            continue
        tops = set(lead[bys.index])
        for m, k in enumerate(KEYS):
            cols[f"by_top_{k}"][i] = 1.0 if m in tops else 0.0
    for c, v in cols.items():
        df[c] = v

    # Council level: each ward's most recent earlier contest within the lookback.
    cc = {c: np.full(len(df), np.nan) for c in COUNCIL}
    for council, grp in df.groupby("council"):
        g2 = grp.sort_values("d")
        for dd in sorted(set(grp["d"])):
            e = g2[g2.d < dd]
            if not len(e):
                continue
            latest = e.groupby("gss").tail(1)  # sorted by date, so the last row per ward is its latest
            latest = latest[(dd - latest.d).dt.days <= COUNCIL_LOOKBACK_DAYS]
            if not len(latest):
                continue
            cnt = np.bincount(lead[latest.index], minlength=len(KEYS))
            rows = grp.index[grp.d == dd]
            for m, k in enumerate(KEYS):
                cc[f"cou_top_n_{k}"][rows] = cnt[m]
                cc[f"cou_top_share_{k}"][rows] = cnt[m] / len(latest)
    for c, v in cc.items():
        df[c] = v
    return df.drop(columns="_lead")
