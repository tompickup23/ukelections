"""Live by-election forecasts from the ward model (LIVE_SPEC.md).

Writes the C2 ward model's forecast for every upcoming council by-election
whose polls have not opened, time-stamped, to live/live_forecasts.json. A
contest the model cannot forecast honestly gets a record with no forecast and
a stated reason. A record is frozen once polls open (07:00 UK time on polling
day): a later run refuses to change it.

    uv run python live_forecast.py                      # contests and polls from origin/main
    uv run python live_forecast.py --polls=<file>       # a fresher data/polling/timeseries.json
    uv run python live_forecast.py --dry-run            # print, write nothing

Research only. Nothing on the site reads this file.

Inputs (this folder's own gitignored cache, copied read only from the research worktree):
  cache/bridge_level_dataset.pkl          the dataset C2 was tested on
  cache/fit_meta.pkl                      lane settings and lane spreads
  cache/drive07/universe_features_v2.csv  ward features by GSS code
"""
from __future__ import annotations

import argparse
import io
import json
import shutil
import subprocess
import sys
import tarfile
from collections import defaultdict
from datetime import date, datetime, time, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
from threadpoolctl import threadpool_limits

import prepare
from bridge_level_fit import FEATS, MIN_ROWS, STAND, standing_inputs
from common import CACHE, HERE, LANES, LANE_KEY, MAY26, REPO, UNIVERSE, expit, logit, pool_party, sha256
from prepare import FEATURES_NUMERIC, REGIONS, fnum
from rolling_fit import make

MODEL_VERSION = "ward-model-2026-11/C2"
FORECASTER = "uk-elections-research-model"
LIVE_DIR = HERE / "live"
LIVE_FILE = LIVE_DIR / "live_forecasts.json"
INPUTS_DIR = LIVE_DIR / "inputs"
CONTEST_PATH = "data/contests/local-byelections"
POLLS_TS_PATH = "data/polling/timeseries.json"
BASE_DATASET = CACHE / "bridge_level_dataset.pkl"
FIT_META = CACHE / "fit_meta.pkl"
KEYS = [LANE_KEY[p] for p in LANES]
LANE_OF_KEY = {LANE_KEY[p]: p for p in LANES}
UK = ZoneInfo("Europe/London")
DRAWS = 20000
DRAW_SEED = 20261127
FEATURES = FEATS["c2"]


class FrozenRecordError(RuntimeError):
    """Raised when a run would change a record after its polls opened."""


# ------------------------------------------------------------- freezing ----

def polls_open_at(polling_day: str) -> datetime:
    """07:00 Europe/London on polling day, as a UTC instant."""
    return datetime.combine(date.fromisoformat(polling_day), time(7, 0), tzinfo=UK).astimezone(timezone.utc)


def is_frozen(polling_day: str, now: datetime) -> bool:
    return now >= polls_open_at(polling_day)


def merge_records(existing: dict, new: dict, now: datetime) -> dict:
    """Records after this run. A record whose polls have opened is never changed
    and never created; any attempt raises FrozenRecordError and nothing is written."""
    out = dict(existing)
    refused = []
    for bid, rec in new.items():
        if is_frozen(rec["polling_day"], now):
            old = existing.get(bid)
            if old != rec:
                refused.append(bid)
            continue
        out[bid] = rec
    if refused:
        raise FrozenRecordError(f"polls have opened; refusing to change {', '.join(sorted(refused))}")
    for bid, old in existing.items():
        if is_frozen(old["polling_day"], now) and out[bid] != old:
            raise FrozenRecordError(f"polls have opened; refusing to change {bid}")
    return out


# ---------------------------------------------------------------- inputs ----

def git(*args: str) -> str:
    return subprocess.run(["git", "-C", str(REPO), *args], check=True, capture_output=True, text=True).stdout.strip()


def load_contests(ref: str) -> tuple[list[dict], str]:
    """Every contest file under data/contests/local-byelections at a git ref, sorted by file name."""
    commit = git("rev-parse", ref)
    tar = subprocess.run(["git", "-C", str(REPO), "archive", commit, CONTEST_PATH], check=True, capture_output=True).stdout
    out = []
    with tarfile.open(fileobj=io.BytesIO(tar)) as tf:
        for m in sorted(tf.getmembers(), key=lambda m: m.name):
            name = Path(m.name).name
            if not m.isfile() or not name.endswith(".json") or name.startswith("_"):
                continue
            d = json.loads(tf.extractfile(m).read().decode("utf-8"))
            d["_file"] = f"{CONTEST_PATH}/{name}"
            out.append(d)
    return out, commit


def polls_file(ref: str, override: str | None) -> Path:
    """The timeseries file this run uses, copied into live/inputs/ under its sha256."""
    if override:
        src = Path(override)
        raw = src.read_bytes()
    else:
        raw = subprocess.run(["git", "-C", str(REPO), "show", f"{ref}:{POLLS_TS_PATH}"], check=True, capture_output=True).stdout
    INPUTS_DIR.mkdir(parents=True, exist_ok=True)
    tmp = INPUTS_DIR / "_incoming.json"
    tmp.write_bytes(raw)
    dest = INPUTS_DIR / f"timeseries-{sha256(tmp)[:12]}.json"
    shutil.move(tmp, dest)
    return dest


def load_polls(ts_path: Path):
    """prepare.load_polls, unchanged, reading the given timeseries file."""
    saved = prepare.POLLS_TS
    prepare.POLLS_TS = ts_path
    try:
        return prepare.load_polls()
    finally:
        prepare.POLLS_TS = saved


def polls_provenance(ts_path: Path) -> dict:
    d = json.loads(ts_path.read_text(encoding="utf-8"))
    return {
        "file": str(ts_path.relative_to(REPO)),
        "sha256": sha256(ts_path),
        "generated_at": d.get("generated_at"),
        "latest_poll_date": max(p["date"] for p in d["polls"]),
        "polls": len(d["polls"]),
        "wikipedia_wikitext_sha256": (d.get("source") or {}).get("wikipedia", {}).get("wikitext_sha256"),
        "also_read": str(prepare.POLLS_2025.relative_to(REPO)),
    }


# ------------------------------------------------------------------ rows ----

def contest_row(d: dict, u: dict, with_result: bool) -> dict:
    """One by-election row, built as prepare.py builds its by-election rows."""
    c = d["contest"]
    stood = defaultdict(bool)
    for cand in d["field"]["candidates"]:
        stood[pool_party(cand.get("party") or "")] = True
    pooled = None
    if with_result:
        pooled = defaultdict(float)
        for party, v in d["result"]["shares"].items():
            pooled[pool_party(party)] += v or 0
    row = {
        "ballot_paper_id": c["ballot_paper_id"], "date": c["polling_day"], "council": c["council_slug"],
        "gss": c["ward_gss"], "is_by": True, "source": "byelection_file", "region": u.get("region_name"),
        "set": "byelection" if with_result else "live", "slug": d["slug"],
    }
    for col in FEATURES_NUMERIC:
        row[col] = fnum(u.get(col))
    for p in LANES:
        k = LANE_KEY[p]
        row[f"s_{k}"] = pooled.get(p, 0.0) if pooled is not None else np.nan
        row[f"stood_{k}"] = bool(stood.get(p))
    return row


def skip_reason(d: dict, universe: dict) -> str | None:
    c = d["contest"]
    if c.get("territory") != "ENG":
        return "outside_england"
    if not c.get("ward_gss") or c["ward_gss"] not in universe:
        return "no_ward_code_in_feature_file"
    f = d.get("field") or {}
    if f.get("sopn_published") is not True or not f.get("candidates"):
        return "no_published_candidate_list"
    return None


REASON_TEXT = {
    "outside_england": "The ward feature file covers English wards only.",
    "no_ward_code_in_feature_file": "The contest's ward code is missing or not in the ward feature file, so the model has no ward inputs.",
    "no_published_candidate_list": "No statement of persons nominated on Democracy Club yet, so who is standing is not known.",
    "no_polling_anchor": "Too few recent GB polls on the run date to build the national anchor.",
    "standing_lane_without_model": "A party lane standing here has fewer than 50 training contests.",
}


def ward_lags(df: pd.DataFrame, idx) -> None:
    """prepare.py's ward lags for the rows in idx, over every row with a result."""
    cols = ["gss", "d"] + [f"s_{k}" for k in KEYS] + [f"stood_{k}" for k in KEYS]
    hist = df[df["gss"].notna() & (df["gss"] != "") & df["s_ref"].notna()][cols].copy().sort_values("d")
    by_gss = {g: grp for g, grp in hist.groupby("gss")}
    hist["year"] = hist["d"].dt.year
    ym_cache = {}

    def year_mean(year, before):
        key = (year, before if before.year == year else None)
        if key not in ym_cache:
            h = hist[(hist.year == year) & (hist.d < before)]
            ym_cache[key] = {k: float(h.loc[h[f"stood_{k}"].astype(bool), f"s_{k}"].mean()) if h[f"stood_{k}"].astype(bool).any() else np.nan for k in KEYS}
        return ym_cache[key]

    for i in idx:
        g, dd = df.at[i, "gss"], df.at[i, "d"]
        grp = by_gss.get(g)
        prev = None
        if grp is not None:
            earlier = grp[grp.d < dd]
            if len(earlier):
                prev = earlier.iloc[-1]
        if prev is None:
            for k in KEYS:
                df.at[i, f"prev_rel_{k}"] = np.nan
            df.at[i, "prev_gap_years"] = np.nan
            df.at[i, "has_prev"] = 0
            continue
        ym = year_mean(prev.d.year, dd)
        for k in KEYS:
            df.at[i, f"prev_rel_{k}"] = prev[f"s_{k}"] - ym[k] if prev[f"stood_{k}"] else np.nan
        df.at[i, "prev_gap_years"] = (dd - prev.d).days / 365.25
        df.at[i, "has_prev"] = 1


def build(contests: list[dict], polls, as_of: datetime, anchor_mode: str = "run_date"):
    """The dataset for one run. Rows for contests polling on or after the run date
    are targets; rows dated before it with a result are training rows.

    Returns (df, target indices, skipped {ballot: (reason, contest)}, anchor or None)."""
    run_date = as_of.date().isoformat()
    # This folder's own cache, written by bridge_level_anchor.py (our research output, not untrusted data).
    base = pd.read_pickle(BASE_DATASET)
    base = base[base["set"] != "byelection"].copy()
    universe = {u["gss"]: u for u in pd.read_csv(UNIVERSE, dtype=str, keep_default_na=False).to_dict("records")}

    rows, targets_meta, skipped = [], [], {}
    for d in contests:
        c = d.get("contest") or {}
        pday = c.get("polling_day")
        if not pday or pday <= MAY26:
            continue
        target = pday >= run_date and not is_frozen(pday, as_of)
        if pday >= run_date and not target:
            continue  # polls already open on the run date: never forecast
        if target:
            reason = skip_reason(d, universe)
            if reason:
                skipped[c["ballot_paper_id"]] = (reason, d)
                continue
            r = contest_row(d, universe[c["ward_gss"]], with_result=anchor_mode == "polling_day_check" and _has_result(d))
            r["_target"] = True
            rows.append(r)
            targets_meta.append(d)
        else:
            if c.get("territory") != "ENG" or d.get("status") != "concluded" or not _has_result(d):
                continue
            u = universe.get(c.get("ward_gss"))
            if u is None:
                continue
            r = contest_row(d, u, with_result=True)
            r["_target"] = False
            rows.append(r)

    new = pd.DataFrame(rows)
    df = pd.concat([base, new], ignore_index=True)
    df["_target"] = df["_target"].fillna(False).astype(bool)
    df["is_by"] = df["is_by"].astype(bool)
    df["d"] = pd.to_datetime(df["date"])
    df["region_code"] = df["region"].map({r: i for i, r in enumerate(REGIONS)}).astype(float)
    df["n_standing"] = df[[f"stood_{k}" for k in KEYS]].sum(axis=1)

    # Anchors: rebuilt training by-elections on their own polling day, as prepare.py;
    # targets on the run date (the live rule) or, in the check, on their polling day.
    new_idx = df.index[df["source"].eq("byelection_file") & df["date"].gt(MAY26)]
    cache = {}

    def anchor_on(dstr):
        if dstr not in cache:
            cache[dstr] = prepare.poll_anchor(polls, date.fromisoformat(dstr), carry_forward=True)
        return cache[dstr]

    run_anchor = anchor_on(run_date)
    for i in new_idx:
        a = run_anchor if (df.at[i, "_target"] and anchor_mode == "run_date") else anchor_on(df.at[i, "date"])
        df.at[i, "anchor_kind"] = "polls_14d" if a else None
        for p in LANES:
            df.at[i, f"a_{LANE_KEY[p]}"] = a[p] if a else np.nan

    ward_lags(df, new_idx)
    df = standing_inputs(df)
    tgt = list(df.index[df["_target"]])
    for i in list(tgt):
        if df.at[i, "anchor_kind"] is None or pd.isna(df.at[i, "anchor_kind"]):
            d = next(x for x in targets_meta if x["contest"]["ballot_paper_id"] == df.at[i, "ballot_paper_id"])
            skipped[df.at[i, "ballot_paper_id"]] = ("no_polling_anchor", d)
            tgt.remove(i)
    return df, tgt, skipped, (run_anchor if anchor_mode == "run_date" else None), targets_meta


def _has_result(d: dict) -> bool:
    return bool((d.get("result") or {}).get("shares"))


# ------------------------------------------------------------------- fit ----

def fit_and_predict(df: pd.DataFrame, tgt: list, run_date: str):
    """Fit each lane once on anchored rows dated before the run date where it stood;
    predict the target rows. Returns (offsets {k: array over tgt}, training rows {k: n})."""
    params = {p: pd.read_pickle(FIT_META)["lanes"][p]["best_params"] for p in LANES}
    cols = list(dict.fromkeys(FEATURES))
    X = df[cols].astype(float).to_numpy()
    anch = df["anchor_kind"].notna().to_numpy()
    before = anch & (df["date"] < run_date).to_numpy()
    tgt = np.asarray(tgt, dtype=int)
    off, n_train = {}, {}
    for p in LANES:
        k = LANE_KEY[p]
        stood = df[f"stood_{k}"].to_numpy().astype(bool)
        tr = np.flatnonzero(before & stood)
        n_train[k] = int(len(tr))
        v = np.full(len(tgt), np.nan)
        te = stood[tgt]
        if len(tr) >= MIN_ROWS and te.any():
            y = np.asarray(logit(df[f"s_{k}"].to_numpy()[tr])) - np.asarray(logit(df[f"a_{k}"].to_numpy()[tr]))
            Xt = X[tr].copy()
            Xt[:, np.isnan(Xt).all(axis=0)] = 0.0
            with threadpool_limits(1):
                v[te] = make(params[p], cols).fit(Xt, y).predict(X[tgt[te]])
        off[k] = v
    return off, n_train


def win_chances(base_logit: dict, standing: list[str], spreads: dict, rng) -> dict:
    """Fraction of draws in which each standing lane leads, each lane's logit share
    shifted by an independent normal draw with that lane's spread."""
    m = np.column_stack([base_logit[k] + rng.normal(0.0, spreads[k], DRAWS) for k in standing])
    wins = np.bincount(m.argmax(axis=1), minlength=len(standing)) / DRAWS
    return {LANE_OF_KEY[k]: float(w) for k, w in zip(standing, wins)}


def forecast(contests, polls, as_of: datetime, anchor_mode: str = "run_date"):
    """Run the model as of `as_of`. Returns ({ballot: forecast dict}, {ballot: (reason, contest)}, run facts)."""
    run_date = as_of.date().isoformat()
    df, tgt, skipped, anchor, _ = build(contests, polls, as_of, anchor_mode)
    off, n_train = fit_and_predict(df, tgt, run_date) if tgt else ({k: np.array([]) for k in KEYS}, {})
    spreads = {LANE_KEY[p]: float(v["oof_logit_resid_sd"]) for p, v in pd.read_pickle(FIT_META)["lanes"].items()}
    rng = np.random.default_rng(DRAW_SEED)
    out = {}
    for j, i in enumerate(tgt):
        bid = df.at[i, "ballot_paper_id"]
        standing = [k for k in KEYS if bool(df.at[i, f"stood_{k}"])]
        if any(np.isnan(off[k][j]) for k in standing):
            skipped[bid] = ("standing_lane_without_model", None)
            continue
        base_logit = {k: float(logit(df.at[i, f"a_{k}"])) + float(off[k][j]) for k in standing}
        raw = {k: float(expit(v)) for k, v in base_logit.items()}
        tot = sum(raw.values())
        shares = {LANE_OF_KEY[k]: (raw[k] / tot if k in raw else 0.0) for k in KEYS}
        out[bid] = {
            "row": int(i),
            "shares": shares,
            "called_leader": max(shares, key=shares.get),
            "win_chance": win_chances(base_logit, standing, spreads, rng),
            "anchor": {p: float(df.at[i, f"a_{LANE_KEY[p]}"]) for p in LANES},
            "standing": [LANE_OF_KEY[k] for k in standing],
            "has_prev": int(df.at[i, "has_prev"]),
            "prev_scheduled_date": df.at[i, "prev_sched_date"] if isinstance(df.at[i, "prev_sched_date"], str) else None,
        }
    facts = {"run_date": run_date, "anchor": anchor, "training_rows_by_lane": {LANE_OF_KEY[k]: n for k, n in n_train.items()},
             "training_contests": int((df["anchor_kind"].notna() & (df["date"] < run_date)).sum()),
             "rebuilt_byelections_in_training": int((df["source"].eq("byelection_file") & ~df["_target"] & (df["date"] < run_date)).sum())}
    return out, skipped, facts


# ------------------------------------------------------------------ main ----

def r4(x):
    return None if x is None else round(float(x), 4)


def code_state() -> tuple[str, bool]:
    commit = git("rev-parse", "HEAD")
    dirty = git("status", "--porcelain", "--", str(HERE.relative_to(REPO)), f":(exclude){LIVE_DIR.relative_to(REPO)}")
    return commit, bool(dirty)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--ref", default="origin/main", help="git ref holding the contest files (default origin/main)")
    ap.add_argument("--polls", default=None, help="a data/polling/timeseries.json to use instead of the one at --ref")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--allow-dirty", action="store_true", help="run with uncommitted code changes (records them as dirty)")
    args = ap.parse_args(argv)

    now = datetime.now(timezone.utc).replace(microsecond=0)
    captured_at = now.isoformat().replace("+00:00", "Z")
    commit, dirty = code_state()
    if dirty and not args.allow_dirty and not args.dry_run:
        sys.exit("Uncommitted changes in research/ward-model-2026-11 (outside live/). Commit them first so the record names the code that ran.")

    contests, contest_commit = load_contests(args.ref)
    ts = polls_file(args.ref, args.polls)
    polls = load_polls(ts)
    preds, skipped, facts = forecast(contests, polls, now)
    by_ballot_contest = {d["contest"]["ballot_paper_id"]: d for d in contests if d.get("contest")}

    inputs = {
        "contest_files": {"git_ref": args.ref, "commit": contest_commit},
        "polls": polls_provenance(ts),
        "ward_features": {"file": "research/ward-model-2026-11/cache/drive07/universe_features_v2.csv", "sha256": sha256(UNIVERSE)},
        "base_dataset": {"file": "research/ward-model-2026-11/cache/bridge_level_dataset.pkl", "sha256": sha256(BASE_DATASET)},
        "fit_meta": {"file": "research/ward-model-2026-11/cache/fit_meta.pkl", "sha256": sha256(FIT_META)},
    }

    def common_fields(d):
        c = d["contest"]
        return {
            "ballot_paper_id": c["ballot_paper_id"], "contest": d["slug"], "polling_day": c["polling_day"],
            "polls_open_at": polls_open_at(c["polling_day"]).isoformat().replace("+00:00", "Z"),
            "council": c.get("council_name"), "ward": c.get("ward_name"),
            "captured_at": captured_at, "forecaster": FORECASTER, "model_version": MODEL_VERSION,
            "code_commit": commit, "code_dirty": dirty, "contest_file": d["_file"],
            "contest_file_generated_at": d.get("generated_at"),
        }

    new = {}
    for bid, p in preds.items():
        d = by_ballot_contest[bid]
        new[bid] = {
            **common_fields(d), "status": "forecast",
            "shares": {k: r4(v) for k, v in p["shares"].items()},
            "called_leader": p["called_leader"],
            "win_chance": {k: r4(v) for k, v in p["win_chance"].items()},
            "standing_lanes": p["standing"],
            "candidates": [{"party": c.get("party"), "lane": pool_party(c.get("party") or "")} for c in d["field"]["candidates"]],
            "anchor": {k: r4(v) for k, v in p["anchor"].items()},
            "ward_has_earlier_contest": bool(p["has_prev"]),
            "inputs": inputs,
            "reason": None,
        }
    for bid, (reason, d) in skipped.items():
        d = d or by_ballot_contest[bid]
        new[bid] = {**common_fields(d), "status": "skipped", "shares": None, "called_leader": None, "win_chance": None,
                    "reason": reason, "reason_text": REASON_TEXT[reason], "inputs": inputs}

    doc = json.loads(LIVE_FILE.read_text(encoding="utf-8")) if LIVE_FILE.exists() else {"records": {}}
    records = merge_records(doc.get("records", {}), new, now)
    out = {
        "about": ("Research only. The ward model's forecasts for upcoming council by-elections, written before polls open "
                  "and frozen once they do (07:00 UK time on polling day). Specification: research/ward-model-2026-11/LIVE_SPEC.md. "
                  "Shares are full slate shares over six lanes; parties outside the five main lanes are pooled as Others. "
                  "Win chances come from fixed lane spreads and are not calibrated."),
        "forecaster": FORECASTER,
        "model_version": MODEL_VERSION,
        "last_run": {"captured_at": captured_at, "code_commit": commit, "code_dirty": dirty, **facts,
                     "anchor": {k: r4(v) for k, v in (facts["anchor"] or {}).items()} or None,
                     "forecast": sorted(preds), "skipped": {b: r for b, (r, _) in sorted(skipped.items())}, "inputs": inputs},
        "records": dict(sorted(records.items(), key=lambda kv: (kv[1]["polling_day"], kv[0]))),
    }
    print(f"run {captured_at}: {len(preds)} forecast, {len(skipped)} skipped; anchor on {facts['run_date']}: "
          + (", ".join(f"{k} {v:.3f}" for k, v in facts["anchor"].items()) if facts["anchor"] else "none"))
    for bid in sorted(new, key=lambda b: (new[b]["polling_day"], b)):
        r = new[bid]
        if r["status"] == "forecast":
            top = sorted(r["shares"].items(), key=lambda kv: -kv[1])[:3]
            print(f"  {r['polling_day']} {bid}: {r['called_leader']} ({r['win_chance'][r['called_leader']]:.0%}); "
                  + ", ".join(f"{k} {v:.1%}" for k, v in top))
        else:
            print(f"  {r['polling_day']} {bid}: skipped, {r['reason']}")
    if args.dry_run:
        return out
    LIVE_DIR.mkdir(exist_ok=True)
    LIVE_FILE.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {LIVE_FILE.relative_to(REPO)}")
    return out


if __name__ == "__main__":
    main()
