"""Rulebook loading, validation and flattening into engine rules."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import jsonschema
import yaml

from ..paths import RULEBOOK_DIR

SCHEMA_PATH = Path(__file__).with_name("rulebook.schema.json")

# Engine field <- rulebook param name (spec §6.1 names, German domain terms kept).
PARAM_MAP = {
    "az_max": "az_max",
    "uez_max": "ueberbauungsziffer_max",
    "vg_max": "vollgeschosse_max",
    "attika_allowed": "attika_or_dg_allowed",
    "attika_factor": "attika_factor",
    "gh_max_m": "gesamthoehe_max_m",
    "ga_klein_m": "grenzabstand_klein_m",
    "ga_gross_m": "grenzabstand_gross_m",
}


def load_rulebook(ref: str | Path) -> dict[str, Any]:
    p = Path(ref)
    if not p.exists():
        p = RULEBOOK_DIR / ref
    rb = yaml.safe_load(p.read_text())
    rb["_path"] = str(p)
    return rb


def validate(rb: dict[str, Any]) -> None:
    schema = json.loads(SCHEMA_PATH.read_text())
    jsonschema.validate({k: v for k, v in rb.items() if not k.startswith("_")}, schema)
    codes = [z["code"] for z in rb["zones"]]
    dupes = {c for c in codes if codes.count(c) > 1}
    if dupes:
        raise ValueError(f"Duplicate zone codes: {dupes}")
    matched = [m for z in rb["zones"] for m in z["match"][rb["zone_match_field"]]]
    dupes = {m for m in matched if matched.count(m) > 1}
    if dupes:
        raise ValueError(f"Dataset codes mapped to several zones: {dupes}")


def _val(params: dict[str, Any], name: str) -> Any:
    v = params.get(name)
    return v.get("value") if isinstance(v, dict) else None


def iter_values(rb: dict[str, Any]):
    """Yield (path, value_obj) for every provenance-carrying value (for verification stats and the CLI)."""
    for k, v in (rb.get("definitions") or {}).items():
        yield f"definitions.{k}", v
    for z in rb["zones"]:
        for k, v in (z.get("params") or {}).items():
            if isinstance(v, dict) and "source" in v:
                yield f"zones.{z['code']}.params.{k}", v
        if z.get("basis"):
            yield f"zones.{z['code']}.basis", z["basis"]
        for b in z.get("bonuses") or []:
            yield f"zones.{z['code']}.bonuses.{b['id']}", b


def verification_status(rb: dict[str, Any]) -> dict[str, int]:
    vals = list(iter_values(rb))
    return {"total": len(vals), "verified": sum(1 for _, v in vals if v.get("verified"))}


def engine_rules(rb: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Flatten a rulebook into {zone code: rules} for the capacity engine."""
    az_counts_attika = (rb.get("definitions") or {}).get("az_counts_attika_dg", {}).get("value", True)
    out = {}
    for z in rb["zones"]:
        params = z.get("params") or {}
        r = {"code": z["code"], "residential": bool(z["residential"]), "discretionary": bool(z["discretionary"])}
        for eng, name in PARAM_MAP.items():
            r[eng] = _val(params, name)
        r["attika_allowed"] = bool(r["attika_allowed"])
        r["az_counts_attika"] = az_counts_attika
        r["bonuses"] = [{"id": b["id"], "az_delta": b.get("az_delta", 0.0), "vg_delta": b.get("vg_delta", 0)}
                        for b in z.get("bonuses") or []]
        cap = z.get("confidence_cap")
        r["confidence_cap"] = cap["value"] if cap else None
        out[z["code"]] = r
    return out


def zone_lookup(rb: dict[str, Any]) -> dict[str, str]:
    """Dataset code (e.g. typ_kommunal_code) -> rulebook zone code."""
    field = rb["zone_match_field"]
    return {m: z["code"] for z in rb["zones"] for m in z["match"][field]}
