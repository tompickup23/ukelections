"""By-election level and standing rates (BRIDGE_LEVEL_SPEC.md): poll anchors for
every contest dated from 4 July 2024 to 30 April 2025, which the stage B
dataset left on the July 2024 general election result (July to December 2024)
or blank (January to mid April 2025), because the repo held no polls between
4 July 2024 and 15 April 2025.

Polls, all made by scripts/extract-wikipedia-polls.mjs:
  data/polling/wikipedia/westminster-2019-12-13-to-2024-07-04.json    (stage A)
  bridge_level_polls_2024-07-05_to_2025-04-14.json                     (this study)
  data/polling/wikipedia/westminster-2025-04-15-to-2026-04-25.json    (committed)
The new extract comes from revision 1383556886 of "Opinion polling for the next
United Kingdom general election", the same revision as the committed 2025 to
2026 file, which the extractor reproduces byte for byte from it.

Anchor rule: stage B's (backtest_b_anchor.window_anchor), 14 day window, then
21 day, at least 3 polls carrying each lane, GB and UK pooled, duplicates and
multi-row poll rows dropped, no anchor estimated. Rows dated from 1 May 2025
keep the anchor in the stage B dataset. Nothing else changes.

Input: cache/backtest_b_dataset.pkl (this folder's cache, copied read only from
the stage B worktree)
Output: cache/bridge_level_dataset.pkl, cache/bridge_level_anchor_report.json
"""
from __future__ import annotations

import json
from collections import Counter
from datetime import date

import numpy as np
import pandas as pd

import backtest_b_anchor as bba
from common import CACHE, HERE, LANES, LANE_KEY, REPO

bba.POLL_FILES = [
    REPO / "data/polling/wikipedia/westminster-2019-12-13-to-2024-07-04.json",
    HERE / "bridge_level_polls_2024-07-05_to_2025-04-14.json",
    REPO / "data/polling/wikipedia/westminster-2025-04-15-to-2026-04-25.json",
]
FROM, TO = "2024-07-04", "2025-05-01"  # rows dated FROM <= date < TO are rebuilt
# Stage B's first fieldwork end with a Brexit Party share. Every date rebuilt here
# is later, so the Reform UK lane is anchored on its own poll share throughout.
R0 = date(2019, 2, 23)


def load_polls():
    """backtest_b_anchor.load_polls without its Brexit Party date search, which
    needs the 2019 files and is replaced by R0."""
    seen, polls, sources, multi = set(), [], [], 0
    for f in bba.POLL_FILES:
        src = json.loads(f.read_text(encoding="utf-8"))
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
            polls.append((date.fromisoformat(p["fieldwork_end"]), s, s.get("Reform UK", s.get("Brexit Party")), p["area"]))
    polls.sort(key=lambda x: x[0])
    return sources, polls, multi


def main():
    # This folder's own cache, copied from the stage B worktree (our own research output, not untrusted data).
    df = pd.read_pickle(CACHE / "backtest_b_dataset.pkl")
    sources, polls, multi = load_polls()
    r0 = R0
    before = df["anchor_kind"].copy()
    mask = (df["date"] >= FROM) & (df["date"] < TO)
    cache = {d: bba.anchor(polls, date.fromisoformat(d), r0) for d in sorted(set(df.loc[mask, "date"]))}
    for i in df.index[mask]:
        wa = cache[df.at[i, "date"]]
        a = wa[1] if wa else None
        df.at[i, "anchor_kind"] = f"polls_{wa[0]}d_bridge_level" if wa else None
        for p in LANES:
            df.at[i, f"a_{LANE_KEY[p]}"] = a[p] if a else np.nan
    df.to_pickle(CACHE / "bridge_level_dataset.pkl")

    win = df[mask]
    report = {
        "poll_sources": sources,
        "multi_row_poll_rows_dropped": multi,
        "polls_after_dedupe": len(polls),
        "rows_rebuilt": int(mask.sum()),
        "rows_rebuilt_by_previous_kind": {str(k): int(v) for k, v in before[mask].value_counts(dropna=False).items()},
        "rows_rebuilt_by_new_kind": {str(k): int(v) for k, v in win.anchor_kind.value_counts(dropna=False).items()},
        "contest_dates_without_anchor": [d for d, a in cache.items() if a is None],
        "dates_on_21_day_window": [d for d, a in cache.items() if a and a[0] == 21],
        "anchored_by_month": {k: int(v) for k, v in win[win.anchor_kind.notna()].groupby(win.date.str[:7]).size().items()},
        "rows_by_month": {k: int(v) for k, v in win.groupby(win.date.str[:7]).size().items()},
        "polls_by_month_in_window": dict(sorted(Counter(d.isoformat()[:7] for d, *_ in polls if FROM <= d.isoformat() < TO).items())),
    }
    print(json.dumps(report, indent=1, default=str))
    with open(CACHE / "bridge_level_anchor_report.json", "w") as f:
        json.dump(report, f, indent=1, default=str)


if __name__ == "__main__":
    main()
