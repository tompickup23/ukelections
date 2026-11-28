"""Score the rolling forecasts (TWO_LAYER_SPEC.md) with the November scorer's
conventions: leader by full-slate share over six pooled lanes, share error over
lanes with a forecast or an actual share, multi-class Brier with the common mapping.

Output: results/rolling_summary.json
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from common import BLEND_WEIGHT_MODEL, CACHE, LANES, LANE_KEY, OUT, logit, read_json
from score import CANDIDATE_FILE, DRAWS, SEED, Mapper, blend, brier, pooled, renorm, score_arm, top

KEYS = [LANE_KEY[p] for p in LANES]


def shares(row, prefix):
    sh = {p: float(row[f"{prefix}_{LANE_KEY[p]}"]) for p in LANES}
    sh = {p: (0.0 if np.isnan(v) else v) for p, v in sh.items()}
    return sh if sum(sh.values()) > 0 else None


def arm_from(frame, prefix):
    out = {}
    for i, r in frame.iterrows():
        sh = shares(r, prefix)
        if sh:
            out[i] = {"leader": top(sh), "shares": sh}
    return out


def main():
    # Local caches written by this folder's own scripts.
    roll = pd.read_pickle(CACHE / "rolling_predictions.pkl").set_index("ballot_paper_id")
    nov = pd.read_pickle(CACHE / "predictions.pkl").set_index("ballot_paper_id")
    fit_meta = pd.read_pickle(CACHE / "fit_meta.pkl")
    sig_sched = {p: fit_meta["lanes"][p]["oof_logit_resid_sd"] for p in LANES}
    mapper = Mapper(sig_sched)

    act = {i: {p: float(r[f"s_{LANE_KEY[p]}"]) for p in LANES} for i, r in roll.iterrows()}
    lead = {i: top(act[i]) for i in roll.index}

    by = roll[roll.is_by]
    by107 = by[by.set == "byelection"]
    by_pre = by[by.set != "byelection"]
    s25 = roll[(~roll.is_by) & (roll.date == "2025-05-01")]
    s26 = roll[(~roll.is_by) & (roll.date == "2026-05-07")]
    may26_all = roll[roll.set == "may26"]

    arms = {name: arm_from(roll, pre) for name, pre in [("layer_off", "base"), ("s1_pooled", "s1"), ("s2_offsets", "s2"), ("s3_ridge", "s3")]}
    arms["november_frozen"] = arm_from(nov.rename(columns={f"m_{k}": f"nov_{k}" for k in KEYS}), "nov")

    site = {}
    for i, r in nov[nov.set == "byelection"].iterrows():
        sf = pooled(r["site_forecast"]) if isinstance(r["site_forecast"], dict) else None
        if sf and top(sf):
            site[i] = {"leader": top(sf), "shares": renorm(sf)}
    arms["site"] = site

    cand = {}
    for i, e in read_json(CANDIDATE_FILE)["predictions"].items():
        if e and e.get("prediction"):
            sh = pooled({p: v.get("pct", 0) for p, v in e["prediction"].items()})
            cand[i] = {"leader": top(sh), "shares": sh}
    arms["candidate_engine"] = cand
    for name in ["layer_off", "s1_pooled", "november_frozen"]:
        b = {}
        for i, c in cand.items():
            m = arms[name].get(i)
            if m:
                sh = blend(c["shares"], m["shares"], BLEND_WEIGHT_MODEL)
                b[i] = {"leader": top(sh), "shares": sh}
        arms[f"blend_{name}"] = b

    def table(ids, names):
        ids = list(ids)
        return {n: score_arm(ids, arms[n], act, lead, mapper) for n in names}

    by_names = ["layer_off", "s1_pooled", "s2_offsets", "s3_ridge"]
    results = {
        "byelections_all_652": table(by.index, by_names),
        "byelections_before_may_2026": table(by_pre.index, by_names),
        "byelections_after_may_2026_107": table(by107.index, by_names + ["november_frozen", "site"]),
        "scheduled_2025": table(s25.index, ["layer_off", "s1_pooled"]),
        "scheduled_2026": table(s26.index, ["layer_off", "s1_pooled", "november_frozen"]),
        "may_2026_model_scorable_2596": table(may26_all.index, ["layer_off", "s1_pooled", "november_frozen"]),
    }
    common26 = [i for i in may26_all.index if i in cand]
    results["may_2026_with_candidate_engine"] = table(
        common26, ["candidate_engine", "layer_off", "november_frozen", "blend_layer_off", "blend_s1_pooled", "blend_november_frozen"])

    # ---- separate uncertainty: S2 forecasts, scheduled sd against rolling by-election sd
    rng = np.random.default_rng(SEED)
    z = rng.standard_normal((DRAWS, len(LANES)))

    def probs(sh, sig):
        s = np.array([sh.get(p, 0) for p in LANES])
        live = s > 0
        lg = np.where(live, logit(np.where(live, s, 0.5)), -np.inf)
        draws = lg[None, :] + z * sig[None, :]
        draws[:, ~live] = -np.inf
        return dict(zip(LANES, np.bincount(np.argmax(draws, axis=1), minlength=len(LANES)) / DRAWS))

    sched_sig = np.array([sig_sched[p] for p in LANES])
    b_s, b_b, used = [], [], 0
    sd_seen = {p: [] for p in LANES}
    for i, r in by.iterrows():
        m = arms["s2_offsets"].get(i)
        if not m:
            continue
        sig = sched_sig.copy()
        any_by = False
        for j, k in enumerate(KEYS):
            v = r[f"sd_by_{k}"]
            if not np.isnan(v):
                sig[j] = v
                any_by = True
                sd_seen[LANES[j]].append(float(v))
        if not any_by:
            continue
        used += 1
        b_s.append(brier(probs(m["shares"], sched_sig), lead[i]))
        b_b.append(brier(probs(m["shares"], sig), lead[i]))
    results["uncertainty_s2_on_byelections"] = {
        "contests_with_a_byelection_sd": used,
        "brier_scheduled_sd": round(float(np.mean(b_s)), 4) if b_s else None,
        "brier_byelection_sd": round(float(np.mean(b_b)), 4) if b_b else None,
        "scheduled_sd": {p: round(sig_sched[p], 3) for p in LANES},
        "byelection_sd_mean_over_days": {p: round(float(np.mean(v)), 3) if v else None for p, v in sd_seen.items()},
    }

    # ---- carry-over, descriptive: S2 offset on the day against the base error at the May election
    carry = {}
    for name, frame in [("2025-05-01", s25), ("2026-05-07", s26)]:
        carry[name] = {}
        for p in LANES:
            k = LANE_KEY[p]
            stood = frame[frame[f"stood_{k}"].astype(bool) & frame[f"base_{k}"].notna() & (frame[f"base_{k}"] > 0)]
            err = np.asarray(logit(stood[f"s_{k}"])) - np.asarray(logit(stood[f"base_{k}"]))
            carry[name][p] = {
                "byelection_offset_logit": round(float(frame[f"off_s2_{k}"].iloc[0]), 3),
                "may_base_error_logit": round(float(np.mean(err)), 3) if len(err) else None,
                "wards": int(len(stood)),
            }
    results["carry_over"] = carry
    results["counts"] = {
        "byelections": int(len(by)), "after_may_2026": int(len(by107)), "scheduled_2025": int(len(s25)),
        "scheduled_2026": int(len(s26)), "polling_days": int(roll.date.nunique()),
    }

    OUT.mkdir(exist_ok=True)
    with open(OUT / "rolling_summary.json", "w") as f:
        json.dump(results, f, indent=1, default=float)
        f.write("\n")

    for sname, res in results.items():
        if sname in ("uncertainty_s2_on_byelections", "carry_over", "counts"):
            print(sname, json.dumps(res))
            continue
        print(sname)
        for a, r in res.items():
            print(f"  {a:22s} {r['leader_correct']:5d}/{r['wards']} ({r['wards_forecast']} forecast) MAE {r['share_mae_pp_all_lanes']} Brier {r['brier_common']}  bias "
                  + ", ".join(f"{p[:3]} {r['by_party'][p]['signed_bias_pp']}" for p in LANES)
                  + "  leads " + ", ".join(f"{p[:3]} {r['by_party'][p]['called_leads']}/{r['by_party'][p]['actual_leads']}" for p in LANES))


if __name__ == "__main__":
    main()
