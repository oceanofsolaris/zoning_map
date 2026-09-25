"""Municipal boundaries (current and historical) from swissBOUNDARIES3D via api3.geo.admin.ch.

Historical versions matter: after mergers, old municipal boundaries delimit
planning perimeters that still have their own BNO.
"""

from __future__ import annotations

import json

import geopandas as gpd
from shapely.geometry import shape

from ..paths import RAW_DIR
from .http import get_json, record

LAYER = "ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill"
FIND_URL = "https://api3.geo.admin.ch/rest/services/api/MapServer/find"
LICENCE = "swisstopo open data (OGD), attribution required"


def fetch_boundaries(name: str, refresh: bool = False) -> gpd.GeoDataFrame:
    """All versions of a municipality's boundary, keyed by feature id ('<bfs>-<year>' or '<bfs>')."""
    dest = RAW_DIR / "swissboundaries3d" / f"{name.lower()}.geojson"
    if refresh or not dest.exists():
        params = {
            "layer": LAYER, "searchText": name, "searchField": "gemname", "contains": "false",
            "returnGeometry": "true", "geometryFormat": "geojson", "sr": "2056",
        }
        data = get_json(FIND_URL, params)
        feats = [
            {"type": "Feature", "id": str(r["id"]), "properties": {**r["properties"], "feature_id": str(r["id"])},
             "geometry": r["geometry"]}
            for r in data["results"]
        ]
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
        record(dest, f"{FIND_URL}?layer={LAYER}&searchText={name}", LICENCE)
    fc = json.loads(dest.read_text())
    rows = [{"feature_id": f["id"], "jahr": f["properties"].get("jahr"), "geometry": shape(f["geometry"])}
            for f in fc["features"]]
    return gpd.GeoDataFrame(rows, geometry="geometry", crs=2056)


def boundary_geometry(name: str, feature_id: str):
    gdf = fetch_boundaries(name)
    sel = gdf[gdf.feature_id == feature_id]
    if sel.empty:
        raise KeyError(f"Boundary feature {feature_id} not found for {name}; available: {sorted(gdf.feature_id)}")
    return sel.geometry.union_all()
