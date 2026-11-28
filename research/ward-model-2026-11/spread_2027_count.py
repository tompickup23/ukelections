"""Count the May 2027 wards with a previous Reform UK result in the same ward
(SPREAD_RESULTS.md, "What this means for May 2027"). A count, not a score.

  uv run python spread_2027_count.py

Input (repo files, committed): data/identity/wards-2027.json,
data/identity/wards-2027-baselines.json, data/results/may-2026/local-and-mayor.merged.json
Output: results/spread_2027_count.json
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict

from common import HERE, OUT

REPO = HERE.parent.parent
REF = "Reform UK"


def main():
    wards = {w["id"]: w for w in json.loads((REPO / "data/identity/wards-2027.json").read_text())["wards"]}
    base = json.loads((REPO / "data/identity/wards-2027-baselines.json").read_text())["wards"]
    merged = json.loads((REPO / "data/results/may-2026/local-and-mayor.merged.json").read_text())["by_ballot"]

    cells = defaultdict(lambda: {"wards": 0, "wards_with_seats_up": 0, "seats_up": 0})
    check = Counter()
    for b in base:
        w = wards[b["id"]]
        bl = b.get("baseline")
        if not bl:
            kind = "no_baseline"
        elif bl["date"] == "2026-05-07":
            rec = merged.get(bl["ballot_paper_id"])
            stood_merged = bool(rec) and any(c.get("party_canonical") == REF for c in rec["candidates"])
            stood_base = bl["pooled"].get(REF, 0) > 0
            check["may2026_baseline_in_merged" if rec else "may2026_baseline_not_in_merged"] += 1
            check["reform_agrees" if stood_merged == stood_base else "reform_disagrees"] += 1
            kind = "may_2026_reform_stood" if stood_base else "may_2026_reform_absent"
        else:
            kind = f"{bl['date'][:4]}_reform_stood" if bl["pooled"].get(REF, 0) > 0 else f"{bl['date'][:4]}_reform_absent"
        # A by-election since the baseline would be the model's latest contest (prev_rel_* rule).
        lb = b.get("last_by_election")
        by_after = bool(lb and bl and lb["date"] > bl["date"])
        by_ref = bool(by_after and lb["shares"].get(REF, 0) > 0)
        for key in [(w["block"], kind), ("all", kind)]:
            c = cells[key]
            c["wards"] += 1
            up = w.get("seats_up") or 0
            if up:
                c["wards_with_seats_up"] += 1
                c["seats_up"] += up
            c["later_by_election"] = c.get("later_by_election", 0) + int(by_after)
            c["later_by_election_reform_stood"] = c.get("later_by_election_reform_stood", 0) + int(by_ref)

    out = {"inputs": ["data/identity/wards-2027.json", "data/identity/wards-2027-baselines.json",
                      "data/results/may-2026/local-and-mayor.merged.json"],
           "counted": "Wards listed for 6 May 2027, by their baseline: the ward's own last ordinary result on the same "
                      "boundaries (same ONS code), from wards-2027-baselines.json. 'Reform UK stood' means Reform UK has a "
                      "share above zero in that baseline; for 7 May 2026 baselines the merged results file is checked too. "
                      "seats_up sums each ward's seats up in 2027, a count of seats, not wards. later_by_election counts "
                      "wards whose most recent by-election on current boundaries postdates the baseline.",
           "may_2026_cross_check": dict(check),
           "cells": {f"{blk}|{kind}": v for (blk, kind), v in sorted(cells.items())}}
    OUT.mkdir(exist_ok=True)
    (OUT / "spread_2027_count.json").write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
