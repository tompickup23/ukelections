"""Reform UK spread diagnosis (SPREAD_DIAGNOSIS.md). No new fit.

Splits every forecast row of arm C2 on the corrected inputs (REBUILD_RESULTS.md,
"Both" column), and of the swing blend M50 rebuilt from those same cached
forecasts (SWINGBLEND_RESULTS.md, PR 216), by whether the Reform UK lane has a
previous result in the same ward code, and reports Reform UK's spread on each.

  uv run python spread_diagnose.py

Input: cache/rebuild/corrected/bridge_level_predictions.pkl, cache/rebuild/corrected/fit_meta.pkl,
cache/rebuild/corrected/bridge_level_dataset.pkl (all written by this folder's own
rebuild scripts; hash checked below).
Output: results/spread_diagnosis.json
Research only; nothing on the site reads it.
"""
from __future__ import annotations

import json
import sys

import numpy as np
import pandas as pd

from bridge_level_fit import STAND
from backtest_b_fit import CLEAN
from common import CACHE, LANES, LANE_KEY, OUT, expit, logit, sha256
from rolling_score import arm_from
from score import Mapper, score_arm, top

SRC = CACHE / "rebuild" / "corrected"
PRED, META, DATA = SRC / "bridge_level_predictions.pkl", SRC / "fit_meta.pkl", SRC / "bridge_level_dataset.pkl"
HASH = {PRED: "bb7586ce43bded0159aa7dca8af41fbf1532a26ac7ae3a5337c363d6d8e25d8a",
        META: "936d07ee4d9004d1cdd811796f60dbfb1b22a723e7575789b56292c287ac67ad",
        DATA: "3393cfdba3437f46ad2f2b8485e1621b8a38d4c5605ee33c4c4cd9be38de53a8"}
SCHED = {"2019": "2019-05-02", "2021": "2021-05-06", "2022": "2022-05-05", "2023": "2023-05-04",
         "2025": "2025-05-01", "2026": "2026-05-07"}
BASELINE = {"may_pooled_six": (9135, 6.08), "by_all": (786, 7.26)}
REF = "Reform UK"
GROUPS = ["reform_prev", "reform_no_prev_ward_had_contest", "reform_no_prev_contest", "reform_not_standing"]


def m50(df, c2, w=0.5):
    """swingblend_score.blend (PR 216, branch claude/research-swing-blend-0e4f46), copied unchanged."""
    out = {}
    for i, e in c2.items():
        r = df.loc[i]
        m = e["shares"]
        if pd.isna(r["prev_date"]) or pd.isna(r["prev_anchor_kind"]) or pd.isna(r["anchor_kind"]):
            out[i] = e
            continue
        live = [p for p in LANES if m.get(p, 0) > 0]
        old = [p for p in live if float(r[f"prev_s_{LANE_KEY[p]}"]) > 0]
        if not old:
            out[i] = e
            continue
        raw = {}
        for p in old:
            k = LANE_KEY[p]
            a_now, a_prev = r[f"a_{k}"], r[f"prev_a_{k}"]
            change = 0.0 if (pd.isna(a_now) or pd.isna(a_prev)) else float(logit(a_now) - logit(a_prev))
            raw[p] = float(expit(logit(float(r[f"prev_s_{k}"])) + change))
        m_old = sum(m[p] for p in old)
        tot = sum(raw.values())
        z = {}
        for p in live:
            if p in raw:
                b = raw[p] / tot * m_old
                z[p] = w * float(logit(m[p])) + (1 - w) * float(logit(b))
            else:
                z[p] = float(logit(m[p]))
        sh = {p: float(expit(v)) for p, v in z.items()}
        s = sum(sh.values())
        sh = {p: sh.get(p, 0.0) / s for p in LANES}
        out[i] = {"leader": top(sh), "shares": sh}
    return out


def reform_block(ids, arm, act, lead):
    """Reform UK's spread on one set of rows: forecastable rows where it stood."""
    st = [i for i in ids if arm.get(i) and arm[i]["shares"].get(REF, 0) > 0]
    f = np.array([arm[i]["shares"][REF] for i in st])
    s = np.array([act[i][REF] for i in st])
    won = [i for i in ids if lead[i] == REF]
    called = [i for i in ids if arm.get(i) and arm[i]["leader"] == REF]
    gaps_f, gaps_a = [], []
    for i in won:
        e = arm.get(i)
        if not e:
            continue
        others_f = [v for p, v in e["shares"].items() if p != REF and v > 0]
        if not others_f:
            continue
        gaps_f.append(e["shares"][REF] - max(others_f))
        gaps_a.append(act[i][REF] - max(v for p, v in act[i].items() if p != REF))
    r = {"rows_reform_stood_forecast": len(st), "wards_won": len(won), "wards_called_first": len(called),
         "called_first_and_won": len(set(won) & set(called))}
    if len(st):
        r["signed_error_pp"] = round(100 * float(np.mean(f - s)), 2)
        r["mae_pp"] = round(100 * float(np.mean(np.abs(f - s))), 2)
        r["mean_forecast_pp"] = round(100 * float(np.mean(f)), 2)
        r["mean_actual_pp"] = round(100 * float(np.mean(s)), 2)
        r["sd_forecast_pp"] = round(100 * float(np.std(f)), 2)
        r["sd_actual_pp"] = round(100 * float(np.std(s)), 2)
    if len(st) > 10 and np.std(f) > 0:
        r["calibration_slope"] = round(float(np.polyfit(f, s, 1)[0]), 3)
    if gaps_f:
        r["won_mean_forecast_lead_pp"] = round(100 * float(np.mean(gaps_f)), 2)
        r["won_mean_actual_lead_pp"] = round(100 * float(np.mean(gaps_a)), 2)
        r["won_with_rival_forecast"] = len(gaps_f)
    return r


def main():
    for p, want in HASH.items():
        if sha256(p) != want:
            sys.exit(f"STOP: {p} does not match its hash")
    # This folder's own caches (research output, hash checked above), not untrusted data.
    df = pd.read_pickle(PRED).set_index("ballot_paper_id")
    data = pd.read_pickle(DATA)
    fm = pd.read_pickle(META)
    df["is_by"] = df.is_by.astype(bool)
    mapper = Mapper({p: fm["lanes"][p]["oof_logit_resid_sd"] for p in LANES})
    act = {i: {p: float(r[f"s_{LANE_KEY[p]}"]) for p in LANES} for i, r in df.iterrows()}
    lead = {i: top(act[i]) for i in df.index}
    arms = {"c2": arm_from(df, "c2")}
    arms["m50"] = m50(df, arms["c2"])

    # ---- groups: the model's own previous result rule (latest earlier contest, same GSS code)
    st = df.stood_ref.astype(bool)
    prev = df.prev_rel_ref.notna()
    hp = df.has_prev.fillna(0).astype(bool)
    grp = pd.Series(np.select([st & prev, st & ~prev & hp, st & ~prev & ~hp], GROUPS[:3], GROUPS[3]), index=df.index)

    # ---- sensitivity: any earlier Reform UK result in the same GSS code, not only in the latest contest
    h = data[data.gss.notna() & (data.gss != "") & data.stood_ref.astype(bool)][["gss", "date"]]
    first_ref = h.groupby("gss").date.min()
    any_prev_ref = pd.Series([bool(g in first_ref.index and first_ref[g] < d) for g, d in zip(df.gss, df.date)], index=df.index)

    sched = df[~df.is_by]
    sets = {f"may_{y}": sched[sched.date == d].index for y, d in SCHED.items()}
    sets["may_pooled_six"] = sched[sched.date.isin(SCHED.values())].index
    sets["may_2025_2026"] = sched[sched.date.isin([SCHED["2025"], SCHED["2026"]])].index
    by = df[df.is_by]
    sets["by_all"] = by.index
    sets["by_before_2025-05-01"] = by[by.date < "2025-05-01"].index
    sets["by_from_2025-05-01"] = by[by.date >= "2025-05-01"].index
    sets["by_after_2026-05-07"] = by[by.date > "2026-05-07"].index
    sets["pooled_from_2025-05-01"] = sets["may_2025_2026"].append(sets["by_from_2025-05-01"])

    res = {"inputs": {str(p.relative_to(CACHE.parent)): h_ for p, h_ in HASH.items()}, "sets": {}}
    for s, (lc, mae) in BASELINE.items():
        m = score_arm(list(sets[s]), arms["c2"], act, lead, mapper)
        if m["leader_correct"] != lc or abs(m["share_mae_pp_all_lanes"] - mae) > 1e-9:
            sys.exit(f"STOP: C2 {s} is {m['leader_correct']} / {m['share_mae_pp_all_lanes']}, expected {lc} / {mae}")
    res["baseline_check"] = "C2 reproduces REBUILD_RESULTS.md 'Both': six Mays 9,135 (6.08), by-elections 786 (7.26)"

    for s, ids in sets.items():
        ids = list(ids)
        out = {"rows": len(ids), "groups": {}}
        for g in ["all"] + GROUPS:
            gi = ids if g == "all" else [i for i in ids if grp[i] == g]
            out["groups"][g] = {"rows": len(gi),
                                "unforecastable": int(sum(1 for i in gi if i not in arms["c2"])),
                                "arms": {}}
            for a in arms:
                sc = score_arm(gi, arms[a], act, lead, mapper) if gi else None
                out["groups"][g]["arms"][a] = {
                    "leaders_called": sc["leader_correct"] if sc else 0,
                    "share_mae_pp_all_lanes": sc["share_mae_pp_all_lanes"] if sc else None,
                    "reform": reform_block(gi, arms[a], act, lead),
                }
        stood_ids = [i for i in ids if st[i]]
        out["sensitivity_any_earlier_reform_result"] = {
            "reform_stood": len(stood_ids),
            "latest_contest_rule": int(sum(prev[i] for i in stood_ids)),
            "any_earlier_contest": int(sum(any_prev_ref[i] for i in stood_ids)),
        }
        res["sets"][s] = out

    # ---- how the inputs treat a lane with no previous result
    feats = list(dict.fromkeys(CLEAN + STAND))
    tr = data[data.anchor_kind.notna()]
    res["inputs_for_a_lane_without_previous_result"] = {
        "c2_inputs": len(feats),
        "previous_result_inputs": [f for f in feats if f.startswith("prev_") or f == "has_prev"],
        "rule": "prev_rel_<lane> is the lane's share at the latest earlier contest under the same GSS code minus that "
                "year's mean share for the lane; NaN when there is no earlier contest or the lane did not stand in it "
                "(prepare.py, lines 279 to 303). HistGradientBoostingRegressor routes NaN to a learned side of each split.",
        "rows_by_year_reform_stood": {
            y: {"reform_stood": int(g.stood_ref.astype(bool).sum()),
                "prev_rel_ref_present": int((g.stood_ref.astype(bool) & g.prev_rel_ref.notna()).sum()),
                "ward_had_previous_contest_reform_absent": int((g.stood_ref.astype(bool) & g.prev_rel_ref.isna() & g.has_prev.fillna(0).astype(bool)).sum()),
                "no_previous_contest": int((g.stood_ref.astype(bool) & ~g.has_prev.fillna(0).astype(bool)).sum())}
            for y, g in tr.groupby(tr.date.str[:4])},
        "reform_training_rows_at_cut": {
            c: {"reform_stood_anchored_before_cut": int(len(t)),
                "with_prev_rel_ref": int(t.prev_rel_ref.notna().sum()),
                "ward_had_previous_contest_reform_absent": int((t.prev_rel_ref.isna() & t.has_prev.fillna(0).astype(bool)).sum()),
                "no_previous_contest": int((~t.has_prev.fillna(0).astype(bool)).sum())}
            for c in (SCHED["2025"], SCHED["2026"])
            for t in [tr[(tr.date < c) & tr.stood_ref.astype(bool)]]},
    }
    OUT.mkdir(exist_ok=True)
    with open(OUT / "spread_diagnosis.json", "w") as f:
        json.dump(res, f, indent=1, default=float)
        f.write("\n")

    print(res["baseline_check"])
    for s, o in res["sets"].items():
        print(s, o["rows"], "sens", o["sensitivity_any_earlier_reform_result"])
        for g, v in o["groups"].items():
            for a, m in v["arms"].items():
                r = m["reform"]
                print(f"  {g:34s} {a} rows {v['rows']:5d} lead {m['leaders_called']:5d} mae {m['share_mae_pp_all_lanes']} | ref n {r['rows_reform_stood_forecast']} "
                      f"slope {r.get('calibration_slope')} err {r.get('signed_error_pp')} mae {r.get('mae_pp')} called/won {r['wards_called_first']}/{r['wards_won']} "
                      f"lead f/a {r.get('won_mean_forecast_lead_pp')}/{r.get('won_mean_actual_lead_pp')}")
    print(json.dumps(res["inputs_for_a_lane_without_previous_result"], indent=1))


if __name__ == "__main__":
    main()
