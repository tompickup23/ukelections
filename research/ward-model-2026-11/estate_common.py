"""Shared helpers for the estate series check (ESTATE_SPEC.md).

Research only. Reads the sister sites' data files read only, from their own
checkouts on this Mac; nothing is written outside this folder.

Unit of analysis: a local authority district (LAD, April 2023 to 2025 codes, the
geography of the sister-site series) at one scheduled May election. Each scored
ward or county division is placed in its district as follows, first rule that
applies:
  1. ONS ward code in wd25-bsc-raw.geojson: its LAD25CD;
  2. ONS ward code in wd26-bgc.geojson: its LAD26CD;
  3. ONS county division code in ced26-bgc.geojson: the district polygon
     (lad24-bgc.geojson) holding the division's representative point;
  4. council slug in data/identity/council-slug-to-lad24.json: that district;
  5. May 2026 Essex, Norfolk and Suffolk divisions (no ONS code yet): the
     district council that hosted the statement of persons nominated
     (wards-may-2026.json, sopn_source_url). The shared South Norfolk and
     Broadland site names two districts, so those divisions are left unplaced.
Anything else is left unplaced and counted.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
import pandas as pd

from common import CACHE, LANE_KEY, LANES, REPO

UKD = Path("/Users/tompickup/ukdemographics/src/data/live")
ASY = Path("/Users/tompickup/asylumstats/src/data/live")
CTX = Path("/Users/tompickup/ukcounciltax/data/council-tax")
PLACES = Path("/Users/tompickup/ukplaces/src/data/registry/places.json")
GEO = REPO / "data/geography"

KEYS = [LANE_KEY[p] for p in LANES]
ELECTIONS = {
    "2026-05-07": "discovery",
    "2025-05-01": "confirmation",
    "2022-05-05": "check",
    "2023-05-04": "check",
}

# Statement of persons nominated host -> district name in places.json.
# cbccrmdata.blob.core.windows.net is Colchester City Council's document store
# (checked by division name in the inventory output).
SOPN_HOST_DISTRICT = {
    "www.basildon.gov.uk": "Basildon", "www.chelmsford.gov.uk": "Chelmsford",
    "cbccrmdata.blob.core.windows.net": "Colchester", "www.braintree.gov.uk": "Braintree",
    "legacy.tendringdc.gov.uk": "Tendring", "www.eppingforestdc.gov.uk": "Epping Forest",
    "www.castlepoint.gov.uk": "Castle Point", "www.uttlesford.gov.uk": "Uttlesford",
    "www.harlow.gov.uk": "Harlow", "www.rochford.gov.uk": "Rochford",
    "www.brentwood.gov.uk": "Brentwood", "www.maldon.gov.uk": "Maldon",
    "www.west-norfolk.gov.uk": "King's Lynn and West Norfolk", "www.norwich.gov.uk": "Norwich",
    "www.breckland.gov.uk": "Breckland", "www.north-norfolk.gov.uk": "North Norfolk",
    "www.great-yarmouth.gov.uk": "Great Yarmouth",
    "www.eastsuffolk.gov.uk": "East Suffolk", "www.westsuffolk.gov.uk": "West Suffolk",
    "www.ipswich.gov.uk": "Ipswich", "www.midsuffolk.gov.uk": "Mid Suffolk",
    "www.babergh.gov.uk": "Babergh",
}


CODE_ALIAS = {"E08000038": "E08000016", "E08000039": "E08000019"}  # Barnsley, Sheffield


def rj(p: Path):
    with open(p) as f:
        return json.load(f)


# ------------------------------------------------------------- rows ----

def scheduled_rows() -> pd.DataFrame:
    """The scored scheduled rows of the four elections used here."""
    # Our own research cache, written by bridge_level_fit.py in this folder, not untrusted data.
    p = pd.read_pickle(CACHE / "bridge_level_predictions.pkl")
    p = p[(~p.is_by) & p.date.isin(list(ELECTIONS))].copy()
    return p.reset_index(drop=True)


def ballot_weights(ids: list[str]) -> tuple[dict, dict]:
    """Weight per ballot: votes cast for candidates divided by seats filled
    (an approximation to ballot papers in multi-member wards)."""
    may = rj(REPO / "data/results/may-2026/local-and-mayor.merged.json")["by_ballot"]
    hist = {r["ballot_paper_id"]: r for r in rj(REPO / "data/history/dc-historic-results.json")["results"]}
    w, how = {}, {"may26": 0, "dc": 0, "missing": 0}
    for i in ids:
        if i in may:
            b = may[i]
            seats = b.get("winner_count") or sum(1 for c in b["candidates"] if c.get("elected")) or 1
            how["may26"] += 1
        elif i in hist:
            b = hist[i]
            seats = sum(1 for c in b["candidates"] if c.get("elected")) or 1
            how["dc"] += 1
        else:
            how["missing"] += 1
            continue
        tot = sum(float(c.get("votes") or 0) for c in b["candidates"])
        w[i] = tot / seats if tot > 0 else np.nan
    return w, how


# --------------------------------------------------------- places ----

def place_rows(df: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    from shapely.geometry import shape
    from shapely.strtree import STRtree

    wd25 = {f["properties"]["WD25CD"]: f["properties"]["LAD25CD"] for f in rj(GEO / "wd25-bsc-raw.geojson")["features"]}
    wd26 = {f["properties"]["WD26CD"]: f["properties"]["LAD26CD"] for f in rj(GEO / "wd26-bgc.geojson")["features"]}
    lad = rj(GEO / "lad24-bgc.geojson")["features"]
    lad_geoms = [shape(f["geometry"]) for f in lad]
    lad_codes = [f["properties"]["LAD24CD"] for f in lad]
    tree = STRtree(lad_geoms)
    ced = {}
    for f in rj(GEO / "ced26-bgc.geojson")["features"]:
        pt = shape(f["geometry"]).representative_point()
        hits = [j for j in tree.query(pt) if lad_geoms[j].contains(pt)]
        ced[f["properties"]["CED26CD"]] = lad_codes[hits[0]] if len(hits) == 1 else None
    slug_map = {k: v["lad24cd"] for k, v in rj(REPO / "data/identity/council-slug-to-lad24.json")["map"].items() if v.get("lad24cd")}
    places = rj(PLACES)
    by_name = {}
    for code, v in places.items():
        if code.startswith("E"):
            by_name[v["name"]] = code
            by_name[v.get("displayName") or v["name"]] = code
    wards26 = rj(REPO / "data/identity/wards-may-2026.json")["by_ballot"]

    lad_of, rule = [], []
    for _, r in df.iterrows():
        g, c, b = r.gss, r.council, r.ballot_paper_id
        if g in wd25:
            lad_of.append(wd25[g]); rule.append("1_wd25")
        elif g in wd26:
            lad_of.append(wd26[g]); rule.append("2_wd26")
        elif g in ced and ced[g]:
            lad_of.append(ced[g]); rule.append("3_ced26_point")
        elif c in slug_map:
            lad_of.append(slug_map[c]); rule.append("4_council_slug")
        elif r.date == "2026-05-07" and c in ("essex", "norfolk", "suffolk") and b in wards26:
            host = urlparse(wards26[b].get("sopn_source_url") or "").netloc
            name = SOPN_HOST_DISTRICT.get(host)
            if name and name in by_name:
                lad_of.append(by_name[name]); rule.append("5_sopn_host")
            else:
                lad_of.append(None); rule.append("unplaced_sopn_host:" + host)
        else:
            lad_of.append(None); rule.append("unplaced")
    return pd.Series(lad_of, index=df.index), pd.Series(rule, index=df.index)


def region_of_lad() -> dict:
    reg = {k: v["region_name"] for k, v in rj(GEO / "lad24-to-region.json").items()}
    # lad24-to-region.json keeps Barnsley's and Sheffield's pre-2023 codes only;
    # fall back to the ukplaces registry region (fault found after the run, see ESTATE_RESULTS.md).
    for k, v in rj(PLACES).items():
        if k not in reg and v.get("region"):
            reg[k] = v["region"]
    return reg


# -------------------------------------------------------- measures ----

def _pop():
    o = rj(UKD / "population-estimates.json")
    pop = {k: {int(y): v for y, v in a["series"].items()} for k, a in o["areas"].items()}
    for new, old in CODE_ALIAS.items():
        pop.setdefault(new, pop.get(old, {}))
    return o, pop


def placebo_hash(code: str) -> float:
    h = hashlib.sha256(("estate-placebo-2026-11-27:" + code).encode()).hexdigest()
    return int(h[:12], 16) / float(16 ** 12)


MEASURES = [
    # key, label, family ("tested" = both elections can have a dated value)
    ("pop_change_21", "Population change since mid-2021, per cent", "tested"),
    ("nino_rate", "NINo registrations to adult overseas nationals in the calendar year before polling day, per 1,000 residents", "tested"),
    ("nino_change_21", "Change in NINo registrations per 1,000 residents since calendar 2021", "tested"),
    ("asylum_rate", "Supported asylum seekers at the last quarter end before polling day, per 1,000 residents", "tested"),
    ("asylum_change_21", "Change in supported asylum seekers per 1,000 residents since 31 March 2021", "tested"),
    ("income_median", "Median income of income taxpayers, 2023 to 2024, pounds", "tested"),
    ("band_d", "Band D area council tax in force on polling day, pounds", "tested"),
    ("band_d_rise", "Band D area council tax rise into the year in force on polling day, per cent", "tested"),
    ("hmo_rate", "Houses in multiple occupation per 1,000 residents, Census 2021", "tested"),
    ("wb_change_1121", "Annual change in White British share, Census 2011 to 2021, points a year", "tested"),
    ("placebo_hash", "Placebo: fixed pseudo-random number from the district code", "tested"),
    ("placebo_digit", "Placebo: last digit of the mid-2021 population estimate", "tested"),
    ("spd_share", "Single person discount share of chargeable dwellings, 6 October 2025", "may2026_only"),
    ("ta_rate", "Households in temporary accommodation at 31 March 2026, per 1,000 residents", "may2026_only"),
    ("births_nonuk_mother", "Share of 2025 live births to mothers born outside the UK, per cent", "may2026_only"),
]


def build_measures() -> tuple[dict, dict]:
    """Returns values[measure][election] = {lad: value} and provenance per
    measure and election (which dated value was used, or why none was)."""
    pop_o, pop = _pop()
    nino_o = rj(UKD / "nino-historical.json")
    ny = nino_o["years"]
    nino = {k: dict(zip(ny, a["totalByYear"])) for k, a in nino_o["areas"].items()}
    asy = {}
    for r in rj(ASY / "area-series.json"):
        asy.setdefault(r["areaCode"], {})[r["periodEnd"]] = r["value"]
    inc = rj(UKD / "income-taxpayers-la.json")
    ct = {y: rj(CTX / f"england-{y}.json") for y in ("2024-25", "2025-26", "2026-27")}
    hmo = rj(UKD / "hmo-density.json")
    eth = rj(UKD / "ethnic-projections.json")
    spd = rj(UKD / "council-tax-spd.json")
    hp = rj(ASY / "housing-pressure.json")
    bir = rj(UKD / "births-by-mother-cob.json")

    vals = {m[0]: {} for m in MEASURES}
    prov = {m[0]: {} for m in MEASURES}

    def per1k(count, code, year):
        p = pop.get(code, {}).get(year)
        return 1000.0 * count / p if (count is not None and p) else None

    for T in ELECTIONS:
        Y = int(T[:4])
        pre_q = f"{Y}-03-31"  # last quarter end before every May polling day here
        ctyear = f"{Y}-{str(Y + 1)[2:]}"
        ctprev = f"{Y - 1}-{str(Y)[2:]}"

        # population change mid-2021 -> mid-(Y-1)
        if Y - 1 > 2021:
            vals["pop_change_21"][T] = {k: 100.0 * (s[Y - 1] / s[2021] - 1) for k, s in pop.items() if s.get(2021) and s.get(Y - 1)}
            prov["pop_change_21"][T] = f"mid-2021 to mid-{Y - 1} (reference 30 June {Y - 1})"
        else:
            vals["pop_change_21"][T] = {}
            prov["pop_change_21"][T] = "not defined: no mid-year value after mid-2021 is dated before this polling day"

        vals["nino_rate"][T] = {k: per1k(s.get(Y - 1), k, Y - 1) for k, s in nino.items()}
        prov["nino_rate"][T] = f"calendar {Y - 1} registrations over mid-{Y - 1} population"
        if Y - 1 > 2021:
            vals["nino_change_21"][T] = {k: (per1k(s.get(Y - 1), k, Y - 1) or np.nan) - (per1k(s.get(2021), k, 2021) or np.nan) for k, s in nino.items()}
            prov["nino_change_21"][T] = f"calendar {Y - 1} rate minus calendar 2021 rate"
        else:
            vals["nino_change_21"][T] = {}
            prov["nino_change_21"][T] = "not defined: base year is the year before polling day"

        vals["asylum_rate"][T] = {k: per1k(s.get(pre_q), k, Y - 1) for k, s in asy.items()}
        prov["asylum_rate"][T] = f"stock at {pre_q} over mid-{Y - 1} population"
        vals["asylum_change_21"][T] = {k: (per1k(s.get(pre_q), k, Y - 1) or np.nan) - (per1k(s.get("2021-03-31"), k, 2021) or np.nan) for k, s in asy.items()}
        prov["asylum_change_21"][T] = f"rate at {pre_q} minus rate at 2021-03-31 (mid-2021 population)"

        if Y >= 2025:
            vals["income_median"][T] = {k: a.get("medianIncome") for k, a in inc["areas"].items()}
            prov["income_median"][T] = "tax year 6 April 2023 to 5 April 2024"
        else:
            vals["income_median"][T] = {}
            prov["income_median"][T] = "excluded: the only edition held (2023 to 2024) ends after this polling day"

        if ctyear in ct and ctprev in ct:
            cur = {k: a["bands"]["D"] for k, a in ct[ctyear]["authorities"].items() if a.get("bands", {}).get("D")}
            prv = {k: a["bands"]["D"] for k, a in ct[ctprev]["authorities"].items() if a.get("bands", {}).get("D")}
            vals["band_d"][T] = cur
            vals["band_d_rise"][T] = {k: 100.0 * (cur[k] / prv[k] - 1) for k in cur if k in prv}
            prov["band_d"][T] = f"{ctyear}, in force from 1 April {Y}"
            prov["band_d_rise"][T] = f"{ctprev} to {ctyear}"
        else:
            vals["band_d"][T] = vals["band_d_rise"][T] = {}
            prov["band_d"][T] = prov["band_d_rise"][T] = f"excluded: {ctyear} or {ctprev} not held"

        vals["hmo_rate"][T] = {k: a.get("hmoPer1kPopulation") for k, a in hmo["areas"].items()}
        prov["hmo_rate"][T] = "Census Day, 21 March 2021"
        vals["wb_change_1121"][T] = {k: a["annualChangePp"]["white_british"] for k, a in eth["areas"].items() if a.get("annualChangePp")}
        prov["wb_change_1121"][T] = "Census 2011 and Census 2021 composition (the projections' base, not a projected value)"
        vals["placebo_hash"][T] = {k: placebo_hash(k) for k in pop if k not in CODE_ALIAS.values()}
        prov["placebo_hash"][T] = "no date"
        vals["placebo_digit"][T] = {k: s[2021] % 10 for k, s in pop.items() if s.get(2021) and k not in CODE_ALIAS.values()}
        prov["placebo_digit"][T] = "mid-2021 estimate"

        if T == "2026-05-07":
            vals["spd_share"][T] = {k: a.get("singlePersonDiscountPctOfChargeable") for k, a in spd["areas"].items()}
            prov["spd_share"][T] = "CTB snapshot 6 October 2025"
            vals["ta_rate"][T] = {k: per1k((a.get("temporaryAccommodation") or {}).get("households", {}).get("value"), k, 2025) for k, a in hp["areas"].items()}
            prov["ta_rate"][T] = "stock at 31 March 2026 over mid-2025 population"
            vals["births_nonuk_mother"][T] = {k: a.get("nonUkBornMotherPct") for k, a in bir["areas"].items()}
            prov["births_nonuk_mother"][T] = "calendar 2025 births"
        else:
            for m in ("spd_share", "ta_rate", "births_nonuk_mother"):
                vals[m][T] = {}
            prov["spd_share"][T] = "excluded: only the 6 October 2025 snapshot is held"
            prov["ta_rate"][T] = "excluded: only the 31 March 2026 stock is held"
            prov["births_nonuk_mother"][T] = "excluded: only calendar 2025 is held"

    for m in vals:
        for T in vals[m]:
            d = {k: float(v) for k, v in vals[m][T].items() if v is not None and np.isfinite(v)}
            # Barnsley and Sheffield took new codes in April 2023 after a boundary
            # change; some sister-site files keep the old codes. Same district.
            for new, old in CODE_ALIAS.items():
                if new not in d and old in d:
                    d[new] = d[old]
            vals[m][T] = d
    return vals, prov


SOURCES = {
    "pop_change_21": "ONS, Mid-Year Population Estimates, England and Wales, June 2025 edition (published 29 July 2026), MYE4 series mid-2011 to mid-2025 as revised; ukdemographics src/data/live/population-estimates.json. Counts: usual residents.",
    "nino_rate": "DWP Stat-Xplore, NINo registrations to adult overseas nationals, calendar years 2002 to 2025; ukdemographics nino-historical.json (lastUpdated 2026-04-29). Counts: new registrations (a flow, not a stock). Denominator: ONS mid-year estimate of the same year.",
    "nino_change_21": "As nino_rate.",
    "asylum_rate": "Home Office immigration system statistics, year ending June 2026 (published 27 August 2026), Asy_D11 quarterly supported asylum by local authority; asylumstats area-series.json. Counts: people in receipt of asylum support at quarter end. Denominator: ONS mid-year estimate.",
    "asylum_change_21": "As asylum_rate.",
    "income_median": "HMRC Personal Incomes Statistics 2023 to 2024, Table 3.14 (published 29 April 2026); ukdemographics income-taxpayers-la.json. Counts: median total income of individuals liable to income tax (sample estimate).",
    "band_d": "MHCLG, Council Tax levels set by local authorities in England 2025 to 2026 (revised 22 April 2026) and 2026 to 2027 (25 March 2026), area Band D for two adults including precepts; ukcounciltax data/council-tax/england-*.json.",
    "band_d_rise": "As band_d, plus Council Tax levels 2024 to 2025 (updated 8 May 2024).",
    "hmo_rate": "ONS Census 2021 RM192, dwellings that are houses in multiple occupation, over Census 2021 population; ukdemographics hmo-density.json (lastUpdated 2026-04-29).",
    "wb_change_1121": "ONS Census 2011 KS201EW and Census 2021 TS021 ethnic group, as held as the base of the UK Demographics projections (ethnic-projections.json, annualChangePp, model version as recorded in the file). Counts: change in the White British share of usual residents, points a year.",
    "placebo_hash": "None: SHA-256 of a fixed salt and the district code.",
    "placebo_digit": "Last digit of the ONS mid-2021 estimate (population-estimates.json).",
    "spd_share": "MHCLG Council Taxbase 2025 in England (snapshot 6 October 2025, revised 21 January 2026); ukdemographics council-tax-spd.json. Counts: dwellings with a 25% single person discount over chargeable dwellings.",
    "ta_rate": "MHCLG Statutory homelessness detailed local authority tables, January to March 2026 (13 August 2026, provisional), TA1; asylumstats housing-pressure.json. Counts: households in temporary accommodation at 31 March 2026. Denominator: ONS mid-2025.",
    "births_nonuk_mother": "ONS Births in England and Wales: 2025, parents' country of birth, Table 6a (27 May 2026); ukdemographics births-by-mother-cob.json. Counts: live births to mothers born outside the UK over all live births.",
}
