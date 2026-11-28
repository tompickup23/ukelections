"""Inventory for the estate series check (ESTATE_SPEC.md, step 1).

Computes no residual. For each candidate measure: what it counts, its source
and edition, which dated value is used for each election, and how many of the
districts with scored wards at that election it covers. Also reports how wards
were placed in districts and the council slug to authority code join.

Output: results/estate_inventory.json
"""
from __future__ import annotations

import json
from collections import Counter

from common import OUT
from estate_common import ELECTIONS, MEASURES, PLACES, SOURCES, build_measures, place_rows, rj, scheduled_rows


def main():
    df = scheduled_rows()
    df["lad"], df["rule"] = place_rows(df)
    vals, prov = build_measures()
    places = rj(PLACES)
    slugs = {v["slug"]: k for k, v in places.items()}

    out = {"elections": {}, "measures": {}, "placement": {}, "slug_join": {}}
    for T, role in ELECTIONS.items():
        x = df[df.date == T]
        lads = sorted(set(x.lad.dropna()))
        out["elections"][T] = {"role": role, "scored_wards": int(len(x)), "districts_with_wards": len(lads),
                               "councils": int(x.council.nunique())}
        out["placement"][T] = dict(Counter(x.rule))
        cs = sorted(x.council.unique())
        un = [c for c in cs if c not in slugs]
        out["slug_join"][T] = {"councils": len(cs), "matched_to_places_json": len(cs) - len(un), "unmatched": un}
        for m, label, fam in MEASURES:
            v = vals[m][T]
            cov = [l for l in lads if l in v]
            out["measures"].setdefault(m, {"label": label, "family": fam, "source": SOURCES[m], "by_election": {}})
            out["measures"][m]["by_election"][T] = {"value_used": prov[m][T], "districts_covered": len(cov),
                                                    "of_districts_with_wards": len(lads),
                                                    "missing": [l for l in lads if l not in v] if 0 < len(cov) < len(lads) else []}
    OUT.mkdir(exist_ok=True)
    (OUT / "estate_inventory.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    for T in ELECTIONS:
        print(T, out["elections"][T], out["placement"][T])
        print("  slug join", out["slug_join"][T])
        for m in out["measures"]:
            b = out["measures"][m]["by_election"][T]
            print(f"  {m:20s} {b['districts_covered']:4d}/{b['of_districts_with_wards']:<4d} {b['value_used']}  missing={b['missing'][:8]}")


if __name__ == "__main__":
    main()
