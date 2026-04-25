#!/usr/bin/env python3
"""P3: Aggregate Census 2021 + IMD 2019 from LSOA → ward (WD22).

Adds: TS021 ethnicity, TS030 religion, TS054 tenure, TS066 economic activity,
TS067 qualifications, TS004 country of birth, plus IMD 2019 sub-domains.
"""
import csv, json
from pathlib import Path

ROOT = Path("/Users/tompickup/ukelections")
CENSUS = ROOT / ".cache/census"
# Multi-year LSOA→ward lookups: aggregate using whichever year matches each
# 2026 ward's GSS code (some wards are still on WD22 boundaries, others changed
# in 2023/24/25 ward reviews — we union all four to maximise coverage).
LOOKUP_PATHS = {
    "22": ROOT / "data/features/lsoa21-to-ward.json",
    "23": ROOT / "data/features/lsoa21-to-ward-wd23.json",
    "24": ROOT / "data/features/lsoa21-to-ward-wd24.json",
    "25": ROOT / "data/features/lsoa21-to-ward-wd25.json",
}
IMD = Path("/Users/tompickup/clawd/burnley-council/data/imd2019_cache.json")
OUT = ROOT / "data/features/ward-demographics-2021.json"
IDENTITY = ROOT / "data/identity/wards-may-2026.json"

def normalise(h: str) -> str:
    return " ".join(h.lower().replace("\n", " ").replace(";", " ").split())

# Configure each table: (filename, fields-to-extract dict)
TABLES = {
    "ts021": {
        "file": "census2021-ts021-lsoa.csv",
        "fields": {
            "total": "ethnic group: total: all usual residents",
            "white_british": "ethnic group: white: english, welsh, scottish, northern irish or british",
            "asian": "ethnic group: asian, asian british or asian welsh",
            "black": "ethnic group: black, black british, black welsh, caribbean or african",
            "white_total": "ethnic group: white",
            "mixed": "ethnic group: mixed or multiple ethnic groups",
            "other_eth": "ethnic group: other ethnic group",
        },
    },
    "ts030": {
        "file": "census2021-ts030-lsoa.csv",
        "fields": {
            "religion_total": "religion: total: all usual residents",
            "no_religion": "religion: no religion",
            "christian": "religion: christian",
            "muslim": "religion: muslim",
            "hindu": "religion: hindu",
            "sikh": "religion: sikh",
            "jewish": "religion: jewish",
        },
    },
    "ts054": {
        "file": "census2021-ts054-lsoa.csv",
        "fields": {
            "households_total": "tenure of household: total: all households",
            "owned_outright": "tenure of household: owned: owns outright",
            "owned_mortgage": "tenure of household: owned: owns with a mortgage or loan",
            "social_rented": "tenure of household: social rented",
            "private_rented": "tenure of household: private rented",
        },
    },
    "ts066": {
        "file": "census2021-ts066-lsoa.csv",
        "fields": {
            "ea_total": "economic activity status: total: all usual residents aged 16 years and over",
            "students_ft": "economic activity status: economically active and a full-time student",
            "retired": "economic activity status: economically inactive: retired",
        },
    },
    "ts067": {
        "file": "census2021-ts067-lsoa.csv",
        "fields": {
            "qual_total": "highest level of qualification: total: all usual residents aged 16 years and over",
            "no_quals": "highest level of qualification: no qualifications",
            "level_4_plus": "highest level of qualification: level 4 qualifications and above",
        },
    },
    "ts004": {
        "file": "census2021-ts004-lsoa.csv",
        "fields": {
            "cob_total": "country of birth: total measures: value",
            "uk_born": "country of birth: europe: united kingdom measures: value",
            "eu14_born": "country of birth: europe: eu countries: european union eu14 measures: value",
            "eu8_born": "country of birth: europe: eu countries: european union eu8 measures: value",
        },
    },
}

def load_table(table_key, info):
    path = CENSUS / info["file"]
    if not path.exists():
        print(f"  skip {table_key}: missing {path}")
        return {}
    with open(path) as f:
        reader = csv.reader(f)
        header = next(reader)
        norm = [normalise(h) for h in header]
        # Resolve field positions
        cols = {"lsoa": norm.index("geography code")}
        for key, hdr_norm in info["fields"].items():
            try:
                cols[key] = norm.index(hdr_norm)
            except ValueError:
                # Try a fuzzy match — find the column whose normalised header
                # contains the search text (handles minor formatting drift).
                for i, h in enumerate(norm):
                    if hdr_norm in h:
                        cols[key] = i; break
                else:
                    print(f"    miss: {table_key}.{key} (looking for: {hdr_norm[:60]})")
        out = {}
        for row in reader:
            lsoa = row[cols["lsoa"]]
            if not lsoa.startswith("E0"): continue
            d = {}
            for k, idx in cols.items():
                if k == "lsoa": continue
                try:
                    d[k] = int(row[idx])
                except (ValueError, IndexError):
                    d[k] = 0
            out[lsoa] = d
    print(f"  loaded {table_key}: {len(out):,} LSOAs, {len(cols)-1} fields")
    return out

def main():
    print("Loading Census tables...")
    tables = {k: load_table(k, info) for k, info in TABLES.items()}

    print("\nLoading LSOA→ward lookups for years 22/23/24/25 + IMD...")
    lookups = {}  # year → { lsoa → {wdcd, wdnm, ladcd, ladnm} }
    for year, path in LOOKUP_PATHS.items():
        if not path.exists():
            print(f"  skip wd{year}: missing {path}")
            continue
        try:
            data = json.load(open(path))["lookup"]
            # Old-format entries have wd22cd/wd22nm/lad22cd; new format has wdcd/wdnm/ladcd
            normalised = {}
            for lsoa, w in data.items():
                if "wdcd" in w:
                    normalised[lsoa] = {"wdcd": w["wdcd"], "wdnm": w["wdnm"], "ladcd": w["ladcd"], "ladnm": w["ladnm"]}
                else:
                    normalised[lsoa] = {"wdcd": w.get("wd22cd"), "wdnm": w.get("wd22nm"), "ladcd": w.get("lad22cd"), "ladnm": w.get("lad22nm")}
            lookups[year] = normalised
            print(f"  loaded wd{year}: {len(normalised):,} LSOAs")
        except Exception as e:
            print(f"  skip wd{year}: {e}")
    imd = json.load(open(IMD)) if IMD.exists() else {}

    print("Aggregating to ward (one row per (year, ward GSS) pair)...")
    agg = {}
    for year, lookup in lookups.items():
        for lsoa, ward_info in lookup.items():
            wd = ward_info["wdcd"]
            if not wd: continue
            if wd not in agg:
                agg[wd] = {"ward_name": ward_info["wdnm"], "lad22cd": ward_info.get("ladcd"), "wd_year": year, "imd_sum": 0, "imd_count": 0, "totals": {}}
            # IMD
            if lsoa in imd and imd[lsoa].get("decile"):
                agg[wd]["imd_sum"] += imd[lsoa]["decile"]
                agg[wd]["imd_count"] += 1
            # Census tables
            for tkey, lsoa_data in tables.items():
                if lsoa not in lsoa_data: continue
                t = agg[wd]["totals"].setdefault(tkey, {})
                for fname, val in lsoa_data[lsoa].items():
                    t[fname] = t.get(fname, 0) + val
    print(f"Wards aggregated (across all WD years): {len(agg):,}")

    out = {}
    for wd, v in agg.items():
        ts21 = v["totals"].get("ts021", {})
        ts30 = v["totals"].get("ts030", {})
        ts54 = v["totals"].get("ts054", {})
        ts66 = v["totals"].get("ts066", {})
        ts67 = v["totals"].get("ts067", {})
        ts04 = v["totals"].get("ts004", {})
        eth_total = ts21.get("total", 0)
        if eth_total == 0: continue
        rel_total = max(ts30.get("religion_total", 0), 1)
        hh_total = max(ts54.get("households_total", 0), 1)
        ea_total = max(ts66.get("ea_total", 0), 1)
        q_total = max(ts67.get("qual_total", 0), 1)
        cob_total = max(ts04.get("cob_total", 0), 1)
        white_total = ts21.get("white_total", 0)
        out[wd] = {
            "white_british_pct": round(ts21.get("white_british", 0) / eth_total, 4),
            "white_other_pct": round(max(0, white_total - ts21.get("white_british", 0)) / eth_total, 4),
            "asian_pct": round(ts21.get("asian", 0) / eth_total, 4),
            "black_pct": round(ts21.get("black", 0) / eth_total, 4),
            "mixed_pct": round(ts21.get("mixed", 0) / eth_total, 4),
            "other_eth_pct": round(ts21.get("other_eth", 0) / eth_total, 4),
            "muslim_pct": round(ts30.get("muslim", 0) / rel_total, 4) if ts30 else None,
            "christian_pct": round(ts30.get("christian", 0) / rel_total, 4) if ts30 else None,
            "no_religion_pct": round(ts30.get("no_religion", 0) / rel_total, 4) if ts30 else None,
            "hindu_pct": round(ts30.get("hindu", 0) / rel_total, 4) if ts30 else None,
            "sikh_pct": round(ts30.get("sikh", 0) / rel_total, 4) if ts30 else None,
            "owned_outright_pct": round(ts54.get("owned_outright", 0) / hh_total, 4) if ts54 else None,
            "owned_mortgage_pct": round(ts54.get("owned_mortgage", 0) / hh_total, 4) if ts54 else None,
            "social_rented_pct": round(ts54.get("social_rented", 0) / hh_total, 4) if ts54 else None,
            "private_rented_pct": round(ts54.get("private_rented", 0) / hh_total, 4) if ts54 else None,
            "ft_students_pct": round(ts66.get("students_ft", 0) / ea_total, 4) if ts66 else None,
            "retired_pct": round(ts66.get("retired", 0) / ea_total, 4) if ts66 else None,
            "no_quals_pct": round(ts67.get("no_quals", 0) / q_total, 4) if ts67 else None,
            "degree_pct": round(ts67.get("level_4_plus", 0) / q_total, 4) if ts67 else None,
            "uk_born_pct": round(ts04.get("uk_born", 0) / cob_total, 4) if ts04 else None,
            "eu14_born_pct": round(ts04.get("eu14_born", 0) / cob_total, 4) if ts04 else None,
            "eu8_born_pct": round(ts04.get("eu8_born", 0) / cob_total, 4) if ts04 else None,
            "avg_imd_decile": round(v["imd_sum"] / v["imd_count"], 2) if v["imd_count"] > 0 else None,
            "total_residents": eth_total,
            "ward_name": v["ward_name"],
            "lad22cd": v["lad22cd"],
            "_source": "Census 2021 (TS021+TS030+TS054+TS066+TS067+TS004) LSOA→WD22 + IMD2019",
        }

    identity = json.load(open(IDENTITY))
    targets = [w for w in identity["wards"] if w["tier"] in ("local", "mayor") and w.get("gss_code")]
    covered = [w for w in targets if w["gss_code"] in out]
    print(f"Coverage of May 2026 identity: {len(covered)}/{len(targets)} ({100*len(covered)/len(targets):.1f}%)")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w") as f:
        json.dump({
            "snapshot": {
                "generated_at": "2026-04-25",
                "method": "Census 2021 6-table LSOA aggregation to WD22 + IMD2019",
                "tables": list(TABLES.keys()),
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

    # Sanity check Burnley wards
    print("\n=== Burnley demographic profile (Bank Hall, Daneshouse, Coalclough, Cliviger, Briercliffe) ===")
    test_wards = [
        ("E05005150", "Bank Hall"),
        ("E05005155", "Daneshouse with Stoneyholme"),
        ("E05005154", "Coal Clough with Deerplay"),
        ("E05005153", "Cliviger with Worsthorne"),
        ("E05005151", "Briercliffe"),
    ]
    for gss, name in test_wards:
        if gss not in out: continue
        d = out[gss]
        print(f"  {name}: WhiteBr={d['white_british_pct']*100:.1f}%, Asian={d['asian_pct']*100:.1f}%, Muslim={(d['muslim_pct'] or 0)*100:.1f}%, OwnOutright={(d['owned_outright_pct'] or 0)*100:.1f}%, Degree={(d['degree_pct'] or 0)*100:.1f}%, IMD={d['avg_imd_decile']}")

if __name__ == "__main__":
    main()
