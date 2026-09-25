"""Exports: canonical GeoParquet (data/processed) and prototype web data (web/public/data).

Web layout per territory (web/public/data/<canton>/<bfs>/):
  territory.json   meta, engine rules + config, rulebooks (with provenance), QA, totals
  parcels.geojson  parcel geometry (id, egrid) – styled via feature-state from the TS engine
  parcels.json     per-parcel attributes and engine facts (parts with footprint-by-setback)
  buildings.geojson footprints with height for 3D extrusion
  envelopes.geojson buildable polygon per zone part (ghost envelope; height set at runtime)
  zones.geojson    base zoning with rulebook zone keys
  overlays.geojson flagged overlay areas (Gestaltungsplan, Hochhausstandort, ...)
  perimeters.geojson planning perimeters and coverage
And web/public/data/index.json lists all territories.

v1 will replace the GeoJSON files by PMTiles + GeoParquet; the TS side reads
through web/src/data/source.ts so only that module changes.
"""

from __future__ import annotations

import datetime as dt
import json
import math
from pathlib import Path
from typing import Any

import geopandas as gpd
import numpy as np
import pandas as pd
import pyogrio
from pyproj import Transformer

from ..paths import WEB_DATA_DIR
from ..rules.models import load_rulebook

GEOJSON_OPTS = {"COORDINATE_PRECISION": 6, "RFC7946": "YES", "WRITE_BBOX": "NO"}

ATTRIBUTION = [
    {"id": "agis", "text": "Kanton Aargau (AGIS, Amtliche Vermessung, Nutzungsplanung) via geodienste.ch", "licence": "Freie Nutzung, Quellenangabe ist Pflicht"},
    {"id": "swisstopo", "text": "swisstopo (swissBOUNDARIES3D, swissBUILDINGS3D 3.0, Basiskarte)", "licence": "OGD, Quellenangabe"},
    {"id": "bfs", "text": "Bundesamt für Statistik (GWR)", "licence": "OGD, Quellenangabe"},
    {"id": "brugg", "text": "Stadt Brugg (Bau- und Nutzungsordnung)", "licence": "öffentlich"},
]


def _clean_json(o: Any) -> Any:
    if isinstance(o, dict):
        return {k: _clean_json(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean_json(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating, float)):
        f = float(o)
        return None if math.isnan(f) or math.isinf(f) else round(f, 4)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if o is pd.NA or o is pd.NaT:
        return None
    return o


def _write_geojson(gdf: gpd.GeoDataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()
    gdf = gdf[~gdf.geometry.isna()]
    gdf = gdf[~gdf.geometry.is_empty].to_crs(4326)
    pyogrio.write_dataframe(gdf, path, driver="GeoJSON", layer_options=GEOJSON_OPTS)


def _none(v):
    return None if v is None or (isinstance(v, float) and math.isnan(v)) or v is pd.NA else v


def write_all(b, inputs: list[dict[str, Any]], results: list[dict[str, Any]], outdir: Path) -> None:
    t = b.territory
    web = WEB_DATA_DIR / t.canton / str(t.bfs)
    web.mkdir(parents=True, exist_ok=True)
    par = b.parcels

    # ---------- canonical GeoParquet (EPSG:4326 geometry, spec §6.2)
    res = pd.DataFrame(results)
    flat = par.drop(columns=["flags"]).copy()
    for col in ["gf_allowed_m2", "gf_allowed_opt_m2", "gf_allowed_con_m2", "binding_constraint", "envelope_height_m",
                "utilisation", "headroom_gf_m2", "headroom_units", "headroom_residents", "allowed_today", "confidence"]:
        flat[col] = res[col].values
    flat["exceedances"] = [json.dumps(x) for x in res["exceedances"]]
    flat["flags"] = [json.dumps(x) for x in res["flags"]]
    flat["zones"] = [json.dumps([{"zone": p["zone"], "area_m2": p["area_m2"]} for p in i["parts"]]) for i in inputs]
    flat["projects"] = [json.dumps(x) for x in flat["projects"]]
    flat["constraints"] = [json.dumps(_clean_json(x)) for x in flat["constraints"]]
    for c in ["egids", "addresses"]:
        flat[c] = [json.dumps(_clean_json(x)) if isinstance(x, list) else "[]" for x in flat[c]]
    flat["bfs"] = t.bfs
    flat["rulebook_version"] = ",".join(f"{k}@{rb['version']}" for k, rb in b.rulebooks.items())
    flat.to_crs(4326).to_parquet(outdir / "parcels.parquet")
    b.buildings.drop(columns=["addresses"]).to_crs(4326).to_parquet(outdir / "buildings.parquet")

    # ---------- web: parcels
    _write_geojson(par[["id", "egrid", "geometry"]], web / "parcels.geojson")
    records = []
    rep_pt = par.geometry.representative_point()
    rep_wgs = gpd.GeoSeries(rep_pt, crs=2056).to_crs(4326)
    for (r, inp, rs), pt, ptw in zip(zip(par.itertuples(), inputs, results), rep_pt, rep_wgs):
        records.append({
            "id": int(r.id), "egrid": r.egrid, "nr": r.parcel_no, "lv95": [round(pt.x, 1), round(pt.y, 1)], "wgs84": [round(ptw.x, 6), round(ptw.y, 6)], "perimeter": r.perimeter, "covered": bool(r.covered),
            "addresses": list(r.addresses) if isinstance(r.addresses, list) else [],
            "egids": list(r.egids) if isinstance(r.egids, list) else [],
            "gklas_main": _none(r.gklas_main), "year_built": _none(r.year_built), "period_built": _none(r.period_built),
            "dwellings": _none(r.dwellings_existing), "slope_pct": _none(round(r.slope_pct, 1)) if r.slope_pct == r.slope_pct else None, "gf_existing_alt_m2": _none(r.gf_existing_alt_m2),
            "footprint_existing_m2": _none(r.footprint_existing_m2),
            "existing_from_dwellings": bool(r.existing_from_dwellings), "projects": r.projects,
            "constraints": r.constraints,
            "facts": inp,
            "py": {k: rs[k] for k in ("gf_allowed_m2", "headroom_gf_m2", "binding_constraint", "allowed_today", "confidence")},
        })
    (web / "parcels.json").write_text(json.dumps(_clean_json(records), ensure_ascii=False, separators=(",", ":")))

    # ---------- web: buildings
    bl = b.buildings.copy()
    sh = b.cfg["engine"]["storey_height_m"]
    bl["h"] = bl.height_m.fillna(bl.storeys.astype(float) * sh).fillna(4.0)
    bl = bl.rename(columns={"GKLAS": "gklas", "GBAUJ": "year_built", "GASTW": "gastw"})
    keep = ["bid", "pid", "egid", "av_status", "h", "height_source", "storeys", "gklas", "year_built", "dwellings", "counts", "geometry"]
    bl = bl[keep].copy()
    for c in ["pid", "egid", "gklas", "year_built", "dwellings"]:
        bl[c] = bl[c].astype("float").astype("Int64")
    bl["storeys"] = bl.storeys.astype(float)
    bl["h"] = bl.h.round(1)
    _write_geojson(bl, web / "buildings.geojson")

    # ---------- web: envelopes (buildable polygon per zone part)
    parts = b.parts.copy()
    parts["pidx"] = parts.groupby("id").cumcount()
    env = gpd.GeoDataFrame(parts[["id", "pidx", "zone"]], geometry=parts.envelope_geom, crs=2056)
    env = env[env.zone.notna()]
    env["geometry"] = env.geometry.simplify(0.1)
    _write_geojson(env, web / "envelopes.geojson")

    # ---------- web: zones, overlays, perimeters
    z = b.zones.copy()
    z["category"] = z.zone.map(lambda k: _zone_meta(b, k).get("category") if isinstance(k, str) else None)
    z["label"] = z.zone.map(lambda k: _zone_meta(b, k).get("label_de") if isinstance(k, str) else None).fillna(z.typ_kommunal_bezeichnung)
    z["geometry"] = z.geometry.simplify(0.2)
    _write_geojson(z[["zone", "label", "category", "perimeter", "typ_kantonal_code", "building_zone", "geometry"]], web / "zones.geojson")
    if len(b.overlays):
        _write_geojson(b.overlays, web / "overlays.geojson")
    _write_geojson(gpd.GeoDataFrame({"territory_id": [t.territory_id], "name": [t.name]}, geometry=[b.muni], crs=2056),
                   web / "boundary.geojson")
    per = b.perimeters.copy()
    per["covered"] = per.rulebook.notna()
    _write_geojson(per[["perimeter", "label", "covered", "geometry"]], web / "perimeters.geojson")

    # ---------- territory.json
    to_wgs = Transformer.from_crs(2056, 4326, always_xy=True)
    x0, y0, x1, y1 = b.muni.bounds
    bbox = [*to_wgs.transform(x0, y0), *to_wgs.transform(x1, y1)]
    cov = b.perimeters[b.perimeters.rulebook.notna()]
    fx0, fy0, fx1, fy1 = (cov.union_all() if len(cov) else b.muni).bounds
    focus_bbox = [*to_wgs.transform(fx0, fy0), *to_wgs.transform(fx1, fy1)]
    rulebooks = {}
    for pid, rb in b.rulebooks.items():
        rulebooks[pid] = {k: v for k, v in rb.items() if not k.startswith("_")}
    meta = {
        "territory_id": t.territory_id, "bfs": t.bfs, "name": t.name, "canton": t.canton,
        "built_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "bbox": bbox, "focus_bbox": focus_bbox, "bbox_lv95": [round(v) for v in b.muni.bounds], "center": [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
        "perimeters": [{"id": p.id, "label": p.label, "covered": bool(p.rulebook)} for p in t.planning_perimeters],
        "qa_locations": t.qa_locations,
        "engine_config": b.cfg["engine"],
        "pipeline_config": b.cfg["pipeline"],
        "rules": b.rules,
        "rulebooks": rulebooks,
        "qa": b.qa,
        "attribution": ATTRIBUTION,
        "links": b.cfg.get("links", {}),
        "files": ["parcels.geojson", "parcels.json", "buildings.geojson", "envelopes.geojson", "zones.geojson",
                  "overlays.geojson", "perimeters.geojson", "boundary.geojson"],
    }
    (web / "territory.json").write_text(json.dumps(_clean_json(meta), ensure_ascii=False, indent=1))
    (outdir / "territory.json").write_text((web / "territory.json").read_text())
    _update_index(t, bbox, b.qa)


def _zone_meta(b, key: str) -> dict[str, Any]:
    pid, code = key.split("/", 1)
    for z in b.rulebooks[pid]["zones"]:
        if z["code"] == code:
            return z
    return {}


def _update_index(t, bbox, qa) -> None:
    path = WEB_DATA_DIR / "index.json"
    idx = json.loads(path.read_text()) if path.exists() else {"territories": []}
    idx["territories"] = [e for e in idx["territories"] if e["territory_id"] != t.territory_id]
    idx["territories"].append({
        "territory_id": t.territory_id, "name": t.name, "bfs": t.bfs, "canton": t.canton,
        "path": f"{t.canton}/{t.bfs}", "bbox": [round(v, 5) for v in bbox],
    })
    idx["territories"].sort(key=lambda e: (e["canton"], e["bfs"]))
    path.write_text(json.dumps(idx, ensure_ascii=False, indent=1))
