"""History gap (HISTORY_GAP.md): which ordinary English ward contests exist in a
ward results source on this Mac but not in the corrected research dataset, why
each is missing, and how many of the 1,861 history-less 2027 wards of the dry
run (PR 219) each group would give a previous result to.

Counts only. Nothing is fitted, scored or written to the dataset.

Inputs (all read only):
  cache/rebuild/corrected/bridge_level_dataset.pkl     the corrected dataset (sha256 checked)
  cache/drive07/ward_contests_v2.csv                   the Drive matrix (features)
  cache/drive07/universe_features_v2.csv               the feature rows by ward code
  data/history/dc-historic-results.json                Democracy Club candidate votes (raw source 1)
  ~/ukelections-research-cache/drive01/ward_results_2016-2026_candidates.csv
                                                       Democracy Club ward results, Drive library (raw source 2)
  data/results/may-2026/local-and-mayor.merged.json    May 2026 results (raw source 3)
  data/identity/wards-2027-baselines.json              derived: pooled six-lane shares of each 2027 ward's
                                                       last ordinary result, and fallback_2019 (source 4)
  data/identity/wards-may-2026.json                    May 2026 ballots with ONS codes
  data/forecasts/research/wards-2027-dryrun.json       the dry run (PR 219): which forecast wards lack history

Output: results/history_gap.json
"""
from __future__ import annotations

import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd

from common import CACHE, DC_HISTORY, MATRIX, MAY26_ACTUALS, OUT, REPO, UNIVERSE, read_json, sha256

DATASET = CACHE / "rebuild/corrected/bridge_level_dataset.pkl"
DATASET_SHA = "3393cfdba3437f46ad2f2b8485e1621b8a38d4c5605ee33c4c4cd9be38de53a8"
DRIVE_CSV = Path.home() / "ukelections-research-cache/drive01/ward_results_2016-2026_candidates.csv"
DRIVE_CSV_SHA = "ddeb3ebb6e258324a31fe4276d973e3ea2c82e24524931c32bc69764c92cf4e3"
BASELINES = REPO / "data/identity/wards-2027-baselines.json"
WARDS_MAY26 = REPO / "data/identity/wards-may-2026.json"
DRYRUN = REPO / "data/forecasts/research/wards-2027-dryrun.json"
TYPE_BY_PREFIX = {"E06": "unitary", "E07": "district", "E08": "metropolitan borough", "E09": "London borough"}


def ordinary_local(bid: str) -> bool:
    return bid.startswith("local.") and ".by." not in bid


def main():
    assert sha256(DATASET) == DATASET_SHA, "corrected dataset changed"
    assert sha256(DRIVE_CSV) == DRIVE_CSV_SHA, "Drive results file changed"
    # This folder's own cache (our research output, not untrusted data).
    df = pd.read_pickle(DATASET)
    in_dataset = set(df.ballot_paper_id)
    matrix = pd.read_csv(MATRIX, usecols=["ballot_paper_id", "date", "council_slug", "gss", "is_by", "source"], dtype=str)
    in_matrix = set(matrix.ballot_paper_id)
    uni = pd.read_csv(UNIVERSE, usecols=["gss", "lad_cd", "layer"], dtype=str)
    uni_gss = set(uni.gss)
    lad_of = dict(zip(uni.gss, uni.lad_cd))

    # ---- every ordinary local contest in a results source
    contests: dict[str, dict] = {}

    def add(bid, src, council, date, gss=None, votes=True):
        c = contests.setdefault(bid, {"sources": set(), "council": council, "date": date, "gss": set(), "candidate_votes": False})
        c["sources"].add(src)
        if gss:
            c["gss"].add(gss)
        c["candidate_votes"] |= votes

    hist = read_json(DC_HISTORY)["by_ballot"]
    for bid, b in hist.items():
        if ordinary_local(bid):
            add(bid, "dc_history", b["council_slug"], b["election_date"])
    with open(DRIVE_CSV, newline="") as f:
        for r in csv.DictReader(f):
            if r["tier"] == "local" and r["is_by_election"] != "True" and ordinary_local(r["ballot_paper_id"]):
                add(r["ballot_paper_id"], "drive_csv", r["council_slug"], r["election_date"])
    may = read_json(MAY26_ACTUALS)["by_ballot"]
    for bid, b in may.items():
        if ordinary_local(bid):
            add(bid, "may2026_merged", b["council_slug"], b["election_date"])
    base = read_json(BASELINES)
    for w in base["wards"]:
        b = w.get("baseline")
        if b and b.get("ballot_paper_id") and w["method"] == "same_ward":
            add(b["ballot_paper_id"], f"baselines_{b['source']}", w["council_slug"], b["date"], w.get("gss_code"), votes=False)

    # ---- explicit ward codes for ballots (never by name)
    code_of = defaultdict(set)
    for bid, g in zip(matrix.ballot_paper_id, matrix.gss):
        if isinstance(g, str) and g:
            code_of[bid].add(g)
    wm = read_json(WARDS_MAY26)
    for bid, r in wm["by_ballot"].items():
        if r.get("gss_code"):
            code_of[bid].add(r["gss_code"])
    for bid, c in contests.items():
        c["gss"] |= code_of.get(bid, set())

    # ---- council type: ONS district code prefix of the council's coded wards; county divisions (E58) are county
    votes_type = defaultdict(Counter)
    for bid, c in contests.items():
        for g in c["gss"]:
            if g.startswith("E58"):
                votes_type[c["council"]]["county"] += 1
            elif g in lad_of:
                votes_type[c["council"]][TYPE_BY_PREFIX.get(lad_of[g][:3], "other")] += 1
    for cs, g in zip(matrix.council_slug, matrix.gss):
        if isinstance(g, str) and g.startswith("E58"):
            votes_type[cs]["county"] += 1
        elif g in lad_of:
            votes_type[cs][TYPE_BY_PREFIX.get(lad_of[g][:3], "other")] += 1
    ctype = {cs: v.most_common(1)[0][0] for cs, v in votes_type.items()}
    drive_councils = {c["council"] for c in contests.values() if "drive_csv" in c["sources"]}
    may_councils = {c["council"] for c in contests.values() if "may2026_merged" in c["sources"]}
    # The Drive file and the May 2026 yardstick file are England only.
    english = set(ctype) | drive_councils | may_councils

    # ---- classify every contest not in the dataset
    rows = []
    not_england = Counter()
    for bid, c in contests.items():
        if c["council"] not in english:
            not_england[c["council"]] += 1
            continue
        year = c["date"][:4]
        if bid in in_dataset:
            group = "in_dataset"
        elif bid in in_matrix:
            group = "other_in_matrix_dropped_by_prepare"
        elif not c["gss"]:
            group = "not_in_matrix_no_ward_code_match"
        elif not (c["gss"] & uni_gss):
            group = "not_in_matrix_code_without_feature_row"
        else:
            group = "not_in_matrix_code_and_feature_row"
        votes = "candidate_votes" if c["candidate_votes"] else "pooled_shares_only"
        rows.append({"bid": bid, "year": year, "type": ctype.get(c["council"], "unknown"), "group": group,
                     "votes": votes, "sources": "+".join(sorted(c["sources"])), "gss": sorted(c["gss"]), "council": c["council"],
                     "date": c["date"]})
    t = pd.DataFrame(rows)

    # ---- the 1,861 history-less forecast wards of the dry run
    dr = read_json(DRYRUN)
    fw = [w for w in dr["wards"] if w.get("forecast")]
    hl = [w for w in fw if w.get("previous_contest") is None]
    hl_gss = {w["gss_code"]: w for w in hl}
    give = defaultdict(set)
    give_by_year = defaultdict(lambda: defaultdict(set))
    for r in t[t.group != "in_dataset"].itertuples():
        for g in r.gss:
            if g in hl_gss and r.date < "2027-05-06":
                key = f"{r.group} | {r.votes}"
                give[key].add(g)
                give_by_year[key][r.year].add(g)
    any_give = set().union(*give.values()) if give else set()
    raw_give = set().union(*[v for k, v in give.items() if k.endswith("candidate_votes")]) if give else set()
    base_by_gss = {w["gss_code"]: w for w in base["wards"] if w.get("gss_code")}
    hl_baseline = Counter()
    for g, w in hl_gss.items():
        b = (base_by_gss.get(g) or {}).get("baseline")
        hl_baseline[(f"{b['source']} {b['date']}" if b else "no baseline")] += 1

    # History-less wards whose baseline ballot is already in the dataset, and under which code.
    ds_gss = dict(zip(df.ballot_paper_id, df.gss))
    in_ds_other_code = []
    for g, w in hl_gss.items():
        b = (base_by_gss.get(g) or {}).get("baseline")
        if b and b.get("ballot_paper_id") in ds_gss:
            in_ds_other_code.append({"ward": w["id"], "gss_2027": g, "baseline_ballot": b["ballot_paper_id"],
                                     "dataset_gss": ds_gss[b["ballot_paper_id"]], "joined_by": b.get("joined_by")})
    # Bridged wards: is their own May 2026 contest in a raw source but not in the dataset?
    br = [w for w in fw if w["route"] == "bridge"]
    br_gss = {w["gss_code"] for w in br}
    from v2027_forecast import may26_ballot  # the dry run's own join (slug, baseline ballot, slug without "and")
    w27 = {w["id"]: w for w in read_json(REPO / "data/identity/wards-2027.json")["wards"]}
    b27 = {w["id"]: w for w in base["wards"]}
    br_bid = {w["id"]: may26_ballot(w27[w["id"]], may, b27) for w in br}
    br_have = {i for i, b in br_bid.items() if b and b not in in_dataset}
    br_in_ds = {i for i, b in br_bid.items() if b and b in in_dataset}
    br_prev = Counter((w.get("previous_contest") or {}).get("date") for w in br)

    # Does the baselines file reproduce the dataset's targets where both hold a contest?
    from common import LANES, LANE_KEY
    dsi = df.set_index("ballot_paper_id")
    repro = Counter()
    worst = defaultdict(float)
    for w in base["wards"]:
        b = w.get("baseline")
        if not b or w["method"] != "same_ward" or b.get("ballot_paper_id") not in dsi.index:
            continue
        r = dsi.loc[b["ballot_paper_id"]]
        dmax = max(abs(b["pooled"][p] - float(r[f"s_{LANE_KEY[p]}"])) for p in LANES)
        same_stood = all((b["pooled"][p] > 0) == bool(r[f"stood_{LANE_KEY[p]}"]) for p in LANES)
        repro[f"{b['source']} | shares within 0.0005: {dmax < 0.0005} | stood flags equal: {same_stood}"] += 1
        worst[b["source"]] = max(worst[b["source"]], dmax)
    hl_baseline_method = Counter((base_by_gss.get(g) or {}).get("method", "no record") for g in hl_gss)

    out = {
        "inputs": {"dataset_sha256": DATASET_SHA, "drive_csv_sha256": DRIVE_CSV_SHA,
                   "dc_history_snapshot": read_json(DC_HISTORY)["snapshot"]["snapshot_id"],
                   "baselines_sha256": sha256(BASELINES), "dryrun_sha256": sha256(DRYRUN)},
        "contests_by_group": t.group.value_counts().to_dict(),
        "contests_by_year_type_group_votes": {f"{y} | {ty} | {g} | {v}": int(n) for (y, ty, g, v), n in t.groupby(["year", "type", "group", "votes"]).size().items()},
        "contests_by_year_group": {f"{y} | {g}": int(n) for (y, g), n in t.groupby(["year", "group"]).size().items()},
        "contests_by_year_group_votes": {f"{y} | {g} | {v}": int(n) for (y, g, v), n in t.groupby(["year", "group", "votes"]).size().items()},
        "missing_by_year_type_votes": {f"{y} | {ty} | {v}": int(n) for (y, ty, v), n in t[t.group != "in_dataset"].groupby(["year", "type", "votes"]).size().items()},
        "missing_sources": {k: int(v) for k, v in t[t.group != "in_dataset"].sources.value_counts().items()},
        "councils_excluded_not_england": dict(not_england),
        "dryrun_forecast_wards": len(fw),
        "dryrun_history_less_wards": len(hl),
        "history_less_by_route": dict(Counter(w["route"] for w in hl)),
        "history_less_by_baseline": dict(hl_baseline),
        "history_less_given_a_previous_result_by_group": {k: len(v) for k, v in give.items()},
        "history_less_given_by_group_and_year": {k: {y: len(s) for y, s in sorted(v.items())} for k, v in give_by_year.items()},
        "history_less_given_by_any_group": len(any_give),
        "history_less_given_by_a_raw_source_with_candidate_votes": len(raw_give),
        "history_less_by_baseline_method": dict(hl_baseline_method),
        "baselines_reproduce_dataset_targets": dict(repro),
        "baselines_reproduce_largest_share_difference": dict(worst),
        "history_less_baseline_ballot_in_dataset_under_another_code": in_ds_other_code,
        "bridged_wards": len(br),
        "bridged_wards_previous_contest_date": {str(k): v for k, v in br_prev.items()},
        "bridged_wards_with_own_may2026_contest_missing_from_dataset": len(br_have),
        "bridged_wards_with_own_may2026_contest_in_dataset": len(br_in_ds),
        "bridged_wards_without_a_may2026_ballot": sum(1 for b in br_bid.values() if not b),
        "in_matrix_dropped_examples": t[t.group == "other_in_matrix_dropped_by_prepare"].bid.head(20).tolist(),
        "no_code_examples": t[t.group == "not_in_matrix_no_ward_code_match"].bid.head(20).tolist(),
    }
    OUT.mkdir(exist_ok=True)
    with open(OUT / "history_gap.json", "w") as f:
        json.dump(out, f, indent=1, default=str)
        f.write("\n")
    print(json.dumps(out, indent=1, default=str))


if __name__ == "__main__":
    main()
