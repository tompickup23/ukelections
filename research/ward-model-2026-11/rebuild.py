"""Checked rebuild of the research dataset and anchors (REBUILD_SPEC.md).

One command:
  uv run python rebuild.py --polls corrected          # PR 199 extract + area rule (amendment, 28 Nov 2026)
  uv run python rebuild.py --polls pr199              # PR 199 extract only, bridge file as committed
  uv run python rebuild.py --polls old --reproduce    # the stage A extract, compared with the PR 197 cache

Runs prepare.py, backtest_b_anchor.py and bridge_level_anchor.py unchanged, in
that order, with their cache pointed at cache/rebuild/<polls>/, then runs the
checks of the specification. Writes cache/rebuild/<polls>/rebuild_manifest.json,
copies it to results/rebuild_manifest_<polls>.json, and exits 1 naming every
failed check. Research only; nothing on the site reads any of it.
"""
from __future__ import annotations

import argparse
import csv
import json
import shutil
import subprocess
import sys
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

import common

HERE = common.HERE
REPO = common.REPO
BASE_CACHE = common.CACHE
REF = BASE_CACHE / "reference"
OLD_2019_24 = REPO / "data/polling/wikipedia/westminster-2019-12-13-to-2024-07-04.json"
NEW_2019_24 = BASE_CACHE / "pr199/westminster-2019-12-13-to-2024-07-03.json"
PR192 = [BASE_CACHE / f"pr192/westminster-{s}.json" for s in
         ("2017-06-08-to-2017-12-31", "2018-01-01-to-2019-05-02", "2019-05-03-to-2019-12-12")]
BRIDGE_POLLS = HERE / "bridge_level_polls_2024-07-05_to_2025-04-14.json"
SCHEDULED = ["2019-05-02", "2021-05-06", "2022-05-05", "2023-05-04", "2025-05-01", "2026-05-07"]
KEYS = [common.LANE_KEY[p] for p in common.LANES]
ANCHOR_COLS = {"anchor_kind", "prev_anchor_kind"} | {f"a_{k}" for k in KEYS} | {f"prev_a_{k}" for k in KEYS}
FIT_META_SHA = "936d07ee4d9004d1cdd811796f60dbfb1b22a723e7575789b56292c287ac67ad"
DRIVE_SHA = {
    "ward_contests_v2.csv": "23baa08041a06683d2a54638afb07fd38586e1e5b61f041d253fbaeb8bc99f6d",
    "universe_features_v2.csv": "592a5e96f447a719c61db231c93e14babacbc9d0a344c83041cf1a03b3f97404",
}
GIT_SOURCES = {  # cache file: (commit, path in that commit)
    PR192[0]: ("6ad332723f0efaed8290573ee801f75bc7807b04", "data/polling/wikipedia/westminster-2017-06-08-to-2017-12-31.json"),
    PR192[1]: ("6ad332723f0efaed8290573ee801f75bc7807b04", "data/polling/wikipedia/westminster-2018-01-01-to-2019-05-02.json"),
    PR192[2]: ("6ad332723f0efaed8290573ee801f75bc7807b04", "data/polling/wikipedia/westminster-2019-05-03-to-2019-12-12.json"),
    NEW_2019_24: ("ef8f0464ce596ab47429d24e740bb4b1e27f7622", "data/polling/wikipedia/westminster-2019-12-13-to-2024-07-03.json"),
}
SHARE_TOL = 0.001
PLAID_MAX = 0.03
MIN_POLLS = 3
SNP_MAX = 0.08
AREAS_KEPT = {"GB", "UK"}  # amendment rule 3: every other area, null included, is excluded (mode corrected)


class Checks:
    def __init__(self, expected_fail=()):
        self.results, self.expected = {}, set(expected_fail)

    def record(self, name, ok, detail):
        status = "pass" if ok else ("fail_expected" if name in self.expected else "fail")
        self.results[name] = {"status": status, "detail": detail}
        print(f"[{status.upper():13s}] {name}: {json.dumps(detail, default=str)[:300]}", flush=True)

    def failed(self):
        return [k for k, v in self.results.items() if v["status"] == "fail"]


def sha(path: Path) -> str:
    return common.sha256(path)


def inputs(polls_2019_24: Path):
    p = common
    rows = [
        (p.MATRIX, "Drive doge:DOGE/Elections & Demographics/07 Models (Reform propensity)/ward_contests_v2.csv (9 Aug 2026), this Mac only"),
        (p.UNIVERSE, "Drive doge:DOGE/Elections & Demographics/07 Models (Reform propensity)/universe_features_v2.csv (9 Aug 2026), this Mac only"),
        (p.DC_HISTORY, "data/history/dc-historic-results.json, gitignored, this Mac only (scripts/ingest-dc-historic-results.mjs)"),
        (p.MAY26_ACTUALS, "tracked repo file"),
        (p.POSTAUDIT, "tracked repo file"),
        (p.POLLS_TS, "tracked repo file"),
        (p.POLLS_2025, "tracked; Wikipedia 'Opinion polling for the next United Kingdom general election' rev 1383556886"),
        (BRIDGE_POLLS, "this folder (PR 197); same page and revision"),
        *[(f, "PR 192 commit 6ad3327 via git show; Wikipedia 'Opinion polling for the 2019 United Kingdom general election' rev 1374586459") for f in PR192],
        (polls_2019_24, ("PR 199 commit ef8f046 via git show" if polls_2019_24 == NEW_2019_24 else "stage A, tracked on this branch")
         + "; Wikipedia 'Opinion polling for the 2024 United Kingdom general election' rev 1363820081"),
        (BASE_CACHE / "fit_meta.pkl", "fit_predict.py output of 27 Nov 2026 02:04, gitignored cache"),
    ]
    byfiles = sorted(Path(p.BYELECTION_DIR).glob("*.json"))
    return rows, byfiles


def git_bytes_sha(commit: str, path: str) -> str:
    import hashlib
    b = subprocess.run(["git", "-C", str(REPO), "show", f"{commit}:{path}"], check=True, capture_output=True).stdout
    return hashlib.sha256(b).hexdigest()


def compare(new: pd.DataFrame, ref: pd.DataFrame):
    """Column by column difference; returns (identical, {column: summary}) over differing columns."""
    out = {}
    if new.shape[0] != ref.shape[0] or list(new["ballot_paper_id"]) != list(ref["ballot_paper_id"]):
        return False, {"_rows": f"rows or order differ: {new.shape[0]} against {ref.shape[0]}"}
    cols_new, cols_ref = set(new.columns), set(ref.columns)
    if cols_new != cols_ref:
        out["_columns"] = {"only_new": sorted(cols_new - cols_ref), "only_reference": sorted(cols_ref - cols_new)}
    for c in [c for c in ref.columns if c in cols_new]:
        a, b = new[c], ref[c]
        if pd.api.types.is_numeric_dtype(a) and pd.api.types.is_numeric_dtype(b) and a.dtype != bool:
            x, y = a.astype(float).to_numpy(), b.astype(float).to_numpy()
            nan_mismatch = int((np.isnan(x) != np.isnan(y)).sum())
            both = ~np.isnan(x) & ~np.isnan(y)
            diff = float(np.max(np.abs(x[both] - y[both]))) if both.any() else 0.0
            if nan_mismatch or diff > 0:
                out[c] = {"max_abs_difference": diff, "rows_differing": int((both & (x != y)).sum()) + nan_mismatch,
                          "blank_in_one_only": nan_mismatch}
        else:
            sa = a.astype(object).where(a.notna(), "<blank>").astype(str)
            sb = b.astype(object).where(b.notna(), "<blank>").astype(str)
            n = int((sa != sb).sum())
            if n:
                out[c] = {"rows_differing": n}
    return not out, out


def row_counts(df: pd.DataFrame):
    g = df.groupby([df["date"].str[:4], df["is_by"].astype(bool)]).size()
    return {f"{y} {'by-election' if b else 'scheduled'}": int(v) for (y, b), v in g.items()}


def window_count(polls, when: date, window: int):
    """polls: list of (date, shares). Returns (polls in window, {lane: polls carrying it})."""
    lo = when - timedelta(days=window - 1)
    rows = [s for d, s in polls if lo <= d <= when]
    lanes = {}
    for p in common.MAJOR:
        if p == "Reform UK":
            lanes[p] = sum(1 for s in rows if s.get("Reform UK", s.get("Brexit Party")) is not None)
        else:
            lanes[p] = sum(1 for s in rows if s.get(p) is not None)
    return len(rows), lanes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--polls", choices=["old", "pr199", "corrected"], default="corrected")
    ap.add_argument("--reproduce", action="store_true", help="compare with cache/reference and require nil difference (old polls)")
    args = ap.parse_args()
    polls_2019_24 = OLD_2019_24 if args.polls == "old" else NEW_2019_24
    out = BASE_CACHE / "rebuild" / args.polls
    out.mkdir(parents=True, exist_ok=True)
    expected = set()
    if args.polls == "old" and args.reproduce:
        expected = {"P3_no_party_column_misfiled", "P6_area_check_every_file"}
    elif args.polls == "pr199":
        expected = {"P6_area_check_every_file"}  # P3 handled below: expected only if confined to the bridge file
    checks = Checks(expected_fail=expected)
    manifest = {"spec": "REBUILD_SPEC.md", "polls_2019_to_2024": args.polls, "output_dir": str(out.relative_to(HERE)),
                "reference_dir": str(REF.relative_to(HERE))}

    # ---------------------------------------------------------------- I. inputs
    rows, byfiles = inputs(polls_2019_24)
    missing = [str(f) for f, _ in rows if not Path(f).exists()]
    checks.record("I1_inputs_present", not missing, {"missing": missing, "files": len(rows), "byelection_contest_files": len(byfiles)})
    if missing:
        sys.exit(f"STOP: input missing: {missing[0]}. See REBUILD_README.md for where each input comes from.")
    manifest["inputs"] = [{"path": str(Path(f).resolve().relative_to(REPO)) if str(Path(f).resolve()).startswith(str(REPO)) else str(Path(f).resolve()),
                           "via_symlink": Path(f).is_symlink(), "bytes": Path(f).stat().st_size, "sha256": sha(Path(f)), "source": s} for f, s in rows]
    import hashlib
    h = hashlib.sha256()
    for f in byfiles:
        h.update(f.name.encode())
        h.update(Path(f).read_bytes())
    manifest["inputs"].append({"path": "data/contests/local-byelections/*.json", "files": len(byfiles),
                               "sha256_of_names_and_bytes_in_name_order": h.hexdigest(), "source": "tracked repo files"})
    bad = {}
    for name, want in DRIVE_SHA.items():
        got = sha(common.DRIVE / name)
        if got != want:
            bad[name] = got
    for f, (commit, path) in GIT_SOURCES.items():
        if f in PR192 or f == polls_2019_24:
            want = git_bytes_sha(commit, path)
            if sha(f) != want:
                bad[f.name] = f"differs from {commit[:7]}:{path}"
    if sha(BASE_CACHE / "fit_meta.pkl") != FIT_META_SHA:
        bad["fit_meta.pkl"] = "sha256 differs from the specification"
    checks.record("I2_inputs_match_named_editions", not bad, {"mismatches": bad})
    if bad:
        sys.exit(f"STOP: inputs do not match their named editions: {bad}")

    # ---------------------------------------------------------------- area check (amendment rule 3)
    pr192_used, p2019_used, bridge_used, p2025_used = list(PR192), polls_2019_24, BRIDGE_POLLS, common.POLLS_2025
    area_report, excluded = {}, {}
    (out / "polls").mkdir(exist_ok=True)

    def area_filter(f: Path) -> Path:
        src = common.read_json(f)
        P = src["polls"]
        area_report[f.name] = dict(Counter(str(p.get("area")) for p in P))
        bad = [p for p in P if p.get("area") not in AREAS_KEPT]
        if bad:
            excluded[f.name] = [{"fieldwork_end": p["fieldwork_end"], "pollster": p["pollster"], "client": p.get("client"),
                                 "area": p.get("area"), "sample": p.get("sample")} for p in bad]
        if args.polls != "corrected" or not bad:
            return f
        dst = out / "polls" / f.name
        dst.write_text(json.dumps({**src, "polls": [p for p in P if p.get("area") in AREAS_KEPT],
                                   "area_filter": f"amendment of 28 Nov 2026: {len(bad)} polls with area not in GB/UK removed"},
                                  indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        return dst

    pr192_used = [area_filter(f) for f in PR192]
    p2019_used = area_filter(polls_2019_24)
    bridge_used = area_filter(BRIDGE_POLLS)
    p2025_used = area_filter(common.POLLS_2025)
    ts = common.read_json(common.POLLS_TS)["polls"]
    ts_flag = [(p["date"], p["pollster"]) for p in ts
               if (p["shares"].get("Plaid Cymru") or 0) > PLAID_MAX or (p["shares"].get("SNP") or 0) > SNP_MAX]
    area_report[common.POLLS_TS.name] = {"no area field": len(ts), "plaid_or_snp_above_threshold": ts_flag}
    manifest["area_check"] = {"rule": "keep area GB or UK; exclude every other value, null included" + ("" if args.polls == "corrected" else " (reported, not applied, in this mode)"),
                              "by_file": area_report, "excluded_or_would_be": excluded,
                              "files_read": [str(x.relative_to(HERE)) if str(x).startswith(str(HERE)) else str(x.relative_to(REPO))
                                             for x in pr192_used + [p2019_used, bridge_used, p2025_used]]}

    # ---------------------------------------------------------------- build, scripts unchanged
    common.CACHE = out  # the three scripts read and write CACHE / <file>; inputs keep their own paths
    import prepare
    prepare.POLLS_2025 = p2025_used
    prepare.main()
    import backtest_b_anchor as bba
    bba.POLL_FILES = pr192_used + [p2019_used]
    bba.main()
    import bridge_level_anchor as bla
    bba.POLL_FILES = [p2019_used, bridge_used, p2025_used]
    bla.main()
    shutil.copy2(BASE_CACHE / "fit_meta.pkl", out / "fit_meta.pkl")
    manifest["build_steps"] = [
        "prepare.main() -> dataset.pkl, dataset_meta.pkl",
        f"backtest_b_anchor.main() with POLL_FILES = PR 192 x3 + {p2019_used.name} -> backtest_b_dataset.pkl",
        f"bridge_level_anchor.main() with POLL_FILES = {p2019_used}, {bridge_used}, {p2025_used} -> bridge_level_dataset.pkl",
    ]

    # Pickles here are this folder's own cache, written by the steps above or copied from our own
    # research worktree (cache/reference); not untrusted data.
    ds = {n: pd.read_pickle(out / f"{n}.pkl") for n in ("dataset", "backtest_b_dataset", "bridge_level_dataset")}
    final = ds["bridge_level_dataset"]
    meta = pd.read_pickle(out / "dataset_meta.pkl")

    # ---------------------------------------------------------------- P. polling
    bba.POLL_FILES = pr192_used + [p2019_used]
    srcB, pollsB, r0, multiB = bba.load_polls()
    bba.POLL_FILES = [p2019_used, bridge_used, p2025_used]
    srcL, pollsL, multiL = bla.load_polls()
    pollsP = prepare.load_polls()
    stage_polls = {"B": [(d, s) for d, s, _, _ in pollsB], "L": [(d, s) for d, s, _, _ in pollsL], "P": pollsP}

    def stage_of(dstr):
        if dstr < "2024-07-04":
            return "B"
        if dstr < "2025-05-01":
            return "L"
        return "P"

    per_date, p1_bad = [], []
    by_date = final.groupby("date")
    for dstr, grp in by_date:
        st = stage_of(dstr)
        kind = grp["anchor_kind"].dropna().unique().tolist()
        k = kind[0] if kind else None
        w = 21 if (k and "21d" in k) else 14
        when = date.fromisoformat(dstr)
        if st == "P" and (grp["set"] == "byelection").any():
            last = max((d for d, _ in pollsP if d <= when), default=None)
            if last is not None and (when - last).days <= 21:
                when = last
        n14, l14 = window_count(stage_polls[st], when, 14)
        n21, l21 = window_count(stage_polls[st], when, 21)
        row = {"date": dstr, "poll_set": {"B": "stage B files", "L": "bridge level files", "P": "prepare.py files"}[st],
               "rows": len(grp), "scheduled_rows": int((~grp.is_by.astype(bool)).sum()), "anchor_kind": k,
               "polls_14d": n14, "polls_21d": n21, **{f"polls_{w}d_{common.LANE_KEY[p]}": (l14 if w == 14 else l21)[p] for p in common.MAJOR}}
        a = grp.iloc[0]
        for kk in KEYS:
            row[f"a_{kk}"] = None if pd.isna(a[f"a_{kk}"]) else round(float(a[f"a_{kk}"]), 5)
        if k and k != "ge2024_result":
            lanes = l21 if w == 21 else l14
            need = [p for p in common.MAJOR if not (p == "Reform UK" and pd.isna(a["a_ref"]))]
            short = {p: lanes[p] for p in need if lanes[p] < MIN_POLLS}
            if short:
                p1_bad.append({"date": dstr, "anchor_kind": k, "short_lanes": short})
        per_date.append(row)
    fields = sorted({k for r in per_date for k in r}, key=lambda c: (c not in ("date", "poll_set", "rows", "scheduled_rows", "anchor_kind"), c))
    with open(out / "polls_by_date.csv", "w", newline="") as f:
        wri = csv.DictWriter(f, fieldnames=fields)
        wri.writeheader()
        wri.writerows(per_date)
    checks.record("P1_anchored_dates_have_enough_polls", not p1_bad, {"contest_dates": len(per_date), "violations": p1_bad[:20]})

    unanch = [{"date": r["date"], "rows": r["rows"], "scheduled_rows": r["scheduled_rows"], "polls_14d": r["polls_14d"], "polls_21d": r["polls_21d"]}
              for r in per_date if r["anchor_kind"] is None]
    manifest["contest_dates_without_anchor"] = unanch
    sched_missing = [d for d in SCHEDULED if final.loc[(final.date == d) & ~final.is_by.astype(bool), "anchor_kind"].isna().any()]
    checks.record("P2_scheduled_days_anchored", not sched_missing,
                  {"scheduled_days_without_anchor": sched_missing, "contest_dates_without_anchor": len(unanch),
                   "rows_without_anchor": int(sum(u["rows"] for u in unanch))})

    p3 = {}
    files = pr192_used + [p2019_used, bridge_used, p2025_used]
    for f in files:
        P = common.read_json(f)["polls"]
        hi = [(p["fieldwork_end"], p["pollster"], p["shares"]["Plaid Cymru"]) for p in P if (p["shares"].get("Plaid Cymru") or 0) > PLAID_MAX]
        if hi:
            p3[f"{f.name}: Plaid Cymru above {PLAID_MAX}"] = {"polls": len(hi), "examples": hi[:5]}
    P = common.read_json(p2019_used)["polls"]
    brx20 = sum(1 for p in P if p["fieldwork_end"].startswith("2020") and "Brexit Party" in p["shares"])
    if brx20 < 100:
        p3["2020 polls with a Brexit Party share"] = brx20
    dp = [p["shares"] for p in P if p["pollster"] == "Deltapoll" and p["fieldwork_end"] == "2020-12-30"]
    if not dp or dp[0].get("Brexit Party") != 0.03 or dp[0].get("Plaid Cymru") not in (0, 0.0):
        p3["Deltapoll ending 30 Dec 2020 (page: Brexit Party 3%, Plaid Cymru 0%)"] = dp
    if args.polls == "pr199" and p3 and all(k.startswith(BRIDGE_POLLS.name + ":") for k in p3):
        checks.expected.add("P3_no_party_column_misfiled")  # amendment: expected on the bridge file alone
    checks.record("P3_no_party_column_misfiled", not p3, {"faults": p3, "polls_2020_with_brexit_party": brx20})

    def raw_count(fs):
        seen, n, multi = set(), 0, 0
        for f in fs:
            for p in common.read_json(f)["polls"]:
                if p.get("row_of_multi_row_poll"):
                    multi += 1
                    continue
                key = (p["fieldwork_end"], p["pollster"], tuple(sorted(p["shares"].items())))
                if key not in seen:
                    seen.add(key)
                    n += 1
        return n
    nb, nl = raw_count(pr192_used + [p2019_used]), raw_count([p2019_used, bridge_used, p2025_used])
    areaB, areaL = Counter(a for *_, a in pollsB), Counter(a for *_, a in pollsL)
    checks.record("P4_uk_samples_pooled_not_filtered", nb == len(pollsB) and nl == len(pollsL),
                  {"stage_b_loaded": len(pollsB), "stage_b_in_files_less_duplicates_and_multi_row": nb, "stage_b_by_area": dict(areaB),
                   "bridge_loaded": len(pollsL), "bridge_in_files_less_duplicates_and_multi_row": nl, "bridge_by_area": dict(areaL),
                   "rule": "GB and UK samples pooled without distinction (backtest_b_anchor.load_polls keeps every area)"})

    loaded_bad = {"stage_b": sum(1 for *_, a in pollsB if a not in AREAS_KEPT), "bridge": sum(1 for *_, a in pollsL if a not in AREAS_KEPT)}
    checks.record("P6_area_check_every_file", not any(loaded_bad.values()) and not ts_flag,
                  {"loaded_with_area_not_gb_uk": loaded_bad, "excluded_by_file": {k: len(v) for k, v in excluded.items()},
                   "timeseries_no_area_flagged": ts_flag, "applied": args.polls == "corrected"})

    ge = meta["ge2024_gb"]["shares"]
    win = final[(final.date >= "2024-07-04") & (final.date < "2025-05-01")]
    kinds = win["anchor_kind"].value_counts(dropna=False).to_dict()
    on_ge = win[win.anchor_kind.notna()]
    equal_ge = on_ge[np.all([np.isclose(on_ge[f"a_{common.LANE_KEY[p]}"].round(4), round(ge[p], 4)) for p in common.LANES], axis=0)] if len(on_ge) else on_ge
    bad_kind = [str(k) for k in kinds if not (pd.isna(k) or str(k).endswith("_bridge_level"))]
    checks.record("P5_jul2024_apr2025_anchored_on_polls", not bad_kind and len(equal_ge) == 0,
                  {"rows": int(len(win)), "anchor_kinds": {str(k): int(v) for k, v in kinds.items()}, "kinds_not_from_polls": bad_kind,
                   "anchored_rows_equal_to_ge2024_result": int(len(equal_ge))})

    # ---------------------------------------------------------------- R. rows
    rc, rdiff = {}, {}
    for n, df in ds.items():
        ref = pd.read_pickle(REF / f"{n}.pkl")
        a, b = row_counts(df), row_counts(ref)
        rc[n] = a
        d = {k: {"rebuilt": a.get(k, 0), "reference": b.get(k, 0)} for k in sorted(set(a) | set(b)) if a.get(k, 0) != b.get(k, 0)}
        if d:
            rdiff[n] = d
    manifest["row_counts"] = rc
    checks.record("R1_row_counts_match_last_build", not rdiff, {"differences": rdiff, "rows": {n: len(df) for n, df in ds.items()}})

    comp = {}
    for n, df in ds.items():
        ident, diff = compare(df, pd.read_pickle(REF / f"{n}.pkl"))
        comp[n] = {"identical": ident, "differing_columns": diff}
    manifest["comparison_with_reference"] = comp
    if args.reproduce:
        checks.record("R0_reproduces_reference_exactly", all(c["identical"] for c in comp.values()),
                      {n: (c["differing_columns"] or "nil difference") for n, c in comp.items()})
    else:
        non_anchor = {n: {c: v for c, v in comp[n]["differing_columns"].items() if c not in ANCHOR_COLS} for n in comp}
        checks.record("R2_only_anchor_columns_change", not any(non_anchor.values()),
                      {"non_anchor_differences": non_anchor,
                       "anchor_columns_differing": {n: sorted(c for c in comp[n]["differing_columns"] if c in ANCHOR_COLS) for n in comp}})

    # ---------------------------------------------------------------- S. shares and time
    worst = {}
    for n, df in ds.items():
        s = df[[f"s_{k}" for k in KEYS]].sum(axis=1)
        worst[n] = {"max_abs_deviation_from_1": float((s - 1).abs().max()), "rows_beyond_tolerance": int(((s - 1).abs() > SHARE_TOL).sum())}
    checks.record("S1_shares_sum_to_one", all(v["rows_beyond_tolerance"] == 0 for v in worst.values()), {"tolerance": SHARE_TOL, **worst})

    from bridge_level_fit import BY_FROM, BY_TO, SCHEDULED as FIT_SCHED
    df = final.reset_index(drop=True)
    df["is_by"] = df["is_by"].astype(bool)
    anch = df.anchor_kind.notna().to_numpy()
    test = (~df.is_by & df.date.isin(FIT_SCHED)) | (df.is_by & (df.date >= BY_FROM) & (df.date < BY_TO))
    cut = pd.Series(np.where(df.date.isin(FIT_SCHED), df.date, df.date.str[:7] + "-01"), index=df.index).where(test)
    monthly = sorted(c for c in set(cut.dropna()) if c not in FIT_SCHED)
    sample = list(FIT_SCHED) + monthly[::6]
    s2 = []
    for c in sample:
        tr = np.flatnonzero(anch & (df.date < c).to_numpy())
        te = np.flatnonzero((cut == c).to_numpy() & anch)
        tr_max = df.date.iloc[tr].max() if len(tr) else None
        te_min = df.date.iloc[te].min() if len(te) else None
        overlap = len(set(df.ballot_paper_id.iloc[tr]) & set(df.ballot_paper_id.iloc[te]))
        ok = (tr_max is None or tr_max < c) and (te_min is None or te_min >= c) and overlap == 0
        s2.append({"cut": c, "train_rows": int(len(tr)), "latest_training_date": tr_max, "test_rows": int(len(te)),
                   "earliest_test_date": te_min, "test_ballots_in_training": overlap, "ok": bool(ok)})
    checks.record("S2_forward_only_folds", all(r["ok"] for r in s2), {"folds_checked": len(s2), "failing": [r for r in s2 if not r["ok"]]})
    manifest["forward_only_folds"] = s2
    pv = final[final.prev_date.notna()]
    late = pv[pv.prev_date >= pv.date]
    checks.record("S3_previous_contest_earlier", len(late) == 0, {"rows_with_previous_contest": int(len(pv)), "previous_not_earlier": int(len(late))})

    manifest["anchors_on_scheduled_days"] = {d: next(({k: v for k, v in r.items() if k.startswith(("a_", "polls_", "anchor_kind"))}
                                                      for r in per_date if r["date"] == d), None) for d in SCHEDULED}
    manifest["anchored_rows_by_year"] = {k: int(v) for k, v in final[final.anchor_kind.notna()].groupby(final.date.str[:4]).size().items()}
    manifest["outputs"] = {f.name: {"bytes": f.stat().st_size, "sha256": sha(f)} for f in sorted(out.iterdir()) if f.suffix in (".pkl", ".json", ".csv") and f.name != "rebuild_manifest.json"}
    manifest["checks"] = checks.results
    manifest["failed"] = checks.failed()
    manifest["expected_failures"] = [k for k, v in checks.results.items() if v["status"] == "fail_expected"]
    with open(out / "rebuild_manifest.json", "w") as f:
        json.dump(manifest, f, indent=1, default=str)
        f.write("\n")
    (HERE / "results").mkdir(exist_ok=True)
    shutil.copy2(out / "rebuild_manifest.json", HERE / "results" / f"rebuild_manifest_{args.polls}.json")
    if manifest["failed"]:
        sys.exit("STOP: checks failed: " + ", ".join(manifest["failed"]) + f". Details in {out / 'rebuild_manifest.json'}")
    print(f"all checks passed{' (expected failures: ' + ', '.join(manifest['expected_failures']) + ')' if manifest['expected_failures'] else ''}; manifest {out / 'rebuild_manifest.json'}")


if __name__ == "__main__":
    main()
