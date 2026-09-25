"""Terrain slope from swissALTI3D (2 m GeoTIFF tiles, 1 km × 1 km)."""

from __future__ import annotations

import re

import numpy as np
import rasterio
from rasterio.merge import merge

from ..paths import RAW_DIR
from .http import download, get_json

STAC = "https://data.geo.admin.ch/api/stac/v1/collections/ch.swisstopo.swissalti3d/items"
LICENCE = "swisstopo open data (OGD), attribution required"


def latest_tiles(bbox_wgs84) -> dict[str, str]:
    """Tile id ('2657-1259') -> URL of the newest 2 m GeoTIFF."""
    url, params = STAC, {"bbox": ",".join(map(str, bbox_wgs84)), "limit": 100}
    best: dict[str, tuple[int, str]] = {}
    while url:
        data = get_json(url, params)
        params = None
        for it in data["features"]:
            m = re.match(r".*_(\d{4})_(\d{4}-\d{4})$", it["id"])
            if not m:
                continue
            year, tile = int(m.group(1)), m.group(2)
            href = next((a["href"] for k, a in it["assets"].items() if k.endswith("_2_2056_5728.tif")), None)
            if href and (tile not in best or year > best[tile][0]):
                best[tile] = (year, href)
        url = next((l["href"] for l in data.get("links", []) if l["rel"] == "next"), None)
    return {t: h for t, (_, h) in sorted(best.items())}


def slope_raster(bbox_wgs84):
    """Mosaic the 2 m DEM over the bbox and return (slope_percent, transform)."""
    paths = []
    for _, href in latest_tiles(bbox_wgs84).items():
        dest = RAW_DIR / "swissalti3d" / href.rsplit("/", 1)[1]
        download(href, dest, LICENCE)
        paths.append(dest)
    srcs = [rasterio.open(p) for p in paths]
    try:
        dem, transform = merge(srcs)
    finally:
        for s in srcs:
            s.close()
    z = dem[0].astype("float64")
    z[z < -1000] = np.nan
    res = transform.a
    gy, gx = np.gradient(z, res)
    return np.hypot(gx, gy) * 100.0, transform
