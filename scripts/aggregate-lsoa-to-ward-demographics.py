#!/usr/bin/env python3
"""P3: Aggregate Census 2021 TS021 + IMD 2019 from LSOA → ward (WD22).

Uses Python's csv module which handles multi-line quoted cells correctly
(unlike the homegrown JS parser).
"""
import csv
import json
import os
from pathlib import Path

ROOT = Path("/Users/tompickup/ukelections")
TS021 = ROOT / ".cache/census/census2021-ts021-lsoa.csv"
LSOA_TO_WARD = ROOT / "data/features/lsoa21-to-ward.json"
IMD = Path("/Users/tompickup/clawd/burnley-council/data/imd2019_cache.json")
OUT = ROOT / "data/features/ward-demographics-2021.json"
IDENTITY = ROOT / "data/identity/wards-may-2026.json"

def normalise(h: str) -> str:
    return " ".join(h.lower().replace("\n", " ").split())

def main():
    with open(TS021) as f:
        reader = csv.reader(f)
        header = next(reader)
        norm = [normalise(h) for h in header]
        cols = {
            "lsoa":  norm.index("geography code"),
            "total": norm.index("ethnic group: total: all usual residents"),
            "asian": norm.index("ethnic group: asian, asian british or asian welsh"),
            "black": norm.index("ethnic group: black, black british, black welsh, caribbean or african"),
            "mixed": norm.index("ethnic group: mixed or multiple ethnic groups"),
            "white_total": norm.index("ethnic group: white"),
            "white_british": norm.index("ethnic group: white: english, welsh, scottish, northern irish or british"),
            "other": norm.index("ethnic group: other ethnic group"),
        }
        print("Column indices:", cols)
        rows = list(reader)
    print(f"Census rows: {len(rows):,}")

    lookup = json.load(open(LSOA_TO_WARD))["lookup"]
    imd = json.load(open(IMD)) if IMD.exists() else {}
    print(f"LSOA→ward lookup: {len(lookup):,} rows; IMD: {len(imd):,} LSOAs")

    agg = {}
    matched = 0
    for row in rows:
        lsoa = row[cols["lsoa"]]
        if not lsoa.startswith("E0"): continue
        ward = lookup.get(lsoa)
        if not ward: continue
        matched += 1
        wd = ward["wd22cd"]
        if wd not in agg:
            agg[wd] = {"total": 0, "asian": 0, "black": 0, "mixed": 0, "white_total": 0, "white_british": 0, "other": 0, "imd_sum": 0, "imd_count": 0, "ward_name": ward["wd22nm"], "lad22cd": ward.get("lad22cd")}
        for k in ("total", "asian", "black", "mixed", "white_total", "white_british", "other"):
            try: agg[wd][k] += int(row[cols[k]])
            except (ValueError, IndexError): pass
        if lsoa in imd and imd[lsoa].get("decile"):
            agg[wd]["imd_sum"] += imd[lsoa]["decile"]
            agg[wd]["imd_count"] += 1
    print(f"LSOAs matched to wards: {matched:,}")
    print(f"Wards aggregated: {len(agg):,}")

    out = {}
    for wd, v in agg.items():
        if v["total"] == 0: continue
        out[wd] = {
            "white_british_pct": round(v["white_british"] / v["total"], 4),
            "asian_pct": round(v["asian"] / v["total"], 4),
            "black_pct": round(v["black"] / v["total"], 4),
            "mixed_pct": round(v["mixed"] / v["total"], 4),
            "white_other_pct": round((v["white_total"] - v["white_british"]) / v["total"], 4),
            "other_pct": round(v["other"] / v["total"], 4),
            "avg_imd_decile": round(v["imd_sum"] / v["imd_count"], 2) if v["imd_count"] > 0 else None,
            "total_residents": v["total"],
            "ward_name": v["ward_name"],
            "lad22cd": v["lad22cd"],
            "_source": "Census 2021 TS021 LSOA→WD22 aggregation + IMD2019 LSOA decile",
        }

    # Coverage vs identity
    identity = json.load(open(IDENTITY))
    targets = [w for w in identity["wards"] if w["tier"] in ("local", "mayor") and w.get("gss_code")]
    covered = [w for w in targets if w["gss_code"] in out]
    print(f"Coverage of May 2026 identity: {len(covered)}/{len(targets)} ({100*len(covered)/len(targets):.1f}%)")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w") as f:
        json.dump({
            "snapshot": {
                "generated_at": "2026-04-25",
                "method": "Census 2021 TS021 (ethnic group) LSOA download from NOMIS, aggregated to WD22 via ONS LSOA21→WD22 lookup. IMD 2019 LSOA decile averaged per ward.",
                "sources": ["NOMIS Census 2021 TS021 LSOA bulk", "ONS LSOA21→WD22 lookup (35,672 rows)", "MHCLG IMD 2019 LSOA"],
            },
            "summary": {
                "ward_count_total": len(out),
                "identity_target_wards": len(targets),
                "identity_target_wards_covered": len(covered),
                "coverage_pct_of_identity": round(100*len(covered)/len(targets), 1),
            },
            "wards": out,
        }, f, indent=2)
    print(f"Wrote {OUT}")

if __name__ == "__main__":
    main()
