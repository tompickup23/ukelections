"""Back-test stage A (BACKTEST_SPEC.md): national anchors for contests before
4 July 2024, and each test row's previous contest for the two benchmarks.

Polls: data/polling/wikipedia/westminster-2019-12-13-to-2024-07-04.json, made by
scripts/extract-wikipedia-polls.mjs, unchanged, from Wikipedia "Opinion polling
for the 2024 United Kingdom general election", revision 1363820081, with the
saved wikitext cut before the line "==Non-geographical samples==" (the extractor
otherwise also reads the subsample tables: ethnic minority, Muslim, Jewish,
renter, young and GB News voters).

Anchor: poll_anchor() from prepare.py unchanged (14 day trailing mean of polls
by fieldwork end, at least 3 polls carrying each of the five parties, Others the
remainder). GB and UK samples are pooled without distinction, as prepare.py does
with the 2025 series. Exact duplicates (date, pollster, shares) are dropped, as
in prepare.load_polls. No anchor is estimated where the rule finds too few polls.

Rows changed: every row dated before 4 July 2024. Rows from 4 July 2024 on keep
the anchor in cache/dataset.pkl.

Input: cache/dataset.pkl (copied from the research worktree; written by prepare.py)
Output: cache/backtest_dataset.pkl
"""
from __future__ import annotations

import json
from collections import Counter
from datetime import date

import numpy as np
import pandas as pd

from common import CACHE, LANES, LANE_KEY, REPO, read_json
from prepare import poll_anchor

POLLS = REPO / "data/polling/wikipedia/westminster-2019-12-13-to-2024-07-04.json"
GE24 = "2024-07-04"
KEYS = [LANE_KEY[p] for p in LANES]


def load_polls():
    src = read_json(POLLS)
    seen, polls = set(), []
    for p in src["polls"]:
        key = (p["fieldwork_end"], p["pollster"], tuple(sorted(p["shares"].items())))
        if key in seen:
            continue
        seen.add(key)
        polls.append((date.fromisoformat(p["fieldwork_end"]), p["shares"]))
    polls.sort(key=lambda x: x[0])
    return src["source"], polls


def main():
    df = pd.read_pickle(CACHE / "dataset.pkl")
    source, polls = load_polls()
    before = df["anchor_kind"].copy()

    mask = df["date"] < GE24
    cache = {}
    for dstr in sorted(set(df.loc[mask, "date"])):
        cache[dstr] = poll_anchor(polls, date.fromisoformat(dstr))
    for i in df.index[mask]:
        a = cache[df.at[i, "date"]]
        df.at[i, "anchor_kind"] = "polls_14d_2024_page" if a else None
        for p in LANES:
            df.at[i, f"a_{LANE_KEY[p]}"] = a[p] if a else np.nan

    # ---- previous contest in the same GSS area (same rule as prepare.py's lags)
    cols = ["d", "date", "anchor_kind"] + [f"s_{k}" for k in KEYS] + [f"stood_{k}" for k in KEYS] + [f"a_{k}" for k in KEYS]
    hist = df[df["gss"].notna() & (df["gss"] != "")].sort_values("d")
    by_gss = {g: grp[cols] for g, grp in hist.groupby("gss")}
    prev = {f"prev_{c}": [] for c in ["date", "anchor_kind"] + [f"s_{k}" for k in KEYS] + [f"a_{k}" for k in KEYS]}
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

    df.to_pickle(CACHE / "backtest_dataset.pkl")

    y = df["d"].dt.year
    changed_2024 = int(((before == "ge2024_result") & mask).sum())
    lost_2024 = int(((before == "ge2024_result") & mask & df.anchor_kind.isna()).sum())
    unanch = sorted(d for d, a in cache.items() if a is None)
    report = {
        "polls_source": source,
        "polls_after_dedupe": len(polls),
        "polls_by_area": dict(Counter(p["area"] for p in read_json(POLLS)["polls"])),
        "first_poll_with_reform_uk": min(d for d, s in polls if "Reform UK" in s).isoformat(),
        "rows_before_ge24": int(mask.sum()),
        "rows_before_ge24_anchored": int((mask & df.anchor_kind.notna()).sum()),
        "rows_2024_ge_anchor_replaced": changed_2024,
        "rows_2024_left_without_anchor": lost_2024,
        "dates_before_ge24_without_anchor": len(unanch),
        "first_anchored_date": min(d for d, a in cache.items() if a),
        "unanchored_dates_after_2021_01_01": [d for d in unanch if d >= "2021-01-01"],
        "anchored_rows_by_year": {int(k): int(v) for k, v in df[df.anchor_kind.notna()].groupby(y).size().items()},
        "anchor_on_scheduled_days": {d: {p: round(cache[d][p], 4) for p in LANES} if cache.get(d) else None
                                     for d in ["2021-05-06", "2022-05-05", "2023-05-04", "2024-05-02"]},
    }
    print(json.dumps(report, indent=1, default=str))
    with open(CACHE / "backtest_anchor_report.json", "w") as f:
        json.dump(report, f, indent=1, default=str)


if __name__ == "__main__":
    main()
