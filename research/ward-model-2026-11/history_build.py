"""Build the extended dataset of HISTORY_SPEC.md, with its checks.

    uv run python history_build.py

Adds to the corrected rebuild's stage 1 dataset:
  A. the 2023 ordinary contests of the 2027 councils held in the baselines file (source dc2027),
  B. the bridged 2027 wards' own May 2026 contests not in the dataset,
  C. the 35 code reissues (the baseline ballot's row takes the 2027 code and its features),
then recomputes the ward lags with prepare.py's lag block (copied verbatim below)
and runs backtest_b_anchor.main and bridge_level_anchor.main unchanged on the
corrected build's polling files. Check H0 first shows the same code with nothing
added reproduces the corrected bridge_level_dataset.pkl exactly.

Inputs: cache/rebuild/corrected/{dataset,bridge_level_dataset}.pkl and polls/;
data/identity/wards-2027-baselines.json; cache/drive07/universe_features_v2.csv;
cache/v2027/bridge.pkl; data/results/may-2026/local-and-mayor.merged.json;
data/identity/wards-2027.json; data/forecasts/research/wards-2027-dryrun.json.
Outputs: cache/history/{dataset,backtest_b_dataset,bridge_level_dataset}.pkl and
reports, cache/history/h0/ (the reproduction), results/history_manifest.json.
Research only; nothing on the site reads any of it.
"""
from __future__ import annotations

import json
import shutil
import sys
from collections import Counter
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

import common
from common import HERE, LANES, LANE_KEY, MAJOR, MAY26, MAY26_ACTUALS, REPO, UNIVERSE, read_json, sha256

SRC = common.CACHE / "rebuild" / "corrected"
HIST = common.CACHE / "history"
KEYS = [LANE_KEY[p] for p in LANES]
LANE_OF = {LANE_KEY[p]: p for p in LANES}
BASELINES = REPO / "data/identity/wards-2027-baselines.json"
DRYRUN = REPO / "data/forecasts/research/wards-2027-dryrun.json"
WARDS = REPO / "data/identity/wards-2027.json"
BRIDGE = common.CACHE / "v2027" / "bridge.pkl"
HASHES = {
    SRC / "dataset.pkl": "c2fa5e5272b0fcb68d8679eeb97188e576ea8b791998a2daf072905190f2408b",
    SRC / "bridge_level_dataset.pkl": "3393cfdba3437f46ad2f2b8485e1621b8a38d4c5605ee33c4c4cd9be38de53a8",
    BASELINES: "414b844f34ca30c592d974342f0a7b9ea58062a3bd0687ce24ce150742399534",
    UNIVERSE: "592a5e96f447a719c61db231c93e14babacbc9d0a344c83041cf1a03b3f97404",
    BRIDGE: "7e951349621b9e873a3dd5cd580e588f220361f3ce272802067827b02cbb80c4",
    MAY26_ACTUALS: "99ff664e6de1d2a71c5d178bb27ecbaec3b29b1548d9c10088c6a8ef4f622e74",
    WARDS: "d1fd913b0fc3dd7b7fd75c5dbf51d57fdeef9ec0594a9a245359af105f905e0b",
    common.CACHE / "fit_meta.pkl": "936d07ee4d9004d1cdd811796f60dbfb1b22a723e7575789b56292c287ac67ad",
}
LAG_COLS = [f"prev_rel_{k}" for k in KEYS] + ["prev_gap_years", "has_prev"]
STAGE_B_PREV = ["prev_date", "prev_anchor_kind"] + [f"prev_s_{k}" for k in KEYS] + [f"prev_a_{k}" for k in KEYS]
ANCHOR_COLS = ["anchor_kind"] + [f"a_{k}" for k in KEYS]


def polls_used():
    """The six polling files the corrected build read after its area rule, in its stage order."""
    m = read_json(HERE / "results/rebuild_manifest_corrected.json")
    f = [(HERE / p) if p.startswith("cache/") else (REPO / p) for p in m["area_check"]["files_read"]]
    corrected_bytes = {Path(x["path"]).name: x["sha256"] for x in m["inputs"] if "sha256" in x}
    return f[:4], [f[3], f[4], f[5]], f, corrected_bytes


# ------------------------------------------------- prepare.py's lag block, verbatim ----

def ward_lags(df: pd.DataFrame) -> pd.DataFrame:
    """The ward lag block of prepare.main, copied verbatim (only indented into a function)."""
    # ---- ward lags: the latest earlier contest in the same GSS area
    hist = df[df["gss"].notna() & (df["gss"] != "")][["gss", "d"] + [f"s_{LANE_KEY[p]}" for p in LANES] + [f"stood_{LANE_KEY[p]}" for p in LANES]].copy()
    hist = hist.sort_values("d")
    by_gss = {g: grp for g, grp in hist.groupby("gss")}
    hist["year"] = hist["d"].dt.year

    ym_cache = {}

    def year_mean(year: int, before: pd.Timestamp):
        key = (year, before if before.year == year else None)
        if key not in ym_cache:
            h = hist[(hist.year == year) & (hist.d < before)]
            ym_cache[key] = {
                p: float(h.loc[h[f"stood_{LANE_KEY[p]}"], f"s_{LANE_KEY[p]}"].mean()) if h[f"stood_{LANE_KEY[p]}"].any() else np.nan
                for p in LANES
            }
        return ym_cache[key]

    lag_cols = {f"prev_rel_{LANE_KEY[p]}": [] for p in LANES}
    gap, has_prev = [], []
    for g, dd in zip(df["gss"], df["d"]):
        grp = by_gss.get(g)
        prev = None
        if grp is not None:
            earlier = grp[grp.d < dd]
            if len(earlier):
                prev = earlier.iloc[-1]
        if prev is None:
            for p in LANES:
                lag_cols[f"prev_rel_{LANE_KEY[p]}"].append(np.nan)
            gap.append(np.nan)
            has_prev.append(0)
            continue
        ym = year_mean(prev.d.year, dd)
        for p in LANES:
            k = LANE_KEY[p]
            lag_cols[f"prev_rel_{k}"].append(prev[f"s_{k}"] - ym[p] if prev[f"stood_{k}"] else np.nan)
        gap.append((dd - prev.d).days / 365.25)
        has_prev.append(1)
    for c, v in lag_cols.items():
        df[c] = v
    df["prev_gap_years"] = gap
    df["has_prev"] = has_prev
    return df


# ------------------------------------------------------------------ rows ----

def lane_of_label(label: str) -> str:
    """HISTORY_SPEC.md, condition 2 rule 1."""
    if label in MAJOR:
        return label
    if "Reform UK" in label:
        return "Reform UK"
    if "Labour and Co-operative" in label:
        return "Labour"
    return "Others"


def new_rows(stage1: pd.DataFrame):
    from prepare import FEATURES_NUMERIC, REGIONS, fnum
    from v2027_forecast import may26_ballot, may26_slate
    uni = {u["gss"]: u for u in pd.read_csv(UNIVERSE, dtype=str, keep_default_na=False).to_dict("records")}
    base_ids = set(stage1.ballot_paper_id)
    B = read_json(BASELINES)["wards"]
    report = {"A": Counter(), "A_joint_label_rows": [], "B": Counter(), "C": {}}
    rows = []

    # ---- A
    for w in B:
        b = w.get("baseline")
        if not b or w["method"] != "same_ward" or b.get("source") != "dc2027":
            continue
        bid = b["ballot_paper_id"]
        if bid in base_ids:
            report["A"]["already_in_dataset"] += 1
            continue
        g = w.get("gss_code")
        u = uni.get(g)
        if u is None:
            report["A"]["left_out_code_without_feature_row"] += 1
            continue
        lanes = {p: 0.0 for p in LANES}
        for lab, v in b["shares"].items():
            lanes[lane_of_label(lab)] += float(v or 0)
        if abs(sum(lanes.values()) - 1) > 0.001:
            report["A"]["left_out_shares_do_not_sum_to_one"] += 1
            continue
        if any(lane_of_label(l) == "Reform UK" and l != "Reform UK" for l in b["shares"]):
            report["A_joint_label_rows"].append(bid)
        row = {"ballot_paper_id": bid, "date": b["date"], "council": w["council_slug"], "gss": g, "is_by": False,
               "source": "history_baselines_dc2027", "region": u.get("region_name") or None, "set": None}
        for c in FEATURES_NUMERIC:
            row[c] = fnum(u.get(c))
        for p in LANES:
            row[f"s_{LANE_KEY[p]}"] = lanes[p]
            row[f"stood_{LANE_KEY[p]}"] = lanes[p] > 0
        row["anchor_kind"] = None
        for k in KEYS:
            row[f"a_{k}"] = np.nan
        rows.append(row)
        report["A"][f"added_{b['date']}"] += 1

    # ---- B
    may = read_json(MAY26_ACTUALS)["by_ballot"]
    w27 = {w["id"]: w for w in read_json(WARDS)["wards"]}
    b27 = {w["id"]: w for w in B}
    # This folder's own cache, written by v2027_bridge.py, hash checked.
    bridge = pd.read_pickle(BRIDGE)
    may_anchor = stage1.loc[(stage1.date == MAY26) & stage1.anchor_kind.notna()].iloc[0]
    dr = read_json(DRYRUN)
    for rec in dr["wards"]:
        if rec.get("route") != "bridge":
            continue
        w = w27[rec["id"]]
        bid = may26_ballot(w, may, b27)
        if not bid:
            report["B"]["no_may2026_ballot"] += 1
            continue
        if bid in base_ids:
            report["B"]["already_in_dataset_under_old_code"] += 1
            continue
        sl = may26_slate(bid, may)
        if sl is None:
            report["B"]["left_out_no_candidates"] += 1
            continue
        g = w["gss_code"]
        br = bridge[g]
        row = {"ballot_paper_id": bid, "date": MAY26, "council": w["council_slug"], "gss": g, "is_by": False,
               "source": "history_bridge_may26", "set": None}
        for col in FEATURES_NUMERIC:
            num = den = 0.0
            for par, wt in br["parents"].items():
                v = fnum(uni[par].get(col)) if par in uni else np.nan
                if not np.isnan(v):
                    num += wt * v
                    den += wt
            row[col] = num / den if den > 0 else np.nan
        row["d_total_residents"] = br["population"]
        top = max(br["parents"], key=br["parents"].get)
        row["region"] = uni.get(top, {}).get("region_name") or None
        sh, st = sl
        for p in LANES:
            row[f"s_{LANE_KEY[p]}"] = sh[p]
            row[f"stood_{LANE_KEY[p]}"] = bool(st[p])
        row["anchor_kind"] = may_anchor["anchor_kind"]
        for k in KEYS:
            row[f"a_{k}"] = float(may_anchor[f"a_{k}"])
        rows.append(row)
        report["B"]["added"] += 1

    # ---- C
    pairs = {}
    idx_of = {b: i for i, b in enumerate(stage1.ballot_paper_id)}
    for rec in dr["wards"]:
        if not rec.get("forecast") or rec.get("previous_contest") is not None:
            continue
        b = (b27.get(rec["id"]) or {}).get("baseline")
        if not b or b27[rec["id"]]["method"] != "same_ward" or b.get("ballot_paper_id") not in idx_of:
            continue
        old = stage1.at[idx_of[b["ballot_paper_id"]], "gss"]
        if old != rec["gss_code"]:
            pairs[b["ballot_paper_id"]] = (old, rec["gss_code"])
    olds, news = Counter(o for o, _ in pairs.values()), Counter(n for _, n in pairs.values())
    one_to_one = all(v == 1 for v in olds.values()) and all(v == 1 for v in news.values()) and all(n in uni for _, n in pairs.values())
    report["C"] = {"pairs": len(pairs), "one_to_one_and_coded": one_to_one,
                   "rows": {b: {"old": o, "new": n, "date": stage1.at[idx_of[b], "date"]} for b, (o, n) in sorted(pairs.items())}}
    df = stage1.copy()
    if one_to_one:
        for bid, (o, n) in pairs.items():
            i = idx_of[bid]
            df.at[i, "gss"] = n
            for c in FEATURES_NUMERIC:
                df.at[i, c] = fnum(uni[n].get(c))
            df.at[i, "region"] = uni[n].get("region_name") or None
    add = pd.DataFrame(rows)
    df = pd.concat([df, add], ignore_index=True)
    df["d"] = pd.to_datetime(df["date"])
    df["region_code"] = df["region"].map({r: i for i, r in enumerate(REGIONS)}).astype(float)
    df["n_standing"] = df[[f"stood_{k}" for k in KEYS]].sum(axis=1)
    for k in KEYS:
        df[f"stood_{k}"] = df[f"stood_{k}"].astype(bool)
    df["is_by"] = df["is_by"].astype(bool)
    report["A"] = dict(report["A"])
    report["B"] = dict(report["B"])
    return df, report, set(pairs) if one_to_one else set()


def run_stages(stage1: pd.DataFrame, out: Path, files_b, files_l):
    out.mkdir(parents=True, exist_ok=True)
    stage1 = ward_lags(stage1.drop(columns=[c for c in LAG_COLS if c in stage1.columns]))
    stage1.to_pickle(out / "dataset.pkl")
    import backtest_b_anchor as bba
    import bridge_level_anchor as bla
    bba.CACHE = out
    bla.CACHE = out
    bba.POLL_FILES = list(files_b)
    bba.main()
    bba.POLL_FILES = list(files_l)
    bla.main()
    # Written just above by the two scripts (this folder's own output).
    return pd.read_pickle(out / "dataset.pkl"), pd.read_pickle(out / "bridge_level_dataset.pkl")


def main():
    from rebuild import Checks, compare, row_counts, window_count
    checks = Checks()
    man = {"spec": "HISTORY_SPEC.md", "output_dir": "cache/history"}
    missing = [str(p) for p in HASHES if not Path(p).exists()]
    checks.record("I1_inputs_present", not missing, {"missing": missing})
    if missing:
        sys.exit(f"STOP: input missing: {missing[0]}")
    bad = {str(p.name): sha256(p) for p, want in HASHES.items() if sha256(p) != want}
    files_b, files_l, files_all, corrected_bytes = polls_used()
    # The area-filtered bridge file under cache/rebuild/corrected/polls/ is the build's own output, not an input; H0 covers it.
    poll_bad = {f.name: "differs from the corrected build" for f in files_all if "rebuild/corrected/polls" not in str(f) and f.name in corrected_bytes and sha256(f) != corrected_bytes[f.name]}
    checks.record("I2_inputs_match", not bad and not poll_bad, {"hash_mismatches": bad, "polling_files": [str(f) for f in files_all], "polling_mismatches": poll_bad})
    if bad or poll_bad:
        sys.exit(f"STOP: inputs differ: {bad} {poll_bad}")
    man["inputs"] = {str(p.relative_to(REPO)) if str(p).startswith(str(REPO)) else str(p): want for p, want in HASHES.items()}
    man["polling_files"] = {f.name: sha256(f) for f in files_all}

    # Our own research cache (written by rebuild.py), hash checked above; not untrusted data.
    stage1 = pd.read_pickle(SRC / "dataset.pkl")
    base = pd.read_pickle(SRC / "bridge_level_dataset.pkl")

    # ---- H0: nothing added reproduces the base exactly
    h0_s1, h0 = run_stages(stage1.copy(), HIST / "h0", files_b, files_l)
    ident1, d1 = compare(h0_s1, stage1)
    ident, d = compare(h0, base)
    checks.record("H0_reproduces_corrected_build", ident1 and ident, {"stage1_differences": d1, "final_differences": d})
    if not (ident1 and ident):
        sys.exit("STOP: H0 failed")

    # ---- build
    ext1, rep, relabelled = new_rows(stage1)
    man["rows_added"] = rep
    _, ext = run_stages(ext1, HIST, files_b, files_l)
    shutil.copy2(common.CACHE / "fit_meta.pkl", HIST / "fit_meta.pkl")
    added = ext[~ext.ballot_paper_id.isin(set(base.ballot_paper_id))]

    # ---- P1, P2
    import backtest_b_anchor as bba
    import bridge_level_anchor as bla
    import prepare
    bba.POLL_FILES = list(files_b)
    _, pollsB, _, _ = bba.load_polls()
    bba.POLL_FILES = list(files_l)
    _, pollsL, _ = bla.load_polls()
    stage = {"B": [(dd, s) for dd, s, _, _ in pollsB], "L": [(dd, s) for dd, s, _, _ in pollsL], "P": prepare.load_polls()}
    p1_bad, unanch = [], []
    for dstr, grp in ext.groupby("date"):
        st = "B" if dstr < "2024-07-04" else ("L" if dstr < "2025-05-01" else "P")
        k = grp["anchor_kind"].dropna().unique().tolist()
        k = k[0] if k else None
        if k is None:
            unanch.append({"date": dstr, "rows": int(len(grp))})
            continue
        if k == "ge2024_result" or st == "P":
            continue  # 2024 general election rows and stage 1 poll windows: untouched by this build (R2 checks the anchors)
        w = 21 if "21d" in k else 14
        _, lanes = window_count(stage[st], date.fromisoformat(dstr), w)
        a = grp.iloc[0]
        need = [p for p in MAJOR if not (p == "Reform UK" and pd.isna(a["a_ref"]))]
        short = {p: lanes[p] for p in need if lanes[p] < 3}
        if short:
            p1_bad.append({"date": dstr, "short": short})
    checks.record("P1_anchored_dates_have_enough_polls", not p1_bad, {"violations": p1_bad})
    sched = ["2019-05-02", "2021-05-06", "2022-05-05", "2023-05-04", "2025-05-01", "2026-05-07"]
    sm = [s for s in sched if ext.loc[(ext.date == s) & ~ext.is_by.astype(bool), "anchor_kind"].isna().any()]
    checks.record("P2_scheduled_days_anchored", not sm, {"missing": sm, "dates_without_anchor": unanch,
                                                          "added_rows_by_anchor_kind": {str(k): int(v) for k, v in added.anchor_kind.value_counts(dropna=False).items()}})

    # ---- R1
    rb, re_ = row_counts(base), row_counts(ext)
    ra = row_counts(added)
    diff = {k: re_.get(k, 0) - rb.get(k, 0) for k in sorted(set(rb) | set(re_)) if re_.get(k, 0) != rb.get(k, 0)}
    checks.record("R1_row_difference_is_rows_added", diff == ra and len(added) == len(ext) - len(base),
                  {"base": len(base), "extended": len(ext), "added": len(added), "difference_by_year_type": diff, "added_by_year_type": ra})
    man["row_counts"] = {"base": rb, "extended": re_}

    # ---- R2
    sub = ext.set_index("ballot_paper_id").loc[base.ballot_paper_id].reset_index()
    sub = sub[base.columns]
    _, cd = compare(sub, base)
    from prepare import FEATURES_NUMERIC
    allowed_all = set(LAG_COLS) | set(STAGE_B_PREV)
    allowed_c = {"gss", "region", "region_code"} | set(FEATURES_NUMERIC)
    rel = sub.ballot_paper_id.isin(relabelled).to_numpy()
    outside = {}
    for c in cd:
        if c in allowed_all:
            continue
        if c in allowed_c:
            a, b = sub[c].astype(object).where(sub[c].notna(), "<blank>").astype(str), base[c].astype(object).where(base[c].notna(), "<blank>").astype(str)
            n_out = int(((a != b).to_numpy() & ~rel).sum())
            if n_out:
                outside[c] = {"rows_differing_outside_C": n_out}
            continue
        outside[c] = cd[c]
    checks.record("R2_only_allowed_columns_change", not outside, {"outside_allowed": outside, "differing_columns": cd,
                                                                   "anchor_columns_identical": not any(c in cd for c in ANCHOR_COLS)})

    # ---- S1, S2, S3
    s = ext[[f"s_{k}" for k in KEYS]].sum(axis=1)
    checks.record("S1_shares_sum_to_one", int(((s - 1).abs() > 0.001).sum()) == 0, {"max_abs_deviation": float((s - 1).abs().max())})
    from bridge_level_fit import BY_FROM, BY_TO, SCHEDULED as FS
    df = ext.reset_index(drop=True)
    anch = df.anchor_kind.notna().to_numpy()
    test = (~df.is_by & df.date.isin(FS)) | (df.is_by & (df.date >= BY_FROM) & (df.date < BY_TO))
    cut = pd.Series(np.where(df.date.isin(FS), df.date, df.date.str[:7] + "-01"), index=df.index).where(test)
    monthly = sorted(c for c in set(cut.dropna()) if c not in FS)
    s2 = []
    for c in list(FS) + monthly[::6]:
        tr = np.flatnonzero(anch & (df.date < c).to_numpy())
        te = np.flatnonzero((cut == c).to_numpy() & anch)
        ok = (not len(tr) or df.date.iloc[tr].max() < c) and (not len(te) or df.date.iloc[te].min() >= c) \
            and not (set(df.ballot_paper_id.iloc[tr]) & set(df.ballot_paper_id.iloc[te]))
        s2.append({"cut": c, "train": int(len(tr)), "test": int(len(te)), "ok": bool(ok)})
    checks.record("S2_forward_only_folds", all(r["ok"] for r in s2), {"folds": len(s2), "failing": [r for r in s2 if not r["ok"]]})
    pv = ext[ext.prev_date.notna()]
    checks.record("S3_previous_contest_earlier", int((pv.prev_date >= pv.date).sum()) == 0, {"rows_with_previous": int(len(pv))})

    # ---- descriptive
    man["added_rows"] = {"by_source_and_date": {f"{a} {b}": int(n) for (a, b), n in added.groupby(["source", "date"]).size().items()},
                         "with_previous_contest": int(added.has_prev.sum()),
                         "anchored": int(added.anchor_kind.notna().sum())}
    man["has_prev_by_year"] = {"base": {k: int(v) for k, v in base.groupby(base.date.str[:4]).has_prev.sum().items()},
                               "extended": {k: int(v) for k, v in ext.groupby(ext.date.str[:4]).has_prev.sum().items()}}
    man["outputs"] = {f.name: sha256(f) for f in sorted(HIST.iterdir()) if f.suffix in (".pkl", ".json")}
    man["checks"] = checks.results
    man["failed"] = checks.failed()
    (HERE / "results").mkdir(exist_ok=True)
    txt = json.dumps(man, indent=1, default=str) + "\n"
    (HIST / "history_manifest.json").write_text(txt)
    (HERE / "results/history_manifest.json").write_text(txt)
    if man["failed"]:
        sys.exit("STOP: checks failed: " + ", ".join(man["failed"]))
    print("all checks passed; results/history_manifest.json")


if __name__ == "__main__":
    main()
