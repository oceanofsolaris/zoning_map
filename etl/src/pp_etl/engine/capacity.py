"""Capacity engine: the arithmetic of spec §7.2–7.4 and §7.6.

This module is mirrored line by line in web/src/engine/capacity.ts. Both must
pass tests/golden/*.json. Keep it small, pure and dict-based: no geometry, no
I/O, no numpy. Geometry facts (zone-part areas, buildable footprints per
setback) are precomputed by the pipeline and passed in.

Shapes (plain dicts, JSON-compatible):

rules[code] = {
  code, residential, discretionary, az_max, uez_max, vg_max, attika_allowed,
  attika_factor, gh_max_m, ga_klein_m, ga_gross_m, az_counts_attika,
  bonuses: [{id, az_delta, vg_delta}], confidence_cap
}
parcel = {
  area_m2, flags: [...],
  parts: [{zone, area_m2, agsf_m2, fp: [buildable m² at cfg.setback_steps_m]}],
  existing: {gf_m2, gf_fixed_m2?, storeys_max, height_max_m, n_buildings}
}
existing.gf_m2 is footprint × storeys (scaled by cfg.existing_to_agf); gf_fixed_m2 is
already an aGF estimate (e.g. from GWR dwelling areas or an approved project) and is
added unscaled.
scenario = {zones: {<code>|"*": {d_az, d_vg}}, bonuses: {<id>: bool}}
"""

from __future__ import annotations

import math
from typing import Any

CONF_ORDER = ["low", "medium", "high"]
CAP_MEDIUM_FLAGS = ["multi_zone", "missing_height", "slope", "discretionary"]
CAP_LOW_FLAGS = ["gestaltungsplan", "hochhausstandort", "sdr_overlap", "rulebook_unverified"]


def interp(xs: list[float], ys: list[float], x: float) -> float:
    """Piecewise-linear interpolation, clamped at both ends."""
    if x <= xs[0]:
        return ys[0]
    for i in range(1, len(xs)):
        if x <= xs[i]:
            t = (x - xs[i - 1]) / (xs[i] - xs[i - 1])
            return ys[i - 1] + t * (ys[i] - ys[i - 1])
    return ys[-1]


def apply_scenario(rules: dict[str, Any], scenario: dict[str, Any] | None, cfg: dict[str, Any]) -> dict[str, Any]:
    """Return a new rules dict with scenario deltas and switched-on bonuses applied."""
    if not scenario:
        return rules
    zones = scenario.get("zones") or {}
    bonuses_on = scenario.get("bonuses") or {}
    out = {}
    for code, r in rules.items():
        r = dict(r)
        if r["residential"] and not r["discretionary"]:
            d_az = 0.0
            d_vg = 0
            for key in ("*", code):
                z = zones.get(key)
                if z:
                    d_az += z.get("d_az") or 0.0
                    d_vg += z.get("d_vg") or 0
            # Bonus switches are global ("<id>") or scoped to a planning perimeter ("<perimeter>/<id>").
            prefix = code.rsplit("/", 1)[0] + "/" if "/" in code else ""
            for b in r.get("bonuses") or []:
                if bonuses_on.get(b["id"]) or (prefix and bonuses_on.get(prefix + b["id"])):
                    d_az += b.get("az_delta") or 0.0
                    d_vg += b.get("vg_delta") or 0
            if r["az_max"] is not None and d_az:
                r["az_max"] = max(0.0, r["az_max"] + d_az)
            if r["vg_max"] is not None and d_vg:
                # Extra storeys are an option, not an obligation: remember the zone's own count.
                r["vg_min"] = r["vg_max"]
                r["vg_max"] = max(0, r["vg_max"] + d_vg)
                if r["gh_max_m"] is not None and cfg["scenario_storey_raises_height"]:
                    r["gh_max_m"] = r["gh_max_m"] + d_vg * cfg["storey_height_m"]
        out[code] = r
    return out


def storeys(r: dict[str, Any], cfg: dict[str, Any]) -> tuple[float | None, float]:
    """(full storeys, attic storey fraction) allowed by the rules."""
    vg = r["vg_max"]
    if vg is None and r["gh_max_m"] is not None:
        return float(math.floor(r["gh_max_m"] / cfg["storey_height_m"])), 0.0
    if vg is None:
        return None, 0.0
    attic = 0.0
    if r["attika_allowed"]:
        attic = r["attika_factor"] if r["attika_factor"] is not None else cfg["attika_factor"]
    return float(vg), attic


def setback_for(r: dict[str, Any], mode: str, cfg: dict[str, Any]) -> float:
    klein = r["ga_klein_m"] if r["ga_klein_m"] is not None else cfg["default_grenzabstand_m"]
    if mode == "conservative" and r["ga_gross_m"] is not None:
        return r["ga_gross_m"]
    return klein


def compute_part(part: dict[str, Any], r: dict[str, Any] | None, cfg: dict[str, Any], mode: str) -> dict[str, Any]:
    """Allowed floor area for one zone part of a parcel (§7.2)."""
    if r is None:
        return {"kind": "non_building", "gf": None, "binding": "none", "env_height": None}
    if not r["residential"]:
        return {"kind": "non_residential", "gf": None, "binding": "non_residential", "env_height": None}
    vg, attic = storeys(r, cfg)
    if r["discretionary"] or vg is None:
        return {"kind": "discretionary", "gf": None, "binding": "discretionary", "env_height": None}

    fp = interp(cfg["setback_steps_m"], part["fp"], setback_for(r, mode, cfg))
    if r["uez_max"] is not None:
        fp = min(fp, r["uez_max"] * part["agsf_m2"])
    k = cfg["envelope_to_agf"]

    env_height = (vg + attic) * cfg["storey_height_m"]
    if r["gh_max_m"] is not None:
        env_height = min(env_height, r["gh_max_m"])

    if r["az_max"] is None:
        return {"kind": "residential", "gf": fp * (vg + attic) * k, "binding": "envelope", "env_height": env_height}

    gf_az = r["az_max"] * part["agsf_m2"]
    if r["az_counts_attika"]:
        gf_env = fp * (vg + attic) * k
        gf = min(gf_az, gf_env)
        binding = "az" if gf_az <= gf_env else "envelope"
    else:
        # AZ counts full storeys only (e.g. BNO Brugg § 74). The attic adds floor area in
        # proportion to the footprint actually built, so with the AZ binding, more storeys mean
        # a smaller footprint and a smaller attic. A builder chooses the storey count between the
        # zone's own count and the (scenario) maximum that yields the most floor area.
        gf, binding = 0.0, "envelope"
        n_min = r.get("vg_min") if r.get("vg_min") is not None else vg
        for n in range(int(n_min), int(vg) + 1):
            if n <= 0:
                continue
            gf_env_n = fp * n * k
            gf_n = min(gf_az, gf_env_n) * (1.0 + attic / n)
            if gf_n > gf:
                gf, binding = gf_n, ("az" if gf_az <= gf_env_n else "envelope")
    return {"kind": "residential", "gf": gf, "binding": binding, "env_height": env_height}


def _cap(conf: str, cap: str) -> str:
    return conf if CONF_ORDER.index(conf) <= CONF_ORDER.index(cap) else cap


def compute_parcel(parcel: dict[str, Any], rules: dict[str, Any], cfg: dict[str, Any],
                   scenario: dict[str, Any] | None = None) -> dict[str, Any]:
    """Allowed floor area, existing use, headroom, 'allowed today?' and confidence for one parcel."""
    rules = apply_scenario(rules, scenario, cfg)
    parts = parcel["parts"]
    # Road, rail and water parcels carry no building capacity whatever their zone.
    infra = "infrastructure" in (parcel.get("flags") or [])
    res_opt = [compute_part(p, None if infra else rules.get(p["zone"]), cfg, "optimistic") for p in parts]
    res_con = [compute_part(p, None if infra else rules.get(p["zone"]), cfg, "conservative") for p in parts]
    headline = res_opt if cfg["setback_mode"] == "optimistic" else res_con

    def total(res):
        # A discretionary part makes the parcel total unknown (not partial).
        if any(r["kind"] == "discretionary" for r in res):
            return None
        vals = [r["gf"] for r in res if r["gf"] is not None]
        return sum(vals) if vals else None

    gf_allowed = total(headline)
    gf_opt, gf_con = total(res_opt), total(res_con)

    # Dominant part: the largest by area. Its rules drive binding and 'allowed today?'.
    dom = 0
    for i in range(1, len(parts)):
        if parts[i]["area_m2"] > parts[dom]["area_m2"]:
            dom = i
    binding = headline[dom]["binding"] if parts else "none"
    env_height = headline[dom]["env_height"] if parts else None
    dom_rules = rules.get(parts[dom]["zone"]) if parts and not infra else None

    ex = parcel["existing"]
    # existing_to_agf is calibrated per territory; parcels may carry their own value
    k_ex = ex.get("existing_to_agf") if ex.get("existing_to_agf") is not None else cfg["existing_to_agf"]
    agf_existing = ex["gf_m2"] * k_ex + (ex.get("gf_fixed_m2") or 0.0)
    utilisation = agf_existing / gf_allowed if gf_allowed else None
    headroom = max(0.0, gf_allowed - agf_existing) if gf_allowed is not None else None
    units = math.floor(headroom / cfg["gf_per_dwelling_m2"] + 1e-9) if headroom is not None else None
    residents = headroom / cfg["gf_per_resident_m2"] if headroom is not None else None

    exceedances: list[str] = []
    allowed_today = None
    if ex["n_buildings"] > 0 and dom_rules is not None and headline[dom]["kind"] == "residential":
        if gf_allowed is not None and agf_existing > gf_allowed * (1 + cfg["tol_gf"]):
            exceedances.append("gf")
        if dom_rules["vg_max"] is not None and ex["storeys_max"] is not None:
            if ex["storeys_max"] > dom_rules["vg_max"] + (1 if dom_rules["attika_allowed"] else 0):
                exceedances.append("storeys")
        # Heights are measured from the relevant terrain, which the prototype ignores; on slopes
        # the measured height is unreliable, so no height exceedance is claimed there.
        slope = "slope" in (parcel.get("flags") or [])
        if dom_rules["gh_max_m"] is not None and ex["height_max_m"] is not None and not slope:
            if ex["height_max_m"] > dom_rules["gh_max_m"] + cfg["tol_height_m"]:
                exceedances.append("height")
        allowed_today = len(exceedances) == 0

    flags = list(parcel.get("flags") or [])
    if any(r["kind"] == "discretionary" for r in headline) and "discretionary" not in flags:
        flags.append("discretionary")
    conf = "high"
    for f in flags:
        if f in CAP_MEDIUM_FLAGS:
            conf = _cap(conf, "medium")
        if f in CAP_LOW_FLAGS:
            conf = _cap(conf, "low")
    if gf_opt and gf_con is not None and (gf_opt - gf_con) / gf_opt > cfg["setback_range_medium_threshold"]:
        conf = _cap(conf, "medium")
    if parcel["area_m2"] < cfg["small_parcel_m2"]:
        conf = _cap(conf, "low")
    for p in parts:
        r = rules.get(p["zone"])
        if r is not None and r.get("confidence_cap"):
            conf = _cap(conf, r["confidence_cap"])

    return {
        "gf_allowed_m2": gf_allowed,
        "gf_allowed_opt_m2": gf_opt,
        "gf_allowed_con_m2": gf_con,
        "binding_constraint": binding,
        "envelope_height_m": env_height,
        "agf_existing_m2": agf_existing,
        "utilisation": utilisation,
        "headroom_gf_m2": headroom,
        "headroom_units": units,
        "headroom_residents": residents,
        "allowed_today": allowed_today,
        "exceedances": exceedances,
        "confidence": conf,
        "flags": flags,
        "parts": [{"zone": p["zone"], "gf": r["gf"], "binding": r["binding"], "env_height": r["env_height"]}
                  for p, r in zip(parts, headline)],
    }


def summarise(parcels: list[dict[str, Any]], results: list[dict[str, Any]]) -> dict[str, Any]:
    """Municipality totals over parcels with a defined allowed floor area."""
    tot = {"gf_allowed_m2": 0.0, "agf_existing_m2": 0.0, "headroom_gf_m2": 0.0, "headroom_units": 0,
           "headroom_residents": 0.0, "n_parcels": 0}
    for res in results:
        if res["gf_allowed_m2"] is None:
            continue
        tot["n_parcels"] += 1
        tot["gf_allowed_m2"] += res["gf_allowed_m2"]
        tot["agf_existing_m2"] += res["agf_existing_m2"]
        tot["headroom_gf_m2"] += res["headroom_gf_m2"]
        tot["headroom_units"] += res["headroom_units"]
        tot["headroom_residents"] += res["headroom_residents"]
    return tot


def compute_all(parcels: list[dict[str, Any]], rules: dict[str, Any], cfg: dict[str, Any],
                scenario: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    return [compute_parcel(p, rules, cfg, scenario) for p in parcels]


def blocker_ranking(parcels: list[dict[str, Any]], rules: dict[str, Any], cfg: dict[str, Any],
                    levers: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Δ headroom for each single lever applied to each residential zone and to all zones (§7.4)."""
    levers = levers or [
        {"id": "az+0.1", "label_de": "AZ +0.1", "delta": {"d_az": 0.1}},
        {"id": "vg+1", "label_de": "+1 Vollgeschoss", "delta": {"d_vg": 1}},
    ]
    base = summarise(parcels, compute_all(parcels, rules, cfg))
    targets = [c for c, r in rules.items() if r["residential"] and not r["discretionary"]] + ["*"]
    out = []
    for lever in levers:
        for t in targets:
            s = summarise(parcels, compute_all(parcels, rules, cfg, {"zones": {t: lever["delta"]}}))
            out.append({
                "lever": lever["id"], "label_de": lever["label_de"], "zone": t,
                "d_headroom_gf_m2": s["headroom_gf_m2"] - base["headroom_gf_m2"],
                "d_headroom_units": s["headroom_units"] - base["headroom_units"],
                "d_gf_allowed_m2": s["gf_allowed_m2"] - base["gf_allowed_m2"],
            })
    out.sort(key=lambda x: -x["d_headroom_gf_m2"])
    return out
