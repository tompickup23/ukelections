"""Back-test stage B (BACKTEST_B_SPEC.md): national anchors for every contest
dated from 8 June 2017 to 3 July 2024, and each row's previous contest.

Polls, all made by scripts/extract-wikipedia-polls.mjs:
  cache/pr192/westminster-2017-06-08-to-2017-12-31.json   } PR 192, branch
  cache/pr192/westminster-2018-01-01-to-2019-05-02.json   } claude/data-polls-2017-2019-9876e6,
  cache/pr192/westminster-2019-05-03-to-2019-12-12.json   } not merged; read with git show
  data/polling/wikipedia/westminster-2019-12-13-to-2024-07-04.json   (stage A)

Anchor rule: the 14 day trailing window and the at-least-3-polls test of
prepare.poll_anchor, with one change for the Reform UK lane. Before 23 February
2019, the first fieldwork end with a Brexit Party share, the lane has no anchor
and Others is the remainder after the other four parties. From that date the
lane's share is Reform UK where a poll gives it, otherwise the Brexit Party,
and the lane needs at least 3 polls like the others. Where the 14 day window fails
the test for any lane, the same test is applied to a 21 day window (anchor_kind
polls_21d_stage_b); where that fails too, the anchor is blank. UKIP and Change
UK stay in Others. GB and UK samples are pooled; exact duplicates (date,
pollster, shares) are dropped; rows the extractor marks as one of several rows
of the same poll (row_of_multi_row_poll: alternative question versions, such as
a prompt naming Change UK) are dropped, since nothing marks which is the
headline figure. No anchor is estimated anywhere.

Rows dated from 4 July 2024 keep the anchor in cache/dataset.pkl.

Input: cache/dataset.pkl (copied from the research worktree; written by prepare.py)
Output: cache/backtest_b_dataset.pkl, cache/backtest_b_anchor_report.json
"""
from __future__ import annotations

import json
from collections import Counter
from datetime import date, timedelta

import numpy as np
import pandas as pd

from common import CACHE, LANES, LANE_KEY, REPO, read_json

POLL_FILES = [
    CACHE / "pr192/westminster-2017-06-08-to-2017-12-31.json",
    CACHE / "pr192/westminster-2018-01-01-to-2019-05-02.json",
    CACHE / "pr192/westminster-2019-05-03-to-2019-12-12.json",
    REPO / "data/polling/wikipedia/westminster-2019-12-13-to-2024-07-04.json",
]
FIRST_POLL = "2017-06-08"
GE24 = "2024-07-04"
WINDOWS, MIN_POLLS = (14, 21), 3
FOUR = ["Labour", "Conservative", "Liberal Democrats", "Green Party"]
KEYS = [LANE_KEY[p] for p in LANES]


def load_polls():
    seen, polls, sources = set(), [], []
    multi = 0
    for f in POLL_FILES:
        src = read_json(f)
        sources.append({"file": f.name, **src["source"], "polls": len(src["polls"])})
        for p in src["polls"]:
            if p.get("row_of_multi_row_poll"):
                multi += 1
                continue
            key = (p["fieldwork_end"], p["pollster"], tuple(sorted(p["shares"].items())))
            if key in seen:
                continue
            seen.add(key)
            s = dict(p["shares"])
            ref = s.get("Reform UK", s.get("Brexit Party"))
            polls.append((date.fromisoformat(p["fieldwork_end"]), s, ref, p["area"]))
    polls.sort(key=lambda x: x[0])
    r0 = min(d for d, s, _, _ in polls if "Brexit Party" in s)
    return sources, polls, r0, multi


def anchor(polls, when: date, r0: date):
    """(window days, shares) for the first window that passes, or None."""
    for w in WINDOWS:
        a = window_anchor(polls, when, r0, w)
        if a:
            return w, a
    return None


def window_anchor(polls, when: date, r0: date, window: int):
    lo = when - timedelta(days=window - 1)
    rows = [(s, ref) for d, s, ref, _ in polls if lo <= d <= when]
    if len(rows) < MIN_POLLS:
        return None
    out = {}
    for p in FOUR:
        vals = [s[p] for s, _ in rows if s.get(p) is not None]
        if len(vals) < MIN_POLLS:
            return None
        out[p] = float(np.mean(vals))
    if when >= r0:
        vals = [ref for _, ref in rows if ref is not None]
        if len(vals) < MIN_POLLS:
            return None
        out["Reform UK"] = float(np.mean(vals))
    else:
        out["Reform UK"] = np.nan
    out["Others"] = max(1.0 - sum(v for v in out.values() if not np.isnan(v)), 0.01)
    return out


def main():
    df = pd.read_pickle(CACHE / "dataset.pkl")
    sources, polls, r0, multi = load_polls()
    before = df["anchor_kind"].copy()

    mask = df["date"] < GE24
    cache = {d: (anchor(polls, date.fromisoformat(d), r0) if d >= FIRST_POLL else None) for d in sorted(set(df.loc[mask, "date"]))}
    for i in df.index[mask]:
        wa = cache[df.at[i, "date"]]
        a = wa[1] if wa else None
        df.at[i, "anchor_kind"] = f"polls_{wa[0]}d_stage_b" if wa else None
        for p in LANES:
            df.at[i, f"a_{LANE_KEY[p]}"] = a[p] if a else np.nan

    # Reform UK standing where the lane has no anchor would be a disagreement between results and anchors.
    clash = df[df.anchor_kind.notna() & df.a_ref.isna() & df.stood_ref.astype(bool)]

    cols = ["d", "date", "anchor_kind"] + [f"s_{k}" for k in KEYS] + [f"a_{k}" for k in KEYS]
    hist = df[df["gss"].notna() & (df["gss"] != "")].sort_values("d")
    by_gss = {g: grp[cols] for g, grp in hist.groupby("gss")}
    prev = {f"prev_{c}": [] for c in cols[1:]}
    for g, dd in zip(df["gss"], df["d"]):
        grp = by_gss.get(g)
        row = None
        if grp is not None:
            e = grp[grp.d < dd]
            if len(e):
                row = e.iloc[-1]
        for c in prev:
            prev[c].append(row[c[5:]] if row is not None else None)
    for c, v in prev.items():
        df[c] = v
    df.to_pickle(CACHE / "backtest_b_dataset.pkl")

    y = df["d"].dt.year
    win = df[mask & (df.date >= FIRST_POLL)]
    report = {
        "poll_sources": sources,
        "multi_row_poll_rows_dropped": multi,
        "polls_after_dedupe": len(polls),
        "polls_by_area": dict(Counter(a for *_, a in polls)),
        "reform_lane_first_brexit_party_poll": r0.isoformat(),
        "rows_from_2017_06_08_to_2024_07_03": int(len(win)),
        "of_which_anchored": int(win.anchor_kind.notna().sum()),
        "rows_2024_ge_anchor_replaced": int(((before == "ge2024_result") & mask).sum()),
        "rows_2024_left_without_anchor": int(((before == "ge2024_result") & mask & df.anchor_kind.isna()).sum()),
        "rows_reform_stood_without_lane_anchor": int(len(clash)),
        "first_reform_lane_anchor_date": min(d for d, a in cache.items() if a and not np.isnan(a[1]["Reform UK"])),
        "rows_by_anchor_kind": {str(k): int(v) for k, v in win.anchor_kind.value_counts(dropna=False).items()},
        "dates_on_21_day_window": [d for d, a in cache.items() if a and a[0] == 21],
        "contest_dates_from_2017_06_08_without_anchor": [d for d, a in cache.items() if d >= FIRST_POLL and a is None],
        "anchored_rows_by_year": {int(k): int(v) for k, v in df[df.anchor_kind.notna()].groupby(y).size().items()},
        "anchor_on_scheduled_days": {d: ({"window_days": cache[d][0], **{p: (None if np.isnan(cache[d][1][p]) else round(cache[d][1][p], 4)) for p in LANES}} if cache.get(d) else None)
                                     for d in ["2018-05-03", "2019-05-02", "2021-05-06", "2022-05-05", "2023-05-04"]},
    }
    print(json.dumps(report, indent=1, default=str))
    with open(CACHE / "backtest_b_anchor_report.json", "w") as f:
        json.dump(report, f, indent=1, default=str)


if __name__ == "__main__":
    main()
