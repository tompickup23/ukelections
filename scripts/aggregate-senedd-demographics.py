#!/usr/bin/env python3
"""Senedd super-constituency Census demographics.

For each of the 16 Senedd super-constituencies (Senedd Cymru Act 2024 Sch.1),
aggregate Welsh LSOA-level Census 2021 (TS021/TS030/TS054/TS066/TS067/TS004)
into super-constituency totals via:
  LSOA21 → PCON24 (ONS lookup)
  PCON24 → super-constituency (our hardcoded pairings)

Output: data/features/senedd-2026-demographics.json keyed by super-constituency slug.
"""
import csv, json, re
from pathlib import Path

ROOT = Path("/Users/tompickup/ukelections")
CENSUS = ROOT / ".cache/census"
LSOA_TO_PCON = ROOT / "data/features/lsoa21-to-pcon24.json"
PAIRS = ROOT / "data/identity/senedd-2026-super-constituency-pairs.json"
OUT = ROOT / "data/features/senedd-2026-demographics.json"

def normalise(h): return " ".join(h.lower().replace("\n", " ").replace(";", " ").split())
def slugify_pcon(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')

TABLES = {
    "ts021": ("census2021-ts021-lsoa.csv", {"total": "ethnic group: total: all usual residents", "white_british": "ethnic group: white: english, welsh, scottish, northern irish or british", "asian": "ethnic group: asian, asian british or asian welsh", "white_welsh": "ethnic group: white: english, welsh, scottish, northern irish or british"}),
    "ts030": ("census2021-ts030-lsoa.csv", {"religion_total": "religion: total: all usual residents", "no_religion": "religion: no religion", "christian": "religion: christian", "muslim": "religion: muslim"}),
    "ts054": ("census2021-ts054-lsoa.csv", {"hh_total": "tenure of household: total: all households", "owned_outright": "tenure of household: owned: owns outright"}),
    "ts067": ("census2021-ts067-lsoa.csv", {"q_total": "highest level of qualification: total: all usual residents aged 16 years and over", "no_quals": "highest level of qualification: no qualifications", "degree": "highest level of qualification: level 4 qualifications and above"}),
}

def load_lsoa_data():
    out = {}
    for tkey, (fname, fields) in TABLES.items():
        path = CENSUS / fname
        with open(path) as f:
            reader = csv.reader(f)
            header = next(reader)
            norm = [normalise(h) for h in header]
            cols = {"lsoa": norm.index("geography code")}
            for k, hdr in fields.items():
                try: cols[k] = norm.index(hdr)
                except ValueError: pass
            for row in reader:
                lsoa = row[cols["lsoa"]]
                if not lsoa.startswith("W0"): continue  # Welsh only
                if lsoa not in out: out[lsoa] = {}
                for k, idx in cols.items():
                    if k == "lsoa": continue
                    try: out[lsoa].setdefault(tkey, {})[k] = int(row[idx])
                    except (ValueError, IndexError): out[lsoa].setdefault(tkey, {})[k] = 0
    return out

def main():
    print("Loading Welsh LSOA Census data + lookups...")
    lsoa_data = load_lsoa_data()
    print(f"  Welsh LSOAs with data: {len(lsoa_data):,}")
    lsoa_to_pcon = json.load(open(LSOA_TO_PCON))["lookup"]
    pairs = json.load(open(PAIRS))["pairs"]
    print(f"  Senedd super-constituencies: {len(pairs)}")

    # Build PCON24 slug → super-constituency slug
    pcon_to_super = {}
    for super_slug, pair_info in pairs.items():
        for pcon_slug in pair_info["westminster_pair"]:
            pcon_to_super[pcon_slug] = super_slug

    # Aggregate
    super_agg = {s: {"name": pairs[s]["name"], "totals": {}, "pcon_count": 0, "lsoa_count": 0} for s in pairs}
    for lsoa, data in lsoa_data.items():
        if lsoa not in lsoa_to_pcon: continue
        pcon = lsoa_to_pcon[lsoa]
        pcon_slug = slugify_pcon(pcon["pcon24nm"])
        super_slug = pcon_to_super.get(pcon_slug)
        if not super_slug: continue
        super_agg[super_slug]["lsoa_count"] += 1
        for tkey, vals in data.items():
            t = super_agg[super_slug]["totals"].setdefault(tkey, {})
            for k, v in vals.items():
                t[k] = t.get(k, 0) + v

    out = {}
    for s, agg in super_agg.items():
        ts21 = agg["totals"].get("ts021", {})
        ts30 = agg["totals"].get("ts030", {})
        ts54 = agg["totals"].get("ts054", {})
        ts67 = agg["totals"].get("ts067", {})
        eth = max(ts21.get("total", 0), 1)
        rel = max(ts30.get("religion_total", 0), 1)
        hh = max(ts54.get("hh_total", 0), 1)
        q = max(ts67.get("q_total", 0), 1)
        out[s] = {
            "super_constituency": agg["name"],
            "white_welsh_pct": round(ts21.get("white_british", 0) / eth, 4),
            "asian_pct": round(ts21.get("asian", 0) / eth, 4),
            "muslim_pct": round(ts30.get("muslim", 0) / rel, 4),
            "christian_pct": round(ts30.get("christian", 0) / rel, 4),
            "no_religion_pct": round(ts30.get("no_religion", 0) / rel, 4),
            "owned_outright_pct": round(ts54.get("owned_outright", 0) / hh, 4),
            "no_quals_pct": round(ts67.get("no_quals", 0) / q, 4),
            "degree_pct": round(ts67.get("degree", 0) / q, 4),
            "total_residents": eth,
            "lsoa_count": agg["lsoa_count"],
        }
        print(f"  {agg['name']:35} pop={eth:,} white={out[s]['white_welsh_pct']*100:.0f}% own={out[s]['owned_outright_pct']*100:.0f}% degree={out[s]['degree_pct']*100:.0f}%")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w") as f:
        json.dump({"snapshot": {"generated_at": "2026-04-25", "source": "ONS Census 2021 Welsh LSOA → PCON24 → Senedd 2026 super-constituency"}, "demographics": out}, f, indent=2)
    print(f"\nWrote {OUT}")

if __name__ == "__main__":
    main()
