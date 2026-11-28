"""Reform UK groups of the 3,696 verified 2027 wards (PR 220's three groups), from the
2027 dry run's own built frame on the base and on the extended dataset. Builds the
frame only: no fit, no forecast (HISTORY_SPEC.md says the dry run is not rerun when
(a) fails, and (a) failed). Output: results/history_groups.json. Research only.
"""
from __future__ import annotations

import json
from collections import Counter

import v2027_forecast as vf
from common import CACHE, OUT, read_json
from history_v2027 import NEW_BASE, OLD_BASE, reform_groups


def main():
    out = {}
    ids = {}
    for name, path in (("base", OLD_BASE), ("extended", NEW_BASE)):
        g, _, by_id = reform_groups(vf, path)
        out[name] = g
        ids[name] = by_id
    verified = [w for w in read_json(vf.WARDS)["wards"] if w["block"] == "verified"]
    out["moves"] = dict(Counter(f"{ids['base'].get(w['id'], 'no_previous')} -> {ids['extended'].get(w['id'], 'no_previous')}" for w in verified))
    out["verified_wards"] = len(verified)
    out["pr220_projection"] = {"previous_with_reform_uk": 1279, "previous_without_reform_uk": 1955, "no_baseline": 462,
                               "source": "SPREAD_RESULTS.md, branch claude/research-reform-spread-1f459d"}
    (OUT / "history_groups.json").write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
