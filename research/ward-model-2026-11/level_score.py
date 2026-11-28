"""Score the party level corrections L1 and L2 against C2 (LEVEL_SPEC.md).

  uv run python level_score.py

Input: cache/rebuild/corrected/bridge_level_predictions.pkl and fit_meta.pkl,
cache/level/level_corrections.pkl (this folder's own research cache, written by
rebuild_fit_score.py and level_fit.py, not untrusted data),
results/seats_actual_wards.csv (seats_build.py).
Output: results/level_summary.json
"""
from __future__ import annotations

import argparse
import json

import numpy as np
import pandas as pd

from bridge_level_fit import SCHEDULED
from common import CACHE, LANES, LANE_KEY, OUT, expit, logit
from rolling_score import arm_from
from score import Mapper, score_arm, top

SRC = CACHE / "rebuild" / "corrected"
KEYS = [LANE_KEY[p] for p in LANES]
ARMS = ["c2", "l1", "l2"]
YEAR = {d: d[:4] for d in SCHEDULED}
FIVE = [p for p in LANES if p != "Others"]


def half(d: str) -> str:
    return f"{d[:4]}H{1 if int(d[5:7]) <= 6 else 2}"


def build(df: pd.DataFrame, corr: dict) -> pd.DataFrame:
    ok = df["unforecastable"].isna().to_numpy() & df[[f"c2_{k}" for k in KEYS]].notna().any(axis=1).to_numpy()
    cuts = df["cut"].to_numpy()
    for arm in ("l1", "l2"):
        raw = {}
        for k in KEYS:
            off = df[f"off_c2_{k}"].to_numpy(dtype=float)
            L = np.array([corr.get((c, k), {}).get("level", 0.0) for c in cuts])
            o = off + L
            if arm == "l2":
                b = np.array([corr.get((c, k), {}).get("slope_shrunk", 1.0) for c in cuts])
                m = np.array([(corr.get((c, k), {}).get("mean_oof_prediction") or 0.0) for c in cuts])
                o = o + (b - 1.0) * (off - m)
            raw[k] = np.nan_to_num(expit(np.asarray(logit(df[f"a_{k}"])) + o), nan=0.0)  # a lane not standing has no offset
        tot = sum(raw.values())
        good = ok & (tot > 0)
        for k in KEYS:
            df[f"{arm}_{k}"] = np.where(good, raw[k] / np.where(tot > 0, tot, 1.0), np.nan)
    return df


def seats_m0(df: pd.DataFrame, arm: str, seats: pd.DataFrame) -> dict:
    out = {}
    for d in SCHEDULED:
        s = seats[seats["date"] == d]
        fc = {p: 0 for p in LANES}
        for b, up in zip(s.index, s["seats_up"]):
            sh = {p: df.at[b, f"{arm}_{LANE_KEY[p]}"] for p in LANES}
            sh = {p: (0.0 if np.isnan(v) else float(v)) for p, v in sh.items()}
            lead = top(sh)
            if lead:
                fc[lead] += int(up)
        ac = {p: int(s[f"won_{LANE_KEY[p]}"].sum()) for p in LANES}
        out[YEAR[d]] = {"forecast": fc, "actual": ac,
                        "rmse_five": round(float(np.sqrt(np.mean([(fc[p] - ac[p]) ** 2 for p in FIVE]))), 1)}
    out["mean_rmse_five"] = round(float(np.mean([out[YEAR[d]]["rmse_five"] for d in SCHEDULED])), 2)
    return out


def main():
    ap = argparse.ArgumentParser()
    # --dry: no corrections (L1 and L2 then equal C2), written to the path given; checks the plumbing
    # without producing any new score.
    ap.add_argument("--dry", metavar="OUT_JSON")
    args = ap.parse_args()
    # This folder's own cache (research output), not untrusted data.
    df = pd.read_pickle(SRC / "bridge_level_predictions.pkl")
    fit_meta = pd.read_pickle(SRC / "fit_meta.pkl")
    if args.dry:
        lv = {"corrections": {}, "fit_seconds": 0, "lane_jobs": 0, "cuts": 0, "skipped_small_window": []}
    else:
        lv = pd.read_pickle(CACHE / "level" / "level_corrections.pkl")
    df["is_by"] = df["is_by"].astype(bool)
    df = build(df.reset_index(drop=True), lv["corrections"]).set_index("ballot_paper_id")
    assert df.index.is_unique
    # C2 rebuilt from its cached offsets must equal the cached C2 shares (a check, not a score)
    chk = build(df.reset_index().copy(), {})
    for k in KEYS:
        a, b = chk[f"l1_{k}"].to_numpy(), df[f"c2_{k}"].to_numpy()
        assert np.array_equal(np.isnan(a), np.isnan(b)) and np.allclose(a[~np.isnan(a)], b[~np.isnan(b)]), k
    mapper = Mapper({p: fit_meta["lanes"][p]["oof_logit_resid_sd"] for p in LANES})
    act = {i: {p: float(r[f"s_{LANE_KEY[p]}"]) for p in LANES} for i, r in df.iterrows()}
    lead = {i: top(act[i]) for i in df.index}
    arms = {a: arm_from(df, a) for a in ARMS}
    assert set(arms["l1"]) == set(arms["c2"]) == set(arms["l2"]), "arms must forecast the same rows"

    sched, by = df[~df.is_by], df[df.is_by]
    sets = {f"may_{YEAR[d]}": sched[sched.date == d].index for d in SCHEDULED}
    sets["may_pooled_six"] = sched[sched.date.isin(SCHEDULED)].index
    sets["may_pooled_five_without_2026"] = sched[sched.date.isin(SCHEDULED[:-1])].index
    sets["byelections_all"] = by.index
    sets["byelections_after_2026-05-07"] = by[by.date > "2026-05-07"].index
    for h in sorted(set(by.date.map(half))):
        sets[f"byelections_{h}"] = by[by.date.map(half) == h].index

    res = {"spec": "LEVEL_SPEC.md", "sets": {}}
    for s, ids in sets.items():
        ids = list(ids)
        r = {"rows": len(ids), "arms": {a: score_arm(ids, arms[a], act, lead, mapper) for a in ARMS}}
        for a in ("l1", "l2"):
            gained = sum(1 for i in ids if i in arms[a] and arms[a][i]["leader"] == lead[i] and arms["c2"][i]["leader"] != lead[i])
            lost = sum(1 for i in ids if i in arms[a] and arms[a][i]["leader"] != lead[i] and arms["c2"][i]["leader"] == lead[i])
            changed = sum(1 for i in ids if i in arms[a] and arms[a][i]["leader"] != arms["c2"][i]["leader"])
            r[f"{a}_vs_c2"] = {"gained": gained, "lost": lost, "leader_changed": changed}
        res["sets"][s] = r

    seats = pd.read_csv(OUT / "seats_actual_wards.csv").set_index("ballot_paper_id")
    seats = seats[seats.index.isin([i for i in arms["c2"]])]
    res["seats_m0"] = {a: seats_m0(df, a, seats) for a in ARMS}
    res["seats_m0"]["scored_wards"] = {YEAR[d]: int((seats["date"] == d).sum()) for d in SCHEDULED}

    def lc(s, a):
        return res["sets"][s]["arms"][a]["leader_correct"]

    def mae(s, a):
        return res["sets"][s]["arms"][a]["share_mae_pp_all_lanes"]

    rules = {}
    for a in ("l1", "l2"):
        per = {YEAR[d]: {"wards": res["sets"][f"may_{YEAR[d]}"]["rows"], "c2": lc(f"may_{YEAR[d]}", "c2"), a: lc(f"may_{YEAR[d]}", a),
                         "difference": lc(f"may_{YEAR[d]}", a) - lc(f"may_{YEAR[d]}", "c2")} for d in SCHEDULED}
        at_least = [y for y, v in per.items() if v["difference"] >= 0]
        worse = [y for y, v in per.items() if -v["difference"] > 0.01 * v["wards"]]
        r = {
            "per_may": per,
            "rule_1_pooled_six_more_leaders": lc("may_pooled_six", a) > lc("may_pooled_six", "c2"),
            "rule_2_pooled_six_share_error_no_higher": mae("may_pooled_six", a) <= mae("may_pooled_six", "c2"),
            "rule_3_at_least_as_many_in_four_of_six": len(at_least) >= 4,
            "rule_4_no_may_worse_by_more_than_1pct": not worse,
            "rule_5_byelection_leaders_no_fewer": lc("byelections_all", a) >= lc("byelections_all", "c2"),
            "rule_6_byelection_share_error_no_higher": mae("byelections_all", a) <= mae("byelections_all", "c2"),
            "rule_7_seat_rmse_five_mean_no_higher": res["seats_m0"][a]["mean_rmse_five"] <= res["seats_m0"]["c2"]["mean_rmse_five"],
            "rule_8_pooled_five_without_2026_more_leaders": lc("may_pooled_five_without_2026", a) > lc("may_pooled_five_without_2026", "c2"),
            "mays_at_least_as_many": at_least,
            "mays_worse_by_more_than_1pct": worse,
        }
        r["supported"] = all(v for k, v in r.items() if k.startswith("rule_"))
        rules[a] = r
    res["rules"] = rules
    sup = [a for a in ("l1", "l2") if rules[a]["supported"]]
    res["adopt"] = (max(sup, key=lambda a: (lc("may_pooled_six", a), a == "l1")) if sup else None)

    levels = {}
    for (c, k), v in sorted(lv["corrections"].items()):
        levels.setdefault(c, {})[k] = {kk: (round(vv, 4) if isinstance(vv, float) else vv) for kk, vv in v.items()}
    res["corrections_per_cut"] = levels
    res["run"] = {"fit_seconds": round(lv["fit_seconds"]), "lane_jobs": lv["lane_jobs"], "cuts": lv["cuts"],
                  "pairs_with_small_window": len(lv["skipped_small_window"])}

    OUT.mkdir(exist_ok=True)
    with open(args.dry or (OUT / "level_summary.json"), "w") as f:
        json.dump(res, f, indent=1, default=float)
        f.write("\n")

    for s, r in res["sets"].items():
        print(s, r["rows"], " ".join(f"{a} {r['arms'][a]['leader_correct']} ({r['arms'][a]['share_mae_pp_all_lanes']})" for a in ARMS),
              r["l1_vs_c2"], r["l2_vs_c2"])
    for a in ARMS:
        print("seats", a, res["seats_m0"][a]["mean_rmse_five"], {y: res["seats_m0"][a][y]["rmse_five"] for y in YEAR.values()})
    for a, r in rules.items():
        print(a, "supported" if r["supported"] else "not supported", {k: v for k, v in r.items() if k.startswith("rule_")})
    print("adopt", res["adopt"])


if __name__ == "__main__":
    main()
