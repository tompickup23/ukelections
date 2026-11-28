"""Shared paths and helpers for the November 2026 ward model research.

Research only. Nothing here is read by the site, the engine or the published
forecast.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
CACHE = HERE / "cache"
DRIVE = CACHE / "drive07"
ARMS = CACHE / "arms"
OUT = HERE / "results"

MATRIX = DRIVE / "ward_contests_v2.csv"
UNIVERSE = DRIVE / "universe_features_v2.csv"

DC_HISTORY = REPO / "data/history/dc-historic-results.json"
MAY26_ACTUALS = REPO / "data/results/may-2026/local-and-mayor.merged.json"
POSTAUDIT = REPO / "data/transparency/may-2026-postaudit-2026-05-10.json"
POLLS_2025 = REPO / "data/polling/wikipedia/westminster-2025-04-15-to-2026-04-25.json"
POLLS_TS = REPO / "data/polling/timeseries.json"
BYELECTION_DIR = REPO / "data/contests/local-byelections"
BYELECTION_APPENDS = REPO / "data/history/byelection-appends.json"

# The five parties the site's yardstick keeps; everything else pools as Others.
MAJOR = ["Reform UK", "Labour", "Conservative", "Liberal Democrats", "Green Party"]
LANES = MAJOR + ["Others"]
LANE_KEY = {
    "Reform UK": "ref",
    "Labour": "lab",
    "Conservative": "con",
    "Liberal Democrats": "ld",
    "Green Party": "grn",
    "Others": "oth",
}

TRAIN_CUTOFF = "2026-05-07"  # train strictly before May 2026 polling day
MAY26 = "2026-05-07"

# Fixed before any scoring was run (see README, "Blend"). Not tuned.
BLEND_WEIGHT_MODEL = 0.5

SHARE_FLOOR = 0.003


def pool_party(label: str) -> str:
    """Yardstick pooling of a canonical party label (scripts/score-may-2026-like-for-like.mjs)."""
    return label if label in MAJOR else "Others"


def dc_lane(cand: dict) -> str:
    """Lane for a Democracy Club candidate record, by Electoral Commission id first."""
    ec = str(cand.get("party_ec_id") or "")
    name = str(cand.get("party_name") or "")
    if ec == "PP52" or name == "Conservative and Unionist Party":
        return "Conservative"
    if ec == "PP53" or ec.startswith("joint-party:53-") or name in ("Labour Party", "Labour and Co-operative Party"):
        return "Labour"
    if ec == "PP90" or name == "Liberal Democrats":
        return "Liberal Democrats"
    if ec == "PP63" or name == "Green Party":
        return "Green Party"
    if ec == "PP7931" or ec.startswith("joint-party:7931-") or name == "Reform UK":
        return "Reform UK"
    return "Others"


def slate_shares(cands: list[dict], lane_of) -> tuple[dict, dict] | None:
    """Full-slate shares: every candidate's votes summed by lane, over all votes cast for candidates."""
    votes = {p: 0.0 for p in LANES}
    stood = {p: False for p in LANES}
    for c in cands:
        v = c.get("votes")
        if v is None:
            return None
        p = lane_of(c)
        votes[p] += float(v)
        stood[p] = True
    tot = sum(votes.values())
    if tot <= 0:
        return None
    return {p: votes[p] / tot for p in LANES}, stood


def logit(x):
    x = np.clip(np.asarray(x, dtype=float), SHARE_FLOOR, 1 - SHARE_FLOOR)
    return np.log(x / (1 - x))


def expit(x):
    return 1.0 / (1.0 + np.exp(-np.asarray(x, dtype=float)))


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_json(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)
