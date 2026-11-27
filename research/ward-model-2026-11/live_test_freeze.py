"""The freeze rule of LIVE_SPEC.md: a record is never changed or created once
polls open at 07:00 UK time on polling day. Run: uv run python -m pytest live_test_freeze.py
(or uv run python live_test_freeze.py)."""
from datetime import datetime, timezone

from live_forecast import FrozenRecordError, merge_records, polls_open_at


def rec(day, leader, captured="2026-12-01T10:00:00Z"):
    return {"polling_day": day, "called_leader": leader, "captured_at": captured}


def raises(fn):
    try:
        fn()
    except FrozenRecordError:
        return True
    return False


def test_polls_open_at_uk_time():
    assert polls_open_at("2026-12-03").isoformat() == "2026-12-03T07:00:00+00:00"   # GMT
    assert polls_open_at("2027-05-06").isoformat() == "2027-05-06T06:00:00+00:00"   # BST


def test_replaces_before_polls_open():
    old = {"b": rec("2026-12-03", "Labour")}
    now = datetime(2026, 12, 3, 6, 59, 59, tzinfo=timezone.utc)
    out = merge_records(old, {"b": rec("2026-12-03", "Reform UK", "2026-12-03T06:59:59Z")}, now)
    assert out["b"]["called_leader"] == "Reform UK"


def test_refuses_change_after_polls_open():
    old = {"b": rec("2026-12-03", "Labour")}
    now = datetime(2026, 12, 3, 7, 0, 0, tzinfo=timezone.utc)
    assert raises(lambda: merge_records(old, {"b": rec("2026-12-03", "Reform UK")}, now))


def test_refuses_new_record_after_polls_open():
    now = datetime(2026, 12, 4, tzinfo=timezone.utc)
    assert raises(lambda: merge_records({}, {"b": rec("2026-12-03", "Labour")}, now))


def test_identical_rewrite_after_open_is_a_no_op_and_others_kept():
    old = {"b": rec("2026-12-03", "Labour"), "c": rec("2026-12-10", "Green Party")}
    now = datetime(2026, 12, 4, tzinfo=timezone.utc)
    out = merge_records(old, {"b": dict(old["b"]), "c": rec("2026-12-10", "Labour", "2026-12-04T00:00:00Z")}, now)
    assert out["b"] == old["b"] and out["c"]["called_leader"] == "Labour"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
