"""Golden vectors shared with the TypeScript engine (tests/golden/*.json)."""

import json

import pytest

from pp_etl.engine.capacity import compute_parcel
from pp_etl.paths import GOLDEN_DIR

BASE = json.loads((GOLDEN_DIR / "_base.json").read_text())
CASES = sorted(p for p in GOLDEN_DIR.glob("*.json") if not p.name.startswith("_"))
TOL = 0.1  # m² (spec §7); ratios are compared to 1e-4


@pytest.mark.parametrize("path", CASES, ids=[p.stem for p in CASES])
def test_golden(path):
    case = json.loads(path.read_text())
    cfg = {**BASE["cfg"], **case.get("cfg", {})}
    rules = {**BASE["rules"], **case.get("rules", {})}
    got = compute_parcel(case["parcel"], rules, cfg, case.get("scenario"))
    for key, want in case["expected"].items():
        have = got[key]
        if isinstance(want, float) or (isinstance(want, int) and not isinstance(want, bool) and key.endswith("_m2")):
            tol = 1e-4 if key in ("utilisation", "headroom_residents") else TOL
            assert have is not None and abs(have - want) <= tol, f"{key}: {have} != {want}"
        else:
            assert have == want, f"{key}: {have!r} != {want!r}"


def test_at_least_15_cases():
    assert len(CASES) >= 15
