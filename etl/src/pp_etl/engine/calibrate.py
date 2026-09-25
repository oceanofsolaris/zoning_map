"""Calibration of existing_to_agf (spec §7.3).

Buildings completed under the current rules should use roughly their allowed
floor area. We take parcels whose main building was built in or after
`min_year`, lie in a single AZ-bound residential zone, and fit the factor so
that their median utilisation hits the target. The value is always reported.
"""

from __future__ import annotations

import statistics
from typing import Any

from . import capacity


def calibrate_existing_to_agf(parcels, inputs: list[dict[str, Any]], rules: dict[str, Any],
                              ecfg: dict[str, Any], ccfg: dict[str, Any]) -> dict[str, Any]:
    cfg1 = {**ecfg, "existing_to_agf": 1.0}
    samples = []
    for row, inp in zip(parcels.itertuples(), inputs):
        if row.year_built is None or row.year_built != row.year_built or row.year_built < ccfg["min_year"]:
            continue
        if len(inp["parts"]) != 1 or inp["existing"]["n_buildings"] == 0:
            continue
        res = capacity.compute_parcel(inp, rules, cfg1)
        if res["binding_constraint"] != "az" or not res["gf_allowed_m2"]:
            continue
        samples.append({"egrid": row.egrid, "year_built": int(row.year_built), "zone": inp["parts"][0]["zone"],
                        "raw_utilisation": round(res["utilisation"], 3)})
    out: dict[str, Any] = {"n_samples": len(samples), "min_year": ccfg["min_year"],
                           "target_median_utilisation": ccfg["target_median_utilisation"], "samples": samples}
    if len(samples) < ccfg["min_samples"]:
        out["factor"] = None
        out["note"] = f"Too few samples (< {ccfg['min_samples']}); existing_to_agf left at default {ecfg['existing_to_agf']}."
        return out
    med = statistics.median(s["raw_utilisation"] for s in samples)
    factor = ccfg["target_median_utilisation"] / med
    out.update({"raw_median_utilisation": round(med, 3), "factor": round(factor, 3)})
    for s in samples:
        s["calibrated_utilisation"] = round(s["raw_utilisation"] * factor, 3)
    return out
