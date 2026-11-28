"""Calibrated confidence and a safe call rule (SAFECALL_SPEC.md).

Fit a mapping from forecast lead to the probability that the called leader
wins, on forward-only forecasts dated before 7 May 2026, choose thresholds on
that training set, then score the model and the blend on May 2026 and on the
107 later by-elections.

  uv run python safecall_score.py --train-only   training output only, no test score
  uv run python safecall_score.py                the one scoring run

Output: results/safecall_summary.json
"""
from __future__ import annotations

import json
import math
import sys

import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression

from common import BLEND_WEIGHT_MODEL, CACHE, LANES, LANE_KEY, OUT, POSTAUDIT, read_json
from score import CANDIDATE_FILE, Mapper, blend, pooled, renorm

KEYS = [LANE_KEY[p] for p in LANES]
TARGETS = [0.80, 0.90, 0.95]
MIN_ROWS = 100
CUTOFF = "2026-05-07"
BANDS = np.linspace(0, 1, 11)


def share_matrix(df, prefix):
    m = df[[f"{prefix}_{k}" for k in KEYS]].astype(float).fillna(0.0).to_numpy()
    return m


def lead_and_call(S):
    tot = S.sum(1)
    ok = tot > 0
    S = np.where(ok[:, None], S / np.where(ok, tot, 1)[:, None], 0)
    o = np.sort(S, 1)
    return 100 * (o[:, -1] - o[:, -2]), S.argmax(1), ok


def frame(df, prefix):
    S = share_matrix(df, prefix)
    A = share_matrix(df, "s")
    lead, call, ok = lead_and_call(S)
    out = pd.DataFrame({
        "ballot_paper_id": df["ballot_paper_id"].to_numpy(),
        "lead": lead,
        "called": [LANES[i] for i in call],
        "right": (call == A.argmax(1)).astype(int),
        "has_prev": df["has_prev"].astype(int).to_numpy(),
        "is_by": df["is_by"].astype(int).to_numpy(),
        "region": df["region"].to_numpy(),
    })
    return out[ok].reset_index(drop=True), S[ok]


def wilson(k, n, z=1.96):
    if n == 0:
        return [None, None]
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(c - h, 4), round(c + h, 4)]


class FlooredIso:
    """Isotonic mapping with its output floored at the smallest positive fitted value.

    Fault found in the training-only dry run: one wrong training row with an exact
    tie (lead 0.000) made the first isotonic step 0.0, so any tie would be given a
    zero chance. The floor is the next step up; see SAFECALL_SPEC.md, "Faults".
    """

    def __init__(self, iso):
        self.iso = iso
        y = iso.y_thresholds_
        self.floor = float(y[y > 0].min())
        self.X_thresholds_ = iso.X_thresholds_
        self.y_thresholds_ = np.maximum(y, self.floor)

    def predict(self, x):
        return np.maximum(self.iso.predict(x), self.floor)


def fit_iso(tr):
    iso = IsotonicRegression(increasing=True, out_of_bounds="clip", y_min=0, y_max=1)
    iso.fit(tr.lead.to_numpy(), tr.right.to_numpy())
    return FlooredIso(iso)


def thresholds(p, right, lead):
    """Lowest distinct fitted value t with share right >= target among p >= t, and >= MIN_ROWS rows."""
    out = {}
    for tgt in TARGETS:
        best = None
        for t in sorted(set(np.round(p, 10))):
            sel = p >= t - 1e-12
            n = int(sel.sum())
            if n < MIN_ROWS:
                continue
            if right[sel].mean() >= tgt:
                best = {
                    "probability_threshold": round(float(t), 4),
                    "lead_cutoff_pp": round(float(lead[sel].min()), 2),
                    "train_rows": n,
                    "train_right": int(right[sel].sum()),
                    "train_share_right": round(float(right[sel].mean()), 4),
                }
                break
        out[f"{int(tgt*100)}"] = best
    return out


def label_table(fr, p, thr, denominators):
    res = {}
    for tgt, t in thr.items():
        if t is None:
            res[tgt] = None
            continue
        sel = p >= t["probability_threshold"] - 1e-12
        n, k = int(sel.sum()), int(fr.right[sel].sum())
        row = {"labelled": n, "right": k, "share_right": round(k / n, 4) if n else None, "wilson_95": wilson(k, n)}
        for name, d in denominators.items():
            row[f"share_of_{name}"] = round(n / d, 4)
        res[tgt] = row
    return res


def reliability(p, right):
    rows = []
    idx = np.clip(np.digitize(p, BANDS[1:-1], right=False), 0, 9)
    err = 0.0
    for b in range(10):
        sel = idx == b
        n = int(sel.sum())
        if n:
            mp, sr = float(p[sel].mean()), float(right[sel].mean())
            err += n * abs(mp - sr)
        rows.append({
            "band": f"{BANDS[b]:.1f} to {BANDS[b+1]:.1f}",
            "contests": n,
            "mean_probability": round(mp, 4) if n else None,
            "share_right": round(sr, 4) if n else None,
            "right": int(right[sel].sum()),
        })
    return rows, round(err / len(p), 4)


def brier(p, right):
    return round(float(np.mean((p - right) ** 2)), 4)


def splits(fr, sel):
    out = {}
    for col in ["called", "region", "has_prev"]:
        d = {}
        for key, g in fr[sel].groupby(col):
            n, k = len(g), int(g.right.sum())
            d[str(key)] = {"labelled": n, "right": k, "share_right": round(k / n, 4), "wilson_95": wilson(k, n)}
        out[col] = d
    return out


def main():
    train_only = "--train-only" in sys.argv
    OUT.mkdir(exist_ok=True)
    # Local caches written by this folder's own scripts (recency_fit.py) and by
    # backtest_fit.py on PR 191's branch; not downloaded, so read_pickle is safe here.
    rec = pd.read_pickle(CACHE / "recency_predictions.pkl")
    bt = pd.read_pickle(CACHE / "backtest_predictions.pkl")
    assert (bt.date < CUTOFF).all()

    roll_tr, _ = frame(rec[rec.date < CUTOFF], "s1")
    bt_tr, _ = frame(bt, "s1")
    roll_tr["source"] = "rolling"
    bt_tr["source"] = "backtest"
    tr = pd.concat([roll_tr, bt_tr], ignore_index=True)

    iso = fit_iso(tr)
    p_tr = iso.predict(tr.lead.to_numpy())
    thr = thresholds(p_tr, tr.right.to_numpy(), tr.lead.to_numpy())
    X = ["lead", "has_prev", "is_by"]
    logi = LogisticRegression(C=1e6, max_iter=1000).fit(tr[X].to_numpy(), tr.right.to_numpy())
    p_tr_log = logi.predict_proba(tr[X].to_numpy())[:, 1]
    sens = {}
    for name, sub in [("rolling_only", roll_tr), ("backtest_only", bt_tr)]:
        m = fit_iso(sub)
        sens[name] = {"mapping": m, "thresholds": thresholds(m.predict(sub.lead.to_numpy()), sub.right.to_numpy(), sub.lead.to_numpy())}

    flat = float(tr.right.mean())
    training = {
        "rows": len(tr),
        "rows_by_source": tr.source.value_counts().to_dict(),
        "rows_rolling_by_type": {"byelections": int(roll_tr.is_by.sum()), "scheduled_2025_05_01": int((roll_tr.is_by == 0).sum())},
        "rows_backtest_by_type": {"byelections": int(bt_tr.is_by.sum()), "scheduled": int((bt_tr.is_by == 0).sum())},
        "share_right": round(flat, 4),
        "share_right_by_source": {k: round(float(v), 4) for k, v in tr.groupby("source").right.mean().items()},
        "isotonic_steps": [
            {"lead_from_pp": round(float(a), 3), "probability": round(float(b), 4)}
            for a, b in zip(iso.X_thresholds_, iso.y_thresholds_)
        ],
        "thresholds_primary": thr,
        "thresholds_by_source_at_primary_cutoffs": {
            tgt: (None if t is None else {
                src: {"rows": int(len(g)), "share_right": round(float(g.right.mean()), 4)}
                for src, g in tr[p_tr >= t["probability_threshold"] - 1e-12].groupby("source")
            }) for tgt, t in thr.items()
        },
        "thresholds_sensitivity": {k: v["thresholds"] for k, v in sens.items()},
        "logistic": {"inputs": X, "coef": [round(float(c), 5) for c in logi.coef_[0]], "intercept": round(float(logi.intercept_[0]), 5)},
        "training_brier": {"isotonic": brier(p_tr, tr.right.to_numpy()), "logistic": brier(p_tr_log, tr.right.to_numpy()), "flat": brier(np.full(len(tr), flat), tr.right.to_numpy())},
    }
    print(json.dumps(training, indent=1, default=str))
    if train_only:
        return

    # ---------------------------------------------------------- test sets
    fit_meta = pd.read_pickle(CACHE / "fit_meta.pkl")
    mapper = Mapper({p: fit_meta["lanes"][p]["oof_logit_resid_sd"] for p in LANES})
    n_site = len([r for r in read_json(POSTAUDIT)["prereg"]["rows"] if r["ballot_paper_id"].startswith("local.")])

    cand = {}
    for i, e in read_json(CANDIDATE_FILE)["predictions"].items():
        if e and e.get("prediction"):
            cand[i] = pooled({p: v.get("pct", 0) for p, v in e["prediction"].items()})

    def blend_frame(df, other):
        rows = []
        for _, r in df.iterrows():
            m = {p: float(np.nan_to_num(r[f"s1_{LANE_KEY[p]}"])) for p in LANES}
            o = other(r)
            b = blend(o, m, BLEND_WEIGHT_MODEL) if o and sum(m.values()) > 0 else None
            rows.append({f"b_{LANE_KEY[p]}": (b[p] if b else np.nan) for p in LANES})
        return pd.concat([df.reset_index(drop=True), pd.DataFrame(rows)], axis=1)

    A = rec[rec.set == "may26"]
    B = rec[rec.set == "byelection"]
    A = blend_frame(A, lambda r: cand.get(r["ballot_paper_id"]))
    B = blend_frame(B, lambda r: renorm(pooled(r["site_forecast"])) if isinstance(r["site_forecast"], dict) and pooled(r["site_forecast"]) and sum(pooled(r["site_forecast"]).values()) > 0 else None)

    tests = {}
    for tname, df, denoms in [("may_2026", A, {"forecastable_2596": len(A), "site_local_wards_2897": n_site}), ("byelections_after_may_2026", B, {"byelections_107": len(B)})]:
        tests[tname] = {}
        for fname, prefix in [("model", "s1"), ("blend", "b")]:
            fr, S = frame(df, prefix)
            p = iso.predict(fr.lead.to_numpy())
            p_log = logi.predict_proba(fr[X].to_numpy())[:, 1]
            p_sig = np.array([mapper(dict(zip(LANES, s)))[c] for s, c in zip(S, fr.called)])
            right = fr.right.to_numpy()
            rel, mce = reliability(p, right)
            rel_sig, mce_sig = reliability(p_sig, right)
            sel90 = p >= (thr["90"]["probability_threshold"] - 1e-12) if thr["90"] else np.zeros(len(p), bool)
            sens_out = {}
            for k, v in sens.items():
                sens_out[k] = label_table(fr, v["mapping"].predict(fr.lead.to_numpy()), v["thresholds"], denoms)
            tests[tname][fname] = {
                "contests_forecast": len(fr),
                "share_right_all": round(float(right.mean()), 4),
                "right_all": int(right.sum()),
                "safe_labels_primary": label_table(fr, p, thr, denoms),
                "safe_labels_sensitivity": sens_out,
                "reliability_primary": rel,
                "mean_calibration_error_primary": mce,
                "reliability_scheduled_sigma": rel_sig,
                "mean_calibration_error_scheduled_sigma": mce_sig,
                "brier_called_leader_wins": {
                    "isotonic_primary": brier(p, right),
                    "logistic_secondary": brier(p_log, right),
                    "scheduled_sigma_score_py": brier(p_sig, right),
                    "flat_training_rate": brier(np.full(len(p), flat), right),
                },
                "safe90_checks": splits(fr, sel90),
            }

    t = tests["may_2026"]["blend"]["safe_labels_primary"]["90"]
    rule = None
    if t is not None:
        rule = {
            "share_right": t["share_right"],
            "labelled": t["labelled"],
            "needs_share_right_at_least": 0.87,
            "needs_labelled_at_least": math.ceil(0.15 * n_site),
            "met": bool(t["share_right"] >= 0.87 and t["labelled"] >= math.ceil(0.15 * n_site)),
        }
    summary = {
        "spec": "SAFECALL_SPEC.md",
        "training": training,
        "tests": tests,
        "pre_set_rule": rule,
    }
    with open(OUT / "safecall_summary.json", "w") as f:
        json.dump(summary, f, indent=1, default=float)
        f.write("\n")
    for tname, res in tests.items():
        for fname, r in res.items():
            print(tname, fname, r["contests_forecast"], "right", r["right_all"], json.dumps(r["safe_labels_primary"]), r["brier_called_leader_wins"], "MCE", r["mean_calibration_error_primary"], r["mean_calibration_error_scheduled_sigma"])
    print("rule", rule)


if __name__ == "__main__":
    main()
