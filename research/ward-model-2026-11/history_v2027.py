"""Rerun the 2027 dry run on the extended dataset (HISTORY_SPEC.md), only if (a) passed.

    uv run python history_v2027.py

Runs v2027_forecast.main and v2027_aggregate.main unchanged except: the base dataset
is cache/history/bridge_level_dataset.pkl (its hash added to the dry run's hash
check), and outputs go to new files beside PR 219's:
  data/forecasts/research/wards-2027-dryrun-history.json
  results/history_v2027_coverage.json, results/history_v2027_results.json
Then reports, for the base and the extended dataset: Reform UK groups of the 3,696
verified wards (from the dry run's own built frame) and the standing rule's error
on May 2026; written to results/history_v2027_compare.json.
Unpublished dry run, not a prediction. Research only; no page reads any of it.
"""
from __future__ import annotations

import json
import sys
from collections import Counter

import pandas as pd

import common
from common import CACHE, HERE, LANES, LANE_KEY, MAJOR, OUT, REPO, read_json, sha256

NEW_BASE = CACHE / "history" / "bridge_level_dataset.pkl"
OLD_BASE = CACHE / "rebuild" / "corrected" / "bridge_level_dataset.pkl"
KEYS = [LANE_KEY[p] for p in LANES]
MAY26 = "2026-05-07"


def reform_groups(vf, base_path):
    """Build the dry run's frame on a base dataset (no fit) and count the Reform UK groups."""
    import live_forecast as lf
    vf.BASE = base_path
    wj = read_json(vf.WARDS)
    wards_all = wj["wards"]
    verified = [w for w in wards_all if w["block"] == "verified"]
    universe = set(pd.read_csv(common.UNIVERSE, usecols=["gss"]).gss)
    # This folder's own cache, written by v2027_bridge.py.
    bridge = pd.read_pickle(vf.BRIDGE)
    route = vf.routes(wards_all, universe, bridge)
    df, tgt, meta, prevs, _ = vf.build(verified, route, bridge, lf.load_polls(vf.POLLS_TS), vf.load_contests_at(vf.CONTEST_COMMIT))
    grp = Counter()
    by_id = {}
    for i in tgt:
        w, info = meta[df.at[i, "ballot_paper_id"]]
        if int(df.at[i, "has_prev"]) == 1:
            by_id[w["id"]] = "previous_with_reform_uk" if pd.notna(df.at[i, "prev_rel_ref"]) else "previous_without_reform_uk"
        else:
            by_id[w["id"]] = "no_previous"
    for w in verified:
        grp[by_id.get(w["id"], "no_previous")] += 1
    return dict(grp), sum(1 for b in prevs if b), by_id


def file_counts(path):
    """Forecast wards, wards with an earlier contest, and wards where M50's swing benchmark applies, from a dry run file."""
    fw = [w for w in read_json(path)["wards"] if w.get("forecast")]
    return {"forecast_wards": len(fw), "with_previous_contest": sum(1 for w in fw if w.get("previous_contest")),
            "with_anchored_previous_contest": sum(1 for w in fw if (w.get("previous_contest") or {}).get("anchored")),
            "m50_benchmark_used": sum(1 for w in fw if w.get("m50_benchmark") == "swing_from_previous_contest"),
            "others_assumed": sum(1 for w in fw if "Others" in (w.get("standing_assumed") or []))}


def standing_rule_may26(ds: pd.DataFrame, rows: pd.DataFrame):
    """V2027_SPEC.md's rule applied to May 2026 rows using only earlier scheduled rows of the same code."""
    sched = ds[~ds.is_by.astype(bool) & ds.gss.notna() & (ds.gss != "") & ds.s_ref.notna() & (ds.date < MAY26)]
    last = sched.sort_values("date").groupby("gss").tail(1).set_index("gss")
    err = {p: [0, 0] for p in LANES}
    whole = 0
    for _, r in rows.iterrows():
        oth = bool(last.at[r.gss, "stood_oth"]) if r.gss in last.index else False
        ok = True
        for p in LANES:
            assumed = True if p in MAJOR else oth
            stood = bool(r[f"stood_{LANE_KEY[p]}"])
            if assumed and not stood:
                err[p][0] += 1
                ok = False
            elif stood and not assumed:
                err[p][1] += 1
                ok = False
        whole += ok
    return {"wards": int(len(rows)), "whole_slate_right": int(whole),
            "errors_assumed_not_stood_and_stood_not_assumed": {p: v for p, v in err.items()}}


def main():
    res = json.loads((HERE / "results/history_results.json").read_text())
    if not res["a"]["passes"]:
        sys.exit("STOP: (a) did not pass; HISTORY_SPEC.md says the dry run is not rerun")
    man = json.loads((HERE / "results/history_manifest.json").read_text())
    new_sha = man["outputs"]["bridge_level_dataset.pkl"]
    if sha256(NEW_BASE) != new_sha:
        sys.exit("STOP: extended dataset changed since its manifest")

    import v2027_forecast as vf
    import v2027_aggregate as va
    old_sha = vf.HASHES[vf.BASE]

    # Reform UK groups and history counts on the base, built exactly as the first dry run did.
    g_old, prev_old, ids_old = reform_groups(vf, OLD_BASE)

    vf.HASHES[NEW_BASE] = new_sha
    vf.BASE = NEW_BASE
    vf.OUTFILE = REPO / "data/forecasts/research/wards-2027-dryrun-history.json"
    vf.COVERAGE = OUT / "history_v2027_coverage.json"
    captured = {}
    orig_build = vf.build

    def build(*a, **k):
        r = orig_build(*a, **k)
        captured["r"] = r
        return r

    vf.build = build
    vf.main([])
    # Label the copies of the dry run's hard-coded strings that would otherwise name the base.
    doc = read_json(vf.OUTFILE)
    doc["inputs"]["dataset"] = {"file": "research/ward-model-2026-11/cache/history/bridge_level_dataset.pkl", "sha256": new_sha,
                                "built_by": "history_build.py (HISTORY_SPEC.md)"}
    doc["about"] += " This copy is the rerun on the extended dataset of HISTORY_SPEC.md; see HISTORY_RESULTS.md."
    vf.OUTFILE.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    va.BASE = NEW_BASE
    va.OUTFILE = vf.OUTFILE
    va.RESULTS = OUT / "history_v2027_results.json"
    va.main()
    r = read_json(va.RESULTS)
    r["source"]["dry_run"] = "data/forecasts/research/wards-2027-dryrun-history.json"
    r["source"]["sha256"] = sha256(vf.OUTFILE)
    va.RESULTS.write_text(json.dumps(r, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    df, tgt, meta, prevs, _ = captured["r"]
    g_new = Counter()
    ids_new = {}
    for i in tgt:
        w, _ = meta[df.at[i, "ballot_paper_id"]]
        ids_new[w["id"]] = ("previous_with_reform_uk" if pd.notna(df.at[i, "prev_rel_ref"]) else "previous_without_reform_uk") \
            if int(df.at[i, "has_prev"]) == 1 else "no_previous"
    verified = [w for w in read_json(vf.WARDS)["wards"] if w["block"] == "verified"]
    for w in verified:
        g_new[ids_new.get(w["id"], "no_previous")] += 1
    moves = Counter(f"{ids_old.get(w['id'], 'no_previous')} -> {ids_new.get(w['id'], 'no_previous')}" for w in verified)

    # Standing rule on May 2026: the base's 2,576 rows, and the 97 added rows apart.
    # Our own research cache, hash checked above and in the dry run; not untrusted data.
    old = pd.read_pickle(OLD_BASE)
    new = pd.read_pickle(NEW_BASE)
    orig_may = old[(old.date == MAY26) & ~old.is_by.astype(bool)]
    new_orig_may = new[new.ballot_paper_id.isin(set(orig_may.ballot_paper_id))]
    added_may = new[(new.date == MAY26) & (new.source == "history_bridge_may26")]
    stand = {"base_dataset_2576": standing_rule_may26(old, orig_may),
             "extended_dataset_same_2576": standing_rule_may26(new, new_orig_may),
             "extended_dataset_added_97": standing_rule_may26(new, added_may),
             "reproduces_pr219_table": None}
    stand["reproduces_pr219_table"] = stand["base_dataset_2576"]["whole_slate_right"] == 1425

    out = {"spec": "HISTORY_SPEC.md", "base_dataset_sha256": old_sha, "extended_dataset_sha256": new_sha,
           "dry_run_files": {name: file_counts(f) for name, f in (("pr219", REPO / "data/forecasts/research/wards-2027-dryrun.json"), ("extended", vf.OUTFILE))},
           "reform_uk_groups_verified_3696": {"base": g_old, "extended": dict(g_new), "moves": dict(moves),
                                              "pr220_projection_without_reform_uk": 1955},
           "standing_rule_may_2026": stand}
    (OUT / "history_v2027_compare.json").write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
