"""Safe call label (SAFECALL_SPEC.md): map forecast lead to the probability the
called leader wins, fitted on forward-only forecasts before 7 May 2026, then
score on 7 May 2026 and on the 107 by-elections after it.

Usage:
  uv run python safecall_score.py --dry   training figures only, no test score
  uv run python safecall_score.py         the one scoring run

Output: results/safecall_summary.json
"""
from __future__ import annotations

import hashlib
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression

from common import BLEND_WEIGHT_MODEL, CACHE, LANES, LANE_KEY, OUT, REPO, read_json
from score import CANDIDATE_FILE, Mapper, blend, pooled, renorm, top

BACKTEST = Path("/Users/tompickup/ukelections/.claude/worktrees/data-wards-2027-baselines-fa98a8/research/ward-model-2026-11/cache/backtest_predictions.pkl")
SITE_CONF = REPO / "data/calibration/confidence.json"
LEVELS = [0.80, 0.90, 0.95]
SAFE = 0.90


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def shares(row, prefix):
    sh = {}
    for p in LANES:
        v = row[f"{prefix}_{LANE_KEY[p]}"]
        sh[p] = 0.0 if v is None or (isinstance(v, float) and math.isnan(v)) else float(v)
    return sh if sum(sh.values()) > 0 else None


def lead_of(sh):
    v = sorted(sh.values(), reverse=True)
    return 100.0 * (v[0] - (v[1] if len(v) > 1 else 0.0))


def actual_leader(row):
    return top({p: float(row[f"s_{LANE_KEY[p]}"]) for p in LANES})


def frame_rows(df, prefix):
    """One record per contest: called leader, lead, right, covariates."""
    out = []
    for i, r in df.iterrows():
        sh = shares(r, prefix)
        rec = {"id": i, "has_prev": int(r["has_prev"]), "is_by": int(bool(r["is_by"])),
               "region": r["region"] if isinstance(r["region"], str) and r["region"] else "unknown",
               "actual": actual_leader(r), "shares": sh}
        if sh:
            rec["leader"] = top(sh)
            rec["lead"] = lead_of(sh)
            rec["right"] = int(rec["leader"] == rec["actual"])
        out.append(rec)
    return out


class Fitted:
    def __init__(self, rows):
        x = np.array([r["lead"] for r in rows if "lead" in r])
        y = np.array([r["right"] for r in rows if "lead" in r])
        self.n = len(x)
        self.flat = float(y.mean())
        self.iso = IsotonicRegression(increasing=True, out_of_bounds="clip", y_min=0, y_max=1).fit(x, y)
        X = self._X([r for r in rows if "lead" in r])
        self.lr = LogisticRegression(C=1e6, max_iter=1000).fit(X, y)
        self.train = [r for r in rows if "lead" in r]
        self.thresholds = {"isotonic": self._thresholds(self.p_iso(self.train), y),
                           "logistic": self._thresholds(self.p_lr(self.train), y)}

    @staticmethod
    def _X(rows):
        return np.array([[r["lead"], r["has_prev"], r["is_by"]] for r in rows], dtype=float)

    def p_iso(self, rows):
        return self.iso.predict(np.array([r["lead"] for r in rows]))

    def p_lr(self, rows):
        return self.lr.predict_proba(self._X(rows))[:, 1]

    @staticmethod
    def _thresholds(p, y):
        out = {}
        vals = np.unique(p)
        for L in LEVELS:
            t = None
            for v in vals:  # ascending: lowest value whose tail reaches L
                m = p >= v
                if m.sum() and y[m].mean() >= L:
                    t = float(v)
                    break
            out[f"{int(L*100)}"] = t
        return out

    def lead_for(self, t):
        """Smallest training lead whose isotonic value reaches t."""
        if t is None:
            return None
        leads = np.array(sorted(r["lead"] for r in self.train))
        p = self.iso.predict(leads)
        hit = leads[p >= t]
        return round(float(hit.min()), 2) if len(hit) else None


def wilson(k, n, z=1.96):
    if n == 0:
        return [None, None]
    ph = k / n
    d = 1 + z * z / n
    c = (ph + z * z / (2 * n)) / d
    h = z * math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / d
    return [round(c - h, 4), round(c + h, 4)]


def tally(recs, mask_fn):
    lab = [r for r in recs if mask_fn(r)]
    k = sum(r["right"] for r in lab)
    n = len(lab)
    return {"labelled": n, "right": k, "rate_right": round(k / n, 4) if n else None, "ci95": wilson(k, n)}


def safe_table(recs, p_key, thr):
    out = {"contests": len(recs)}
    for L, t in thr.items():
        if t is None:
            out[L] = {"threshold": None, "labelled": 0, "note": "no label: level not reached on training"}
            continue
        tl = tally(recs, lambda r: "lead" in r and r[p_key] >= t)
        tl["share_of_contests"] = round(tl["labelled"] / len(recs), 4) if recs else None
        tl["threshold"] = round(t, 4)
        out[L] = tl
    return out


def reliability(recs, p_key):
    bands = []
    for b in range(10):
        lo, hi = b / 10, (b + 1) / 10
        sel = [r for r in recs if "lead" in r and (lo <= r[p_key] < hi or (b == 9 and r[p_key] == 1.0))]
        bands.append({"band": f"{lo:.1f} to {hi:.1f}", "contests": len(sel),
                      "mean_probability": round(float(np.mean([r[p_key] for r in sel])), 4) if sel else None,
                      "rate_right": round(float(np.mean([r["right"] for r in sel])), 4) if sel else None})
    return bands


def brier(recs, p_key):
    v = [(r[p_key] - r["right"]) ** 2 for r in recs if "lead" in r and r.get(p_key) is not None]
    return {"brier": round(float(np.mean(v)), 4) if v else None, "contests": len(v)}


def site_conf_prob(lead_pp, bins):
    for b in bins:
        if b["margin_from_pp"] <= lead_pp < b["margin_to_pp"]:
            return b["winner_probability"]
    return bins[-1]["winner_probability"]


def annotate(recs, fit, mapper, flat, site_bins=None):
    live = [r for r in recs if "lead" in r]
    if live:
        pi, pl = fit.p_iso(live), fit.p_lr(live)
        for r, a, b in zip(live, pi, pl):
            r["p_iso"], r["p_lr"] = float(a), float(b)
            r["p_mapper"] = float(mapper(r["shares"])[r["leader"]])
            r["p_flat"] = flat
            if site_bins:
                r["p_siteconf"] = float(site_conf_prob(r["lead"], site_bins))
    return recs


def checks(recs, p_key, t):
    if t is None:
        return None
    out = {}
    for name, key in [("by_party_called", lambda r: r["leader"]), ("by_region", lambda r: r["region"]),
                      ("by_previous_result", lambda r: "with previous result" if r["has_prev"] else "no previous result")]:
        groups = defaultdict(list)
        for r in recs:
            if "lead" in r:
                groups[key(r)].append(r)
        out[name] = {}
        for g, rs in sorted(groups.items()):
            tl = tally(rs, lambda r: r[p_key] >= t)
            tl["contests_called"] = len(rs)
            out[name][g] = tl
    return out


def evaluate(recs, fit, with_siteconf=False):
    thr_i, thr_l = fit.thresholds["isotonic"], fit.thresholds["logistic"]
    res = {
        "contests": len(recs),
        "contests_forecast": sum(1 for r in recs if "lead" in r),
        "leader_right_all": sum(r.get("right", 0) for r in recs),
        "safe_isotonic_primary": safe_table(recs, "p_iso", thr_i),
        "safe_logistic_secondary": safe_table(recs, "p_lr", thr_l),
        "reliability_isotonic": reliability(recs, "p_iso"),
        "brier_called_leader_wins": {
            "isotonic_primary": brier(recs, "p_iso"),
            "logistic_secondary": brier(recs, "p_lr"),
            "mapper_scheduled_sigma": brier(recs, "p_mapper"),
            "flat_training_rate": brier(recs, "p_flat"),
        },
        "checks_safe90_isotonic": checks(recs, "p_iso", thr_i["90"]),
    }
    if with_siteconf:
        res["brier_called_leader_wins"]["site_confidence_json"] = brier(recs, "p_siteconf")
    return res


def main():
    dry = "--dry" in sys.argv
    # Local caches written by this project's own research scripts (this folder and the back-test session).
    df =pd.read_pickle(CACHE / "recency_predictions.pkl").set_index("ballot_paper_id")
    fit_meta = pd.read_pickle(CACHE / "fit_meta.pkl")
    mapper = Mapper({p: fit_meta["lanes"][p]["oof_logit_resid_sd"] for p in LANES})

    train_df = df[df.set == "train"]
    assert (pd.to_datetime(train_df.date) < pd.Timestamp("2026-05-07")).all()
    train = frame_rows(train_df, "s1")
    fit = Fitted(train)

    bt = pd.read_pickle(BACKTEST)
    bt = bt[bt.s1_ref.notna() & (pd.to_datetime(bt.date) < pd.Timestamp(train_df.date.min()))]
    bt = bt.drop_duplicates("ballot_paper_id").set_index("ballot_paper_id")
    bt = bt[~bt.index.isin(df.index)]
    fit_bt = Fitted(train + frame_rows(bt, "s1"))

    def describe(f):
        return {
            "training_contests_forecast": f.n,
            "training_rate_right": round(f.flat, 4),
            "thresholds_isotonic": f.thresholds["isotonic"],
            "threshold_leads_pp_isotonic": {L: f.lead_for(t) for L, t in f.thresholds["isotonic"].items()},
            "thresholds_logistic": f.thresholds["logistic"],
            "logistic_coefficients": dict(zip(["intercept", "lead_pp", "has_prev", "is_by"],
                                              [round(float(f.lr.intercept_[0]), 4)] + [round(float(c), 4) for c in f.lr.coef_[0]])),
            "isotonic_steps": [{"from_lead_pp": round(float(a), 2), "probability": round(float(b), 4)}
                               for a, b in zip(f.iso.X_thresholds_, f.iso.y_thresholds_)],
        }

    tr = annotate(train, fit, mapper, fit.flat)
    training = describe(fit)
    training["training_check_safe_isotonic"] = safe_table(tr, "p_iso", fit.thresholds["isotonic"])
    training["training_reliability_isotonic"] = reliability(tr, "p_iso")
    training["backtest_sensitivity"] = {"backtest_contests_added": int(len(bt)), "backtest_sha256": sha(BACKTEST), **describe(fit_bt)}
    for k in ["isotonic_steps"]:
        training["backtest_sensitivity"].pop(k)
    print(json.dumps({k: v for k, v in training.items() if k != "isotonic_steps"}, indent=1))
    if dry:
        return

    # ------------------------------------------------------------- test sets
    cand = {}
    for i, e in read_json(CANDIDATE_FILE)["predictions"].items():
        if e and e.get("prediction"):
            cand[i] = pooled({p: v.get("pct", 0) for p, v in e["prediction"].items()})
    site_bins = read_json(SITE_CONF)["bins"]

    may = df[df.set == "may26"]
    by = df[df.set == "byelection"]

    def blend_rows(frame, other):
        recs = frame_rows(frame, "s1")
        out = []
        for r in recs:
            o = other.get(r["id"])
            if o is None or r["shares"] is None:
                continue
            b = blend(o, r["shares"], BLEND_WEIGHT_MODEL)
            q = {k: r[k] for k in ["id", "has_prev", "is_by", "region", "actual"]}
            q["shares"] = b
            if b:
                q["leader"], q["lead"] = top(b), lead_of(b)
                q["right"] = int(q["leader"] == q["actual"])
            out.append(q)
        return out

    site = {}
    for i, r in by.iterrows():
        sf = pooled(r["site_forecast"]) if isinstance(r["site_forecast"], dict) else None
        if sf and top(sf):
            site[i] = renorm(sf)

    sets = {
        "may_2026_model": frame_rows(may, "s1"),
        "may_2026_blend": blend_rows(may, cand),
        "may_2026_scheduled_only_model": frame_rows(may[~may.is_by], "s1"),
        "may_2026_scheduled_only_blend": blend_rows(may[~may.is_by], cand),
        "byelections_107_model": frame_rows(by, "s1"),
        "byelections_107_blend_site": blend_rows(by, site),
    }
    results = {}
    results_bt = {}
    for name, recs in sets.items():
        is_by_set = name.startswith("byelections")
        annotate(recs, fit, mapper, fit.flat, site_bins if is_by_set else None)
        results[name] = evaluate(recs, fit, with_siteconf=is_by_set)
        # back-test sensitivity: same contests, mapping fitted with back-test rows added
        rb = [dict(r) for r in recs]
        annotate(rb, fit_bt, mapper, fit_bt.flat)
        results_bt[name] = {"safe_isotonic": safe_table(rb, "p_iso", fit_bt.thresholds["isotonic"]),
                            "brier_isotonic": brier(rb, "p_iso")}

    b90 = results["may_2026_blend"]["safe_isotonic_primary"]["90"]
    verdict = {
        "rule": "blend on May 2026: safe label right in at least 87% of labelled contests and covering at least 15% of contests",
        "rate_right": b90.get("rate_right"), "share_of_contests": b90.get("share_of_contests"),
        "supported": bool(b90.get("rate_right") is not None and b90["rate_right"] >= 0.87 and b90["share_of_contests"] >= 0.15),
    }
    summary = {
        "spec": "SAFECALL_SPEC.md",
        "inputs_sha256": {"recency_predictions.pkl": sha(CACHE / "recency_predictions.pkl"),
                          "candidate-2026-10-24.json": sha(CANDIDATE_FILE), "fit_meta.pkl": sha(CACHE / "fit_meta.pkl"),
                          "confidence.json": sha(SITE_CONF)},
        "counts_note": "contests are wards (scheduled) or by-elections; labelled is contests at or above the threshold; right is labelled contests whose called leader topped the actual full-slate share",
        "verdict": verdict,
        "training": training,
        "test": results,
        "test_with_backtest_mapping_sensitivity": results_bt,
    }
    OUT.mkdir(exist_ok=True)
    with open(OUT / "safecall_summary.json", "w") as f:
        json.dump(summary, f, indent=1, default=float)
        f.write("\n")
    print(json.dumps(verdict, indent=1))
    for name, r in results.items():
        s = r["safe_isotonic_primary"]
        print(name, r["contests"], {L: (s[L].get("labelled"), s[L].get("right"), s[L].get("rate_right"), s[L].get("ci95"), s[L].get("share_of_contests")) for L in ["80", "90", "95"]})
        print("  brier", {k: v["brier"] for k, v in r["brier_called_leader_wins"].items()})


if __name__ == "__main__":
    main()
