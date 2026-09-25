"""Canton-wide GeoPackages from geodienste.ch (AV = cadastral survey, NPL = zoning).

geodienste.ch publishes both in the national minimal data models for every
canton, so the same code works across Switzerland: only the canton code changes.
The OGC API endpoints were not used because bbox filtering is unreliable there
(documented in docs/decisions.md).
"""

from __future__ import annotations

import zipfile
from pathlib import Path

import geopandas as gpd
import pyogrio

from ..paths import RAW_DIR
from .http import download

STAC_ITEM = "https://geodienste.ch/stac/collections/{topic}/items/{item}"
GPKG_URL = {
    "av": "https://geodienste.ch/downloads/geopackage/av/{canton}/deu/av_{canton}_gpkg_lv95.zip",
    "npl_nutzungsplanung": (
        "https://geodienste.ch/downloads/geopackage/npl_nutzungsplanung/{canton}/deu/"
        "npl_nutzungsplanung_v1_2_{canton}_gpkg_lv95.zip"
    ),
}
LICENCE = "geodienste.ch / Kanton {canton}: freie Nutzung, Quellenangabe ist Pflicht"


def gpkg_path(topic: str, canton: str, refresh: bool = False) -> Path:
    url = GPKG_URL[topic].format(canton=canton)
    zdest = RAW_DIR / "geodienste" / canton / url.rsplit("/", 1)[1]
    download(url, zdest, LICENCE.format(canton=canton), refresh=refresh)
    outdir = zdest.parent / topic
    gpkgs = list(outdir.glob("**/*.gpkg"))
    if refresh or not gpkgs:
        with zipfile.ZipFile(zdest) as z:
            z.extractall(outdir)
        gpkgs = list(outdir.glob("**/*.gpkg"))
    return gpkgs[0]


def read_layer(topic: str, canton: str, layer: str, bbox=None, where: str | None = None) -> gpd.GeoDataFrame:
    path = gpkg_path(topic, canton)
    gdf = pyogrio.read_dataframe(path, layer=layer, bbox=bbox, where=where)
    if gdf.crs is None:
        gdf = gdf.set_crs(2056)
    return gdf
