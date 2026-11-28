"""Score every arm on May 2026 (the site's yardstick) and on the post-May
council by-elections.

May 2026 conventions follow scripts/score-may-2026-like-for-like.mjs exactly:
local wards in the post-audit (2,897), five parties plus Others pooled, leader
by full-slate vote share, a ward an arm cannot forecast counts as a miss in the
overall figure, and per-party error is taken over wards where the party has a
forecast or an actual share. Labour Co-operative is not merged (yardstick default).

Arms on May 2026:
  published   polling-day forecast, git 5e85c84 (sha256 checked), leaders from the post-audit rows
  last_time   the party that led the ward's previous result (step 1 "Baseline" in the polling-day file)
  candidate   the 24 October 2026 candidate engine, from replay-may-2026-candidate.mjs
  model       this research model
  blend       0.5 x candidate + 0.5 x model, renormalised (weight fixed before scoring)

Arms on the by-elections:
  site        the site's by-election forecast as it stands in the contest file
  last_time   the ward's prior result in the contest file
  model       this research model (frozen; inputs updated with May 2026 results)
  blend_site  0.5 x site + 0.5 x model, renormalised (weight fixed before scoring)

Brier: multi-class over the six pooled lanes. "common" maps every arm's shares to
leader probabilities the same way: independent normal noise on the logit of each
lane, with the per-lane standard deviation of the model's out-of-fold training
residuals, 4,000 draws, fixed seed. "native" uses an arm's own probabilities where
it publishes them (published: win_probability; site: win_probability;
last_time: all on the previous leader).
"""
from __future__ import annotations

import json
import subprocess
from collections import defaultdict

import numpy as np
import pandas as pd

from common import (
    ARMS, BLEND_WEIGHT_MODEL, CACHE, LANES, LANE_KEY, MAY26_ACTUALS, OUT, POSTAUDIT, REPO,
    logit, pool_party, read_json,
)

PUBLISHED_COMMIT = "5e85c84"
PUBLISHED_SHA = "566868149ccbdf67015bcf8d70656f2f34a300b16bf3b964cd9835f8e00139e5"
CANDIDATE_FILE = ARMS / "candidate-2026-10-24.json"
DRAWS = 4000
SEED = 7


def pooled(d: dict | None) -> dict | None:
    if not d:
        return None
    out = defaultdict(float)
    for k, v in d.items():
        out[pool_party(k)] += float(v or 0)
    return {p: out.get(p, 0.0) for p in LANES}


def top(d: dict | None):
    if not d:
        return None
    items = [(p, v) for p, v in d.items() if v > 0]
    if not items:
        return None
    return max(items, key=lambda kv: kv[1])[0]


def renorm(d):
    s = sum(d.values())
    return {p: v / s for p, v in d.items()} if s > 0 else None


def blend(a, b, w_b):
    if a is None or b is None:
        return None
    return renorm({p: (1 - w_b) * a.get(p, 0) + w_b * b.get(p, 0) for p in LANES})


class Mapper:
    """Shares to leader probabilities, the same way for every arm."""

    def __init__(self, sigmas: dict):
        rng = np.random.default_rng(SEED)
        self.z = rng.standard_normal((DRAWS, len(LANES)))
        self.sig = np.array([sigmas[p] for p in LANES])

    def __call__(self, shares: dict) -> dict:
        s = np.array([shares.get(p, 0) for p in LANES])
        live = s > 0
        lg = np.where(live, logit(s), -np.inf)
        draws = lg[None, :] + self.z * self.sig[None, :]
        draws[:, ~live] = -np.inf
        win = np.bincount(np.argmax(draws, axis=1), minlength=len(LANES)) / DRAWS
        return dict(zip(LANES, win))


def brier(prob: dict, actual: str) -> float:
    return float(sum((prob.get(p, 0) - (1.0 if p == actual else 0.0)) ** 2 for p in LANES))


def score_arm(ids, arm, actual_shares, actual_leader, mapper, native=None):
    """arm: id -> {'leader':..., 'shares':...} or missing. Returns the yardstick metrics."""
    n = len(ids)
    called = correct = 0
    err = {p: [] for p in LANES}
    briers_c, briers_n = [], []
    pred_wins = defaultdict(int)
    exp_wins = defaultdict(float)
    act_wins = defaultdict(int)
    for i in ids:
        a = actual_leader[i]
        act_wins[a] += 1
        e = arm.get(i)
        if not e:
            continue
        called += 1
        if e["leader"] == a:
            correct += 1
        pred_wins[e["leader"]] += 1
        sh = e.get("shares")
        if sh:
            for p in LANES:
                f, t = sh.get(p, 0), actual_shares[i].get(p, 0)
                if f == 0 and t == 0:
                    continue
                err[p].append(f - t)
            pr = mapper(sh)
            briers_c.append(brier(pr, a))
            for p in LANES:
                exp_wins[p] += pr[p]
        if native is not None and native.get(i):
            briers_n.append(brier(native[i], a))
    by_party = {}
    for p in LANES:
        v = np.array(err[p])
        by_party[p] = {
            "n": int(len(v)),
            "mae_pp": round(100 * float(np.mean(np.abs(v))), 2) if len(v) else None,
            "signed_bias_pp": round(100 * float(np.mean(v)), 2) if len(v) else None,
            "actual_leads": int(act_wins.get(p, 0)),
            "called_leads": int(pred_wins.get(p, 0)),
            "expected_leads_common": round(exp_wins.get(p, 0.0), 1) if briers_c else None,
        }
    allerr = [abs(x) for p in LANES for x in err[p]]
    return {
        "wards": n,
        "wards_forecast": called,
        "leader_correct": correct,
        "leader_accuracy": round(correct / n, 4) if n else None,
        "share_mae_pp_all_lanes": round(100 * float(np.mean(allerr)), 2) if allerr else None,
        "brier_common": round(float(np.mean(briers_c)), 4) if briers_c else None,
        "brier_common_n": len(briers_c),
        "brier_native": round(float(np.mean(briers_n)), 4) if briers_n else None,
        "brier_native_n": len(briers_n),
        "by_party": by_party,
    }


def git_show(commit, path):
    return subprocess.run(["git", "show", f"{commit}:{path}"], cwd=REPO, check=True, capture_output=True).stdout


def main():
    OUT.mkdir(exist_ok=True)
    preds = pd.read_pickle(CACHE / "predictions.pkl")
    fit_meta = pd.read_pickle(CACHE / "fit_meta.pkl")
    data_meta = pd.read_pickle(CACHE / "dataset_meta.pkl")
    sigmas = {p: fit_meta["lanes"][p]["oof_logit_resid_sd"] for p in LANES}
    mapper = Mapper(sigmas)

    # ------------------------------------------------------------ May 2026
    postaudit = read_json(POSTAUDIT)
    live_rows = [r for r in postaudit["live"]["rows"] if r["ballot_paper_id"].startswith("local.")]
    ids = [r["ballot_paper_id"] for r in postaudit["prereg"]["rows"] if r["ballot_paper_id"].startswith("local.")]
    actuals = read_json(MAY26_ACTUALS)["by_ballot"]
    act_sh = {i: pooled(actuals[i]["vote_shares"]) for i in ids}
    act_lead = {i: top(act_sh[i]) for i in ids}

    import hashlib
    buf = git_show(PUBLISHED_COMMIT, "data/predictions/may-2026/local-and-mayor.json")
    sha = hashlib.sha256(buf).hexdigest()
    assert sha == PUBLISHED_SHA, f"published forecast hash {sha}"
    pub = json.loads(buf)["predictions"]

    arms = {k: {} for k in ["published", "last_time", "candidate", "model", "blend"]}
    native = {"published": {}, "last_time": {}}
    live_leader = {r["ballot_paper_id"]: pool_party(r["predicted_winner"]) for r in live_rows}
    for i in ids:
        e = pub.get(i) or {}
        sh = pooled({p: v.get("pct", 0) for p, v in (e.get("prediction") or {}).items()})
        if sh:
            arms["published"][i] = {"leader": live_leader[i], "shares": sh}
            wp = pooled({p: v.get("win_probability") or 0 for p, v in e["prediction"].items()})
            native["published"][i] = renorm(wp)
        base = next((m for m in e.get("methodology", []) if m.get("step") == 1), None)
        bsh = pooled(base.get("data")) if base and isinstance(base.get("data"), dict) else None
        if bsh and top(bsh):
            arms["last_time"][i] = {"leader": top(bsh), "shares": renorm(bsh)}
            native["last_time"][i] = {p: 1.0 if p == top(bsh) else 0.0 for p in LANES}

    cand = read_json(CANDIDATE_FILE)["predictions"]
    for i in ids:
        e = cand.get(i)
        if e and e.get("prediction"):
            sh = pooled({p: v.get("pct", 0) for p, v in e["prediction"].items()})
            arms["candidate"][i] = {"leader": top(sh), "shares": sh}

    may = preds[preds.set == "may26"].set_index("ballot_paper_id")
    for i, r in may.iterrows():
        sh = {p: float(r[f"m_{LANE_KEY[p]}"]) for p in LANES}
        arms["model"][i] = {"leader": top(sh), "shares": sh}
        c = arms["candidate"].get(i)
        if c:
            b = blend(c["shares"], sh, BLEND_WEIGHT_MODEL)
            arms["blend"][i] = {"leader": top(b), "shares": b}

    common = [i for i in ids if all(i in arms[a] for a in arms)]
    model_ids = [i for i in ids if i in arms["model"]]
    has_prev = may["has_prev"].to_dict()
    region = may["region"].to_dict()
    strata = {
        "all_2897": ids,
        "model_scorable": model_ids,
        "common_all_arms": common,
        "model_scorable_with_previous_result": [i for i in model_ids if has_prev.get(i) == 1],
        "model_scorable_no_previous_result": [i for i in model_ids if has_prev.get(i) == 0],
        "model_scorable_london": [i for i in model_ids if region.get(i) == "London"],
        "model_scorable_outside_london": [i for i in model_ids if region.get(i) != "London"],
    }
    may_results = {}
    for sname, sids in strata.items():
        may_results[sname] = {
            a: score_arm(sids, arms[a], act_sh, act_lead, mapper, native.get(a)) for a in arms
        }

    # ------------------------------------------------------- by-elections
    by = preds[preds.set == "byelection"].set_index("ballot_paper_id")
    b_ids = list(by.index)
    b_act = {i: {p: float(by.at[i, f"s_{LANE_KEY[p]}"]) for p in LANES} for i in b_ids}
    b_lead = {i: top(b_act[i]) for i in b_ids}
    b_arms = {k: {} for k in ["site", "last_time", "model", "blend_site"]}
    b_native = {"site": {}, "last_time": {}}
    for i in b_ids:
        r = by.loc[i]
        msh = {p: float(r[f"m_{LANE_KEY[p]}"]) for p in LANES}
        b_arms["model"][i] = {"leader": top(msh), "shares": msh}
        site = pooled(r["site_forecast"]) if isinstance(r["site_forecast"], dict) else None
        if site and top(site):
            b_arms["site"][i] = {"leader": top(site), "shares": renorm(site)}
            if isinstance(r["site_win_probability"], dict):
                b_native["site"][i] = renorm(pooled(r["site_win_probability"]))
            bl = blend(renorm(site), msh, BLEND_WEIGHT_MODEL)
            b_arms["blend_site"][i] = {"leader": top(bl), "shares": bl}
        pr = r["prior_result"]
        psh = pooled(pr.get("shares")) if isinstance(pr, dict) else None
        if psh and top(psh):
            b_arms["last_time"][i] = {"leader": top(psh), "shares": renorm(psh)}
            b_native["last_time"][i] = {p: 1.0 if p == top(psh) else 0.0 for p in LANES}
    b_common = [i for i in b_ids if all(i in b_arms[a] for a in b_arms)]
    by_results = {}
    for sname, sids in {"all_scorable": b_ids, "common_all_arms": b_common}.items():
        by_results[sname] = {a: score_arm(sids, b_arms[a], b_act, b_lead, mapper, b_native.get(a)) for a in b_arms}

    summary = {
        "data": {k: v for k, v in data_meta.items() if k != "byelection_skipped"},
        "byelection_skipped": data_meta["byelection_skipped"],
        "byelection_window": [str(by["date"].min()), str(by["date"].max())],
        "fit": fit_meta,
        "blend_weight_model": BLEND_WEIGHT_MODEL,
        "brier_common_sigmas": sigmas,
        "may_2026": may_results,
        "byelections": by_results,
    }
    with open(OUT / "summary.json", "w") as f:
        json.dump(summary, f, indent=1, default=float)
        f.write("\n")

    # Per-ward model output, small: shares to 4 dp.
    cols = ["ballot_paper_id", "set", "date", "has_prev"] + [f"m_{LANE_KEY[p]}" for p in LANES]
    out = preds.reset_index()[cols].copy()
    for p in LANES:
        out[f"m_{LANE_KEY[p]}"] = out[f"m_{LANE_KEY[p]}"].round(4)
    out.sort_values(["set", "ballot_paper_id"]).to_csv(OUT / "model_ward_shares.csv", index=False)

    for sname in ["all_2897", "model_scorable", "common_all_arms"]:
        print(sname)
        for a, r in may_results[sname].items():
            print(f"  {a:10s} {r['leader_correct']:5d}/{r['wards']} = {100*(r['leader_accuracy'] or 0):.1f}%  MAE {r['share_mae_pp_all_lanes']}  Brier c {r['brier_common']} n {r['brier_native']}")
    for sname, res in by_results.items():
        print("by-elections", sname)
        for a, r in res.items():
            print(f"  {a:10s} {r['leader_correct']:3d}/{r['wards']} MAE {r['share_mae_pp_all_lanes']} Brier c {r['brier_common']} n {r['brier_native']}  bias " + ", ".join(f"{p[:3]} {r['by_party'][p]['signed_bias_pp']}" for p in LANES))


if __name__ == "__main__":
    main()
