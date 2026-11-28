"""The ward model's forecast for the English council elections of 6 May 2027,
as an unpublished dry run (V2027_SPEC.md).

    uv run python v2027_forecast.py --coverage-only   # the coverage table, no forecast
    uv run python v2027_forecast.py                   # coverage, then C2 and M50 for every ward with a route

Research only. Nothing on the site reads the outputs:
  results/v2027_coverage.json
  data/forecasts/research/wards-2027-dryrun.json

Inputs (this folder's gitignored cache; cache/ is a symlink to
~/ukelections-research-cache/corrected-2026-11-28/):
  cache/rebuild/corrected/bridge_level_dataset.pkl   the corrected dataset
  cache/fit_meta.pkl                                 lane settings and spreads
  cache/drive07/universe_features_v2.csv             ward features by GSS code
  cache/v2027/bridge.pkl                             written by v2027_bridge.py
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

import live_forecast as lf
import prepare
from bridge_level_fit import standing_inputs
from common import CACHE, HERE, LANES, LANE_KEY, MAJOR, MAY26, MAY26_ACTUALS, OUT, REPO, UNIVERSE, expit, logit, pool_party, read_json, sha256
from prepare import FEATURES_NUMERIC, REGIONS, fnum

RUN_DATE = "2026-11-28"
POLLING_DAY = "2027-05-06"
CONTEST_COMMIT = "ed3271588327cc0673dd8bcc141186a3cbbbdaba"
BASE = CACHE / "rebuild" / "corrected" / "bridge_level_dataset.pkl"
FIT_META = CACHE / "fit_meta.pkl"
BRIDGE = CACHE / "v2027" / "bridge.pkl"
POLLS_TS = HERE / "live" / "inputs" / "timeseries-9588dc90eb62.json"
WARDS = REPO / "data/identity/wards-2027.json"
COUNCILS = REPO / "data/identity/councils-2027.json"
OUTFILE = REPO / "data/forecasts/research/wards-2027-dryrun.json"
COVERAGE = OUT / "v2027_coverage.json"
HASHES = {
    BASE: "3393cfdba3437f46ad2f2b8485e1621b8a38d4c5605ee33c4c4cd9be38de53a8",
    FIT_META: "936d07ee4d9004d1cdd811796f60dbfb1b22a723e7575789b56292c287ac67ad",
    POLLS_TS: "9588dc90eb625e01e860116d2c813526ab3374bfdfeb0725bb58bda40cf194ae",
    prepare.POLLS_2025: "1da7b7a373f1dee1de3fd55ce2b3e494f0a60db9ff40e56785cfa8fd014dc461",
    UNIVERSE: "592a5e96f447a719c61db231c93e14babacbc9d0a344c83041cf1a03b3f97404",
    WARDS: "d1fd913b0fc3dd7b7fd75c5dbf51d57fdeef9ec0594a9a245359af105f905e0b",
    COUNCILS: "6796bf5bfbaec68cf79a162fee8ee8fd0d96a66a302720b3d98f7cdc400a303e",
}
KEYS = [LANE_KEY[p] for p in LANES]
LANE_OF = {LANE_KEY[p]: p for p in LANES}
W_M50 = 0.5
TYPE_BY_PREFIX = {"E06": "unitary", "E07": "district", "E08": "metropolitan borough", "E09": "London borough"}
REASON_TEXT = {
    "unverified_council": "The council's 2027 election is not verified in data/identity/councils-2027.json.",
    "new_ward_no_ons_code": "A ward drawn by a 2027 Electoral Changes Order: no ONS code, and its boundary file cannot be redistributed, so no features.",
    "code_not_in_boundary_file": "The ward's code is in neither the feature file nor data/geography/wd26-bgc.geojson.",
    "bridge_no_parent_features": "None of the 2025 wards this ward was cut from is in the feature file.",
}


def rel(p: Path) -> str:
    return str(Path(p).resolve().relative_to(REPO.resolve())) if str(Path(p).resolve()).startswith(str(REPO.resolve())) else str(p)


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower().replace("&", "and")).strip()


def council_types(councils: list[dict]) -> dict:
    """Council type from the ONS code of its district: wd26-bgc's LAD26CD, else lad24-bgc by name."""
    by_name = {}
    for f in json.load(open(REPO / "data/geography/lad24-bgc.geojson"))["features"]:
        by_name[norm(f["properties"]["LAD24NM"])] = f["properties"]["LAD24CD"]
    for f in json.load(open(REPO / "data/geography/wd26-bgc.geojson"))["features"]:
        by_name[norm(f["properties"]["LAD26NM"])] = f["properties"]["LAD26CD"]
    out = {}
    for c in councils:
        name = norm(c["name"])
        name = re.sub(r" (city )?council$", "", name)
        name = {"city of lincoln": "lincoln", "herefordshire": "herefordshire county of", "kingston upon hull": "kingston upon hull city of"}.get(name, name)
        code = by_name.get(name)
        out[c["slug"]] = TYPE_BY_PREFIX.get((code or "")[:3], "unknown")
    return out


def routes(wards, universe, bridge):
    out = {}
    for w in wards:
        g = w.get("gss_code")
        if w["block"] != "verified":
            out[w["id"]] = ("none", "unverified_council")
        elif not g:
            out[w["id"]] = ("none", "new_ward_no_ons_code")
        elif g in universe:
            out[w["id"]] = ("direct", None)
        elif g not in bridge:
            out[w["id"]] = ("none", "code_not_in_boundary_file")
        elif bridge[g]["feature_cover"] <= 0:
            out[w["id"]] = ("none", "bridge_no_parent_features")
        else:
            out[w["id"]] = ("bridge", None)
    return out


def coverage_table(wards, route, ctype):
    tab = defaultdict(Counter)
    seats = defaultdict(Counter)
    reasons = Counter()
    for w in wards:
        r, why = route[w["id"]]
        t = ctype.get(w["council_slug"], "unknown") if w["block"] == "verified" else "unverified councils"
        tab[t][r] += 1
        tab["all verified" if w["block"] == "verified" else "all unverified"][r] += 1
        if w["seats_up"] is not None:
            seats[t][r] += w["seats_up"]
        else:
            seats[t]["blank_seats_up_wards"] += 1
        if why:
            reasons[why] += 1
    return {"wards_by_council_type_and_route": {k: dict(v) for k, v in sorted(tab.items())},
            "seats_up_by_council_type_and_route": {k: dict(v) for k, v in sorted(seats.items())},
            "no_forecast_reasons": dict(reasons), "reason_text": REASON_TEXT}


# ------------------------------------------------------------- inputs ----

def check_hashes():
    for p, want in HASHES.items():
        got = sha256(p)
        if got != want:
            sys.exit(f"STOP: {p} has sha256 {got}, V2027_SPEC.md says {want}")


def load_contests_at(commit):
    contests, c = lf.load_contests(commit)
    assert c == commit
    return contests


def _slugkey(s: str) -> str:
    return "-".join(t for t in s.split("-") if t != "and")


def may26_ballot(w: dict, may: dict, baselines: dict) -> str | None:
    """The ward's own 7 May 2026 ballot id: the slug as listed, else the baseline file's
    ballot (wards-2027-baselines.json), else the slug without "and" when unique in the council."""
    bid = f"local.{w['council_slug']}.{w['ward_slug']}.{MAY26}"
    if bid in may:
        return bid
    b = ((baselines.get(w["id"]) or {}).get("baseline") or {}).get("ballot_paper_id") or ""
    if b.endswith(MAY26) and b in may:
        return b
    pre = f"local.{w['council_slug']}."
    hits = [k for k in may if k.startswith(pre) and k.endswith("." + MAY26) and ".by." not in k
            and _slugkey(k[len(pre):-len(MAY26) - 1]) == _slugkey(w["ward_slug"])]
    return hits[0] if len(hits) == 1 else None


def load_baselines() -> dict:
    return {b["id"]: b for b in read_json(REPO / "data/identity/wards-2027-baselines.json")["wards"]}


def may26_slate(bid, may):
    b = may.get(bid)
    if not b or not b.get("candidates"):
        return None
    pooled = defaultdict(float)
    for party, v in (b.get("vote_shares") or {}).items():
        pooled[pool_party(party)] += v or 0
    stood = {p: False for p in LANES}
    for c in b["candidates"]:
        stood[pool_party(c.get("party_canonical") or "")] = True
    return {p: pooled.get(p, 0.0) for p in LANES}, stood


# --------------------------------------------------------------- build ----

def build(wards, route, bridge, polls, contests):
    run_dt = datetime.fromisoformat(RUN_DATE + "T12:00:00+00:00")
    # This folder's own cache (research output of rebuild.py), hash checked; not untrusted data.
    base = pd.read_pickle(BASE)
    base = base[base["set"] != "byelection"].copy()
    universe = {u["gss"]: u for u in pd.read_csv(UNIVERSE, dtype=str, keep_default_na=False).to_dict("records")}
    may = read_json(MAY26_ACTUALS)["by_ballot"]
    baselines = load_baselines()

    rows = []
    for d in contests:  # rebuilt post-May by-elections, training only (LIVE_SPEC.md tests)
        c = d.get("contest") or {}
        pday = c.get("polling_day")
        if not pday or pday <= MAY26 or pday >= RUN_DATE:
            continue
        if c.get("territory") != "ENG" or d.get("status") != "concluded" or not lf._has_result(d):
            continue
        u = universe.get(c.get("ward_gss"))
        if u is None:
            continue
        r = lf.contest_row(d, u, with_result=True)
        r["_target"] = False
        rows.append(r)
    n_rebuilt = len(rows)

    # Others' standing at the last scheduled election, direct wards
    sched = base[~base.is_by.astype(bool) & base.gss.notna() & (base.gss != "") & base.s_ref.notna() & (base.date < RUN_DATE)]
    last_sched = sched.sort_values("date").groupby("gss").tail(1).set_index("gss")

    meta = {}
    for w in wards:
        r_kind, _ = route[w["id"]]
        if r_kind == "none":
            continue
        g = w["gss_code"]
        row = {"ballot_paper_id": f"v2027.{w['id']}", "date": POLLING_DAY, "council": w["council_slug"], "gss": g,
               "is_by": False, "source": "v2027", "set": "v2027", "_target": True}
        info = {"route": r_kind}
        if r_kind == "direct":
            u = universe[g]
            for col in FEATURES_NUMERIC:
                row[col] = fnum(u.get(col))
            row["region"] = u.get("region_name")
            if g in last_sched.index:
                oth = bool(last_sched.at[g, "stood_oth"])
                info["last_scheduled"] = last_sched.at[g, "date"]
            else:
                oth = False
                info["last_scheduled"] = None
        else:
            b = bridge[g]
            for col in FEATURES_NUMERIC:
                num = den = 0.0
                for p, wt in b["parents"].items():
                    v = fnum(universe[p].get(col)) if p in universe else np.nan
                    if not np.isnan(v):
                        num += wt * v
                        den += wt
                row[col] = num / den if den > 0 else np.nan
            row["d_total_residents"] = b["population"]
            top = max(b["parents"], key=b["parents"].get)
            row["region"] = universe.get(top, {}).get("region_name")
            prev = may26_slate(may26_ballot(w, may, baselines), may)
            info["may26"] = prev
            oth = bool(prev and prev[1]["Others"])
            info["last_scheduled"] = MAY26 if prev else None
        for p in LANES:
            k = LANE_KEY[p]
            row[f"s_{k}"] = np.nan
            row[f"stood_{k}"] = True if p in MAJOR else oth
        rows.append(row)
        meta[row["ballot_paper_id"]] = (w, info)

    df = pd.concat([base, pd.DataFrame(rows)], ignore_index=True)
    df["_target"] = df["_target"].fillna(False).astype(bool)
    df["is_by"] = df["is_by"].astype(bool)
    df["d"] = pd.to_datetime(df["date"])
    df["region_code"] = df["region"].map({r: i for i, r in enumerate(REGIONS)}).astype(float)
    df["n_standing"] = df[[f"stood_{k}" for k in KEYS]].sum(axis=1)

    cache = {}

    def anchor_on(dstr):
        if dstr not in cache:
            cache[dstr] = prepare.poll_anchor(polls, date.fromisoformat(dstr), carry_forward=True)
        return cache[dstr]

    run_anchor = anchor_on(RUN_DATE)
    if run_anchor is None:
        sys.exit("STOP: the anchor rule fails on the run date; no forecast is written")
    new_idx = df.index[df["source"].eq("byelection_file") & df["date"].gt(MAY26)]
    tgt = list(df.index[df["_target"]])
    for i in list(new_idx) + tgt:
        a = run_anchor if df.at[i, "_target"] else anchor_on(df.at[i, "date"])
        df.at[i, "anchor_kind"] = "polls_14d" if a else None
        for p in LANES:
            df.at[i, f"a_{LANE_KEY[p]}"] = a[p] if a else np.nan

    direct_idx = [i for i in tgt if meta[df.at[i, "ballot_paper_id"]][1]["route"] == "direct"]
    bridge_idx = [i for i in tgt if meta[df.at[i, "ballot_paper_id"]][1]["route"] == "bridge"]
    lf.ward_lags(df, list(new_idx) + direct_idx)

    # bridged wards: their own May 2026 contest, relative to the 2026 year mean (as ward_lags computes it)
    h26 = df[(df.d.dt.year == 2026) & df.s_ref.notna()]
    ym26 = {k: float(h26.loc[h26[f"stood_{k}"].astype(bool), f"s_{k}"].mean()) for k in KEYS}
    may_anchor = df.loc[(df.date == MAY26) & df.anchor_kind.notna()].iloc[0]
    gap = (pd.Timestamp(POLLING_DAY) - pd.Timestamp(MAY26)).days / 365.25
    for i in bridge_idx:
        prev = meta[df.at[i, "ballot_paper_id"]][1]["may26"]
        if prev is None:
            for k in KEYS:
                df.at[i, f"prev_rel_{k}"] = np.nan
            df.at[i, "prev_gap_years"] = np.nan
            df.at[i, "has_prev"] = 0
            continue
        sh, st = prev
        for k in KEYS:
            df.at[i, f"prev_rel_{k}"] = sh[LANE_OF[k]] - ym26[k] if st[LANE_OF[k]] else np.nan
        df.at[i, "prev_gap_years"] = gap
        df.at[i, "has_prev"] = 1

    df = standing_inputs(df)
    nat26 = {k: float(df.loc[df.date == MAY26, f"nat_stand_{k}"].iloc[0]) for k in KEYS}
    for i in bridge_idx:
        for k in KEYS:
            df.at[i, f"prev_nat_stand_{k}"] = nat26[k]
        df.at[i, "prev_sched_date"] = MAY26

    # previous contest for M50 (latest earlier row with a result and the same code)
    hist = df[df.gss.notna() & (df.gss != "") & df.s_ref.notna()].sort_values("d")
    latest = hist.groupby("gss").tail(1).set_index("gss")
    prevs = {}
    for i in tgt:
        bid = df.at[i, "ballot_paper_id"]
        w, info = meta[bid]
        if info["route"] == "direct":
            g = df.at[i, "gss"]
            if g in latest.index:
                L = latest.loc[g]
                prevs[bid] = {"date": L["date"], "anchored": pd.notna(L["anchor_kind"]),
                              "s": {p: float(L[f"s_{LANE_KEY[p]}"]) for p in LANES},
                              "a": {p: float(L[f"a_{LANE_KEY[p]}"]) for p in LANES}}
        elif info["may26"] is not None:
            prevs[bid] = {"date": MAY26, "anchored": True, "s": dict(info["may26"][0]),
                          "a": {p: float(may_anchor[f"a_{LANE_KEY[p]}"]) for p in LANES}}
    facts = {"rebuilt_byelections_in_training": n_rebuilt, "anchor": run_anchor,
             "nat_stand_2027": {LANE_OF[k]: float(df.loc[tgt[0], f"nat_stand_{k}"]) for k in KEYS} if tgt else None}
    return df, tgt, meta, prevs, facts


def m50(c2: dict, prev: dict | None, anchor: dict) -> dict:
    """swingblend_score.blend for one ward, w = 0.5."""
    if prev is None or not prev["anchored"]:
        return c2
    live = [p for p in LANES if c2.get(p, 0) > 0]
    old = [p for p in live if prev["s"][p] > 0]
    if not old:
        return c2
    raw = {}
    for p in old:
        a_now, a_prev = anchor[p], prev["a"][p]
        change = 0.0 if (pd.isna(a_now) or pd.isna(a_prev)) else float(logit(a_now) - logit(a_prev))
        raw[p] = float(expit(logit(prev["s"][p]) + change))
    m_old = sum(c2[p] for p in old)
    tot = sum(raw.values())
    z = {}
    for p in live:
        if p in raw:
            z[p] = W_M50 * float(logit(c2[p])) + (1 - W_M50) * float(logit(raw[p] / tot * m_old))
        else:
            z[p] = float(logit(c2[p]))
    sh = {p: float(expit(v)) for p, v in z.items()}
    s = sum(sh.values())
    return {p: sh.get(p, 0.0) / s for p in LANES}


def r4(x):
    return None if x is None else round(float(x), 4)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--coverage-only", action="store_true")
    args = ap.parse_args(argv)
    check_hashes()
    wj = read_json(WARDS)
    wards_all = wj["wards"]
    verified = [w for w in wards_all if w["block"] == "verified"]
    universe = {u["gss"] for u in csv.DictReader(open(UNIVERSE, newline=""))}
    # This folder's own cache, written by v2027_bridge.py.
    bridge = pd.read_pickle(BRIDGE)
    route = routes(wards_all, universe, bridge)
    vc = [c for c in wj["councils"] if c["block"] == "verified"]
    ctype = council_types(vc)
    cov = coverage_table(wards_all, route, ctype)
    cov["council_types"] = dict(Counter(ctype.values()))
    cov["council_type_rule"] = "ONS district code prefix (E06 unitary, E07 district, E08 metropolitan borough, E09 London borough), from wd26-bgc LAD26CD or lad24-bgc by council name"
    cov["wards_file"] = {"file": rel(WARDS), "sha256": HASHES[WARDS]}
    COVERAGE.write_text(json.dumps(cov, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(cov["wards_by_council_type_and_route"], indent=1))
    print(json.dumps(cov["no_forecast_reasons"]))
    print(f"wrote {rel(COVERAGE)}")
    if args.coverage_only:
        return

    commit = lf.git("rev-parse", "HEAD")
    dirty = bool(lf.git("status", "--porcelain", "--", str(HERE.relative_to(REPO)), ":(exclude)research/ward-model-2026-11/cache"))
    captured_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    contests = load_contests_at(CONTEST_COMMIT)
    polls = lf.load_polls(POLLS_TS)
    df, tgt, meta, prevs, facts = build(verified, route, bridge, polls, contests)
    off, n_train = lf.fit_and_predict(df, tgt, RUN_DATE)
    spreads = {LANE_KEY[p]: float(v["oof_logit_resid_sd"]) for p, v in pd.read_pickle(FIT_META)["lanes"].items()}
    anchor = facts["anchor"]

    order = sorted(range(len(tgt)), key=lambda j: df.at[tgt[j], "ballot_paper_id"])
    rng_c2 = np.random.default_rng(lf.DRAW_SEED)
    rng_m50 = np.random.default_rng(lf.DRAW_SEED)
    fc = {}
    for j in order:
        i = tgt[j]
        bid = df.at[i, "ballot_paper_id"]
        standing = [k for k in KEYS if bool(df.at[i, f"stood_{k}"])]
        if any(np.isnan(off[k][j]) for k in standing):
            fc[bid] = None
            continue
        bl = {k: float(logit(df.at[i, f"a_{k}"])) + float(off[k][j]) for k in standing}
        raw = {k: float(expit(v)) for k, v in bl.items()}
        tot = sum(raw.values())
        c2 = {LANE_OF[k]: (raw[k] / tot if k in raw else 0.0) for k in KEYS}
        mb = m50(c2, prevs.get(bid), anchor)
        bl_m = {k: float(logit(mb[LANE_OF[k]])) for k in standing}
        fc[bid] = {
            "c2": {"shares": c2, "leader": max(c2, key=c2.get), "win_chance": lf.win_chances(bl, standing, spreads, rng_c2)},
            "m50": {"shares": mb, "leader": max(mb, key=mb.get), "win_chance": lf.win_chances(bl_m, standing, spreads, rng_m50),
                    "benchmark": "swing_from_previous_contest" if mb is not c2 else "none_m50_equals_c2"},
            "standing": [LANE_OF[k] for k in standing],
        }

    polls_doc = json.loads(POLLS_TS.read_text(encoding="utf-8"))
    inputs = {
        "code_commit": commit, "code_dirty": dirty, "captured_at": captured_at, "run_date": RUN_DATE,
        "specification": "research/ward-model-2026-11/V2027_SPEC.md",
        "dataset": {"file": "research/ward-model-2026-11/cache/rebuild/corrected/bridge_level_dataset.pkl", "sha256": HASHES[BASE]},
        "fit_meta": {"file": "research/ward-model-2026-11/cache/fit_meta.pkl", "sha256": HASHES[FIT_META]},
        "ward_features": {"file": "research/ward-model-2026-11/cache/drive07/universe_features_v2.csv", "sha256": HASHES[UNIVERSE]},
        "polls": {"file": rel(POLLS_TS), "sha256": HASHES[POLLS_TS], "generated_at": polls_doc.get("generated_at"),
                  "latest_poll_date": max(p["date"] for p in polls_doc["polls"]),
                  "also_read": {"file": rel(prepare.POLLS_2025), "sha256": HASHES[prepare.POLLS_2025]}},
        "contest_files": {"path": "data/contests/local-byelections", "commit": CONTEST_COMMIT},
        "wards": {"file": rel(WARDS), "sha256": HASHES[WARDS]},
        "bridge": {"file": "research/ward-model-2026-11/cache/v2027/bridge.pkl", "sha256": sha256(BRIDGE)},
    }
    stand_rule = ("Assumed before nominations (V2027_SPEC.md): Reform UK, Labour, Conservative, Liberal Democrats and Green Party "
                  "stand in every ward; Others stand where any other candidate stood at the ward's last scheduled election.")
    records = []
    by_id = {meta[b][0]["id"]: b for b in meta}
    for w in wards_all:
        r_kind, why = route[w["id"]]
        rec = {"id": w["id"], "council_slug": w["council_slug"], "ward_name": w["ward_name"], "gss_code": w["gss_code"],
               "block": w["block"], "boundaries": w["boundaries"], "seats_up": w["seats_up"], "seats_up_basis": w["seats_up_basis"],
               "route": r_kind}
        bid = by_id.get(w["id"])
        f = fc.get(bid) if bid else None
        if f is None:
            rec.update({"forecast": None, "reason": why or "standing_lane_without_model",
                        "reason_text": REASON_TEXT.get(why, "A lane assumed to stand has fewer than 50 training contests.")})
        else:
            info = meta[bid][1]
            p = prevs.get(bid)
            rec.update({
                "standing_assumed": f["standing"], "others_basis": f"last scheduled election {info['last_scheduled']}" if info["last_scheduled"] else "no earlier scheduled election: Others assumed not to stand",
                "previous_contest": {"date": p["date"], "anchored": bool(p["anchored"])} if p else None,
                "forecast": {arm: {"shares": {k: r4(v) for k, v in f[arm]["shares"].items()}, "leader": f[arm]["leader"],
                                   "win_chance": {k: r4(v) for k, v in f[arm]["win_chance"].items()}} for arm in ("c2", "m50")},
                "m50_benchmark": f["m50"]["benchmark"],
            })
        records.append(rec)

    out = {
        "status": "RESEARCH, UNPUBLISHED, DRY RUN",
        "about": ("Research only, unpublished, a dry run. Not a prediction of the 6 May 2027 elections and not vintage 1 of the "
                  "pre-registered forecast (docs/preregistration-2027.md). No page reads this file. The research ward model (C2) and its "
                  "half and half blend with the swing from each ward's last result (M50), trained on every contest before 28 November 2026 "
                  "and anchored on the national polls of that date. Shares are full slate shares over six lanes; every party outside the "
                  "five main lanes and every independent is pooled as Others. Win chances come from fixed lane spreads and are not calibrated. "
                  "Coverage is incomplete: see research/ward-model-2026-11/V2027_RESULTS.md."),
        "polling_day": POLLING_DAY,
        "model_version": {"c2": "ward-model-2026-11/C2", "m50": "ward-model-2026-11/M50 (SWINGBLEND_SPEC.md, w = 0.5)"},
        "standing_rule": stand_rule,
        "anchor": {k: r4(v) for k, v in anchor.items()},
        "training_rows_by_lane": {LANE_OF[k]: n for k, n in n_train.items()},
        "rebuilt_byelections_in_training": facts["rebuilt_byelections_in_training"],
        "nat_stand_2027": {k: r4(v) for k, v in (facts["nat_stand_2027"] or {}).items()},
        "inputs": inputs,
        "wards": records,
    }
    OUTFILE.parent.mkdir(parents=True, exist_ok=True)
    OUTFILE.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    n = sum(1 for r in records if r["forecast"])
    print(f"anchor {', '.join(f'{k} {v:.3f}' for k, v in anchor.items())}; forecast {n} wards; wrote {rel(OUTFILE)}")


if __name__ == "__main__":
    main()
