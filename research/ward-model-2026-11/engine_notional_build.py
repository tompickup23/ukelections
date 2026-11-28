"""Notional previous result for each bridged ward, by party, for the site engine
(ENGINE_NOTIONAL_SPEC.md). Prints counts only; no forecast is made or scored here.

Output: cache/engine_notional.json
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict

import pandas as pd

from common import CACHE, DC_HISTORY, read_json

MAY26 = "2026-05-07"


def main():
    # Local caches written by this folder's own scripts.
    df = pd.read_pickle(CACHE / "dataset.pkl")
    bridge = pd.read_pickle(CACHE / "bridge.pkl")
    hb = read_json(DC_HISTORY)["by_ballot"]
    target = pd.Timestamp(MAY26)
    hist = df[df["gss"].notna() & (df["gss"] != "") & (df.d < target) & df.ballot_paper_id.isin(hb.keys())].sort_values("d")
    sched = hist[~hist.is_by.astype(bool)].groupby("gss").tail(1).set_index("gss")
    anyc = hist.groupby("gss").tail(1).set_index("gss")

    out, stats = {}, Counter()
    for bid, b in bridge.items():
        res = {}
        for p, w in b["parents"].items():
            row = sched.loc[p] if p in sched.index else (anyc.loc[p] if p in anyc.index else None)
            if row is None:
                continue
            stats["parent results from a scheduled contest" if p in sched.index else "parent results from a by-election only"] += 1
            r = hb[row["ballot_paper_id"]]
            votes = defaultdict(float)
            for c in r["candidates"]:
                name = c.get("party_name") or "Unknown"
                votes["Independent" if "independent" in name.lower() else name] += float(c.get("votes") or 0)
            tot = sum(votes.values())
            if tot <= 0:
                continue
            seats = sum(1 for c in r["candidates"] if c.get("elected")) or 1
            res[p] = {"w": w, "date": r["election_date"], "shares": {k: v / tot for k, v in votes.items()},
                      "ballots": float(r.get("turnout_votes") or tot / seats)}
        cover = sum(v["w"] for v in res.values())
        stats["wards"] += 1
        if cover < 0.5:
            stats["no notional result (cover under half)"] += 1
            continue
        dom = max(res, key=lambda p: res[p]["w"])
        shares = defaultdict(float)
        for v in res.values():
            for k, s in v["shares"].items():
                shares[k] += v["w"] / cover * s
        out[bid] = {
            "council": b["council"], "layer": b["layer"], "date": res[dom]["date"], "cover": cover, "n_parents": len(b["parents"]),
            "ballots": round(sum(v["w"] / cover * v["ballots"] for v in res.values())),
            "shares": dict(sorted(shares.items(), key=lambda kv: -kv[1])),
        }
        stats["with a notional result"] += 1
        stats[f"notional result dated {res[dom]['date'][:4]}"] += 1
    with open(CACHE / "engine_notional.json", "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    for k, v in sorted(stats.items()):
        print(f"{k}: {v}")


if __name__ == "__main__":
    main()
