"""Actual seats by party lane, seats up and previous contest seats for every
scheduled ward forecast in the by-election level study (SEATS_SPEC.md, step 1).

Research only. Reads no forecast column except to decide which rows have a
forecast; prints coverage only, no score.

Inputs:
  cache/bridge_level_predictions.pkl                   (this folder's own cache, read only)
  data/history/dc-historic-results.json                candidate records with elected flags, 2016 to 2025
  data/results/may-2026/local-and-mayor.merged.json    May 2026 winners
Outputs:
  results/seats_actual_wards.csv   one row per scored ward
  results/seats_coverage.json      coverage per election
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict

import pandas as pd

from common import CACHE, DC_HISTORY, LANES, LANE_KEY, MAY26_ACTUALS, OUT, dc_lane, pool_party, read_json

SCHEDULED = ["2019-05-02", "2021-05-06", "2022-05-05", "2023-05-04", "2025-05-01", "2026-05-07"]
KEYS = [LANE_KEY[p] for p in LANES]


def ward_key(bid: str) -> tuple[str, str]:
    """local.<council>.<ward>.<date> to (council, ward)."""
    parts = bid.split(".")
    return parts[1], ".".join(parts[2:-1])


def main():
    hb = read_json(DC_HISTORY)["by_ballot"]
    may = read_json(MAY26_ACTUALS)["by_ballot"]
    # This folder's own cache, written by bridge_level_fit.py (our research output, not untrusted data).
    pred = pd.read_pickle(CACHE / "bridge_level_predictions.pkl")
    pred = pred[~pred.is_by.astype(bool) & pred.date.isin(SCHEDULED)].copy()

    # National anchor per date, from the dataset's own anchored rows (one anchor per date).
    anch = pd.read_pickle(CACHE / "bridge_level_dataset.pkl")
    anch = anch[anch.anchor_kind.notna()].groupby("date")[[f"a_{k}" for k in KEYS]].first()

    # Scheduled DC contests by ward, for the previous contest of the same ward.
    prev_index = defaultdict(list)
    for bid, b in hb.items():
        if not bid.startswith("local.") or b.get("is_by_election"):
            continue
        prev_index[ward_key(bid)].append((b["election_date"], bid))
    for v in prev_index.values():
        v.sort()

    def seats_from_dc(b):
        el = [c for c in b["candidates"] if c.get("elected") is True]
        return Counter(dc_lane(c) for c in el), len(el)

    rows, cov = [], {}
    for d in SCHEDULED:
        sub = pred[pred.date == d]
        c = Counter()
        c["dataset_rows"] = len(sub)
        if d == "2026-05-07":
            allb = [k for k, b in may.items() if k.startswith("local.") and not b.get("is_by_election")]
            c["source_ballots"] = len(allb)
            c["source_seats"] = sum(len(may[k].get("winners") or []) for k in allb)
        else:
            allb = [k for k, b in hb.items() if k.startswith("local.") and k.endswith(d) and not b.get("is_by_election")]
            c["source_ballots"] = len(allb)
            c["source_seats"] = sum(seats_from_dc(hb[k])[1] for k in allb)
        for _, r in sub.iterrows():
            bid = r.ballot_paper_id
            forecast = pd.isna(r.unforecastable)
            if d == "2026-05-07":
                b = may.get(bid)
                w = (b or {}).get("winners") or []
                if not b or not w or b.get("winner_count") != len(w):
                    c["no_known_seats"] += 1
                    continue
                won, up = Counter(pool_party(x.get("party_canonical") or "") for x in w), len(w)
            else:
                b = hb.get(bid)
                if not b:
                    c["no_known_seats"] += 1
                    continue
                won, up = seats_from_dc(b)
                if up == 0:
                    c["no_known_seats"] += 1
                    continue
            if not forecast:
                c["known_seats_no_forecast"] += 1
                c["known_seats_no_forecast_seats"] += up
                continue
            c["scored_wards"] += 1
            c["scored_seats"] += up
            if up > 1:
                c["multi_seat_wards"] += 1
                if len([p for p in won if won[p] > 0]) > 1:
                    c["multi_seat_wards_split"] += 1
            council, ward = ward_key(bid)
            row = {"ballot_paper_id": bid, "date": d, "council": r.council, "seats_up": up}
            for p in LANES:
                row[f"won_{LANE_KEY[p]}"] = int(won.get(p, 0))
            # Previous scheduled contest of the same ward (same council and ward slug), any earlier date.
            earlier = [x for x in prev_index.get((council, ward), []) if x[0] < d]
            row["prev_ballot"] = None
            if earlier:
                pdte, pbid = earlier[-1]
                pwon, pup = seats_from_dc(hb[pbid])
                if pup > 0 and pdte in anch.index:
                    row["prev_ballot"], row["prev_date"], row["prev_seats_up"] = pbid, pdte, pup
                    for p in LANES:
                        row[f"prev_won_{LANE_KEY[p]}"] = int(pwon.get(p, 0))
                    c["with_previous_wards"] += 1
                    c["with_previous_seats"] += up
                elif pup > 0:
                    c["previous_without_anchor"] += 1
            rows.append(row)
        c["previous_dates"] = dict(Counter(r["prev_date"] for r in rows if r["date"] == d and r.get("prev_ballot")))
        cov[d] = dict(c)
    out = pd.DataFrame(rows)
    OUT.mkdir(exist_ok=True)
    out.to_csv(OUT / "seats_actual_wards.csv", index=False)
    with open(OUT / "seats_coverage.json", "w", encoding="utf-8") as f:
        json.dump(cov, f, indent=1)
    print(json.dumps(cov, indent=1))
    print("anchors available on dates:", list(anch.index[anch.index < "2019-06-01"]))


if __name__ == "__main__":
    main()
