"""Building heights from swissBUILDINGS3D 3.0 (CityGML edition).

The FileGDB edition carries geometry only (multipatch, no attributes), so we
stream-parse the CityGML tiles instead and keep per-building attributes:
EGID, DACH_MAX, DACH_MIN, GELAENDEPUNKT plus a representative XY point.
"""

from __future__ import annotations

import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

import pandas as pd

from ..paths import RAW_DIR
from .http import download, get_json, record

STAC = "https://data.geo.admin.ch/api/stac/v1/collections/{collection}/items"
LICENCE = "swisstopo open data (OGD), attribution required"
NS_BLDG = "{http://www.opengis.net/citygml/building/2.0}"
NS_GEN = "{http://www.opengis.net/citygml/generics/2.0}"
NS_GML = "{http://www.opengis.net/gml}"


def latest_tiles(bbox_wgs84: tuple[float, float, float, float],
                 collection: str = "ch.swisstopo.swissbuildings3d_3_0") -> dict[str, str]:
    """Map sheet id -> CityGML asset URL of the newest per-sheet edition."""
    url = STAC.format(collection=collection)
    params = {"bbox": ",".join(map(str, bbox_wgs84)), "limit": 100}
    best: dict[str, tuple[int, str]] = {}
    while url:
        data = get_json(url, params)
        params = None
        for it in data["features"]:
            m = re.match(r".*_(\d{4})_(\d{4}-\d{2})$", it["id"])
            if not m:
                continue  # national mosaics
            year, sheet = int(m.group(1)), m.group(2)
            href = next((a["href"] for k, a in it["assets"].items() if k.endswith(".citygml.zip")), None)
            if href and (sheet not in best or year > best[sheet][0]):
                best[sheet] = (year, href)
        url = next((l["href"] for l in data.get("links", []) if l["rel"] == "next"), None)
    return {s: h for s, (_, h) in sorted(best.items())}


def _parse_citygml(path: Path, bbox_lv95) -> pd.DataFrame:
    xmin, ymin, xmax, ymax = bbox_lv95
    rows = []
    for _, el in ET.iterparse(path, events=("end",)):
        if el.tag != NS_BLDG + "Building":
            continue
        attrs: dict[str, float | str] = {}
        for g in el:
            if g.tag.startswith(NS_GEN):
                v = g.find(NS_GEN + "value")
                if v is not None:
                    attrs[g.get("name")] = v.text
        dmax, dmin, zmin = [], [], float("inf")
        sx = sy = 0.0
        n = 0
        for g in el.iter():
            if g.tag == NS_GEN + "doubleAttribute" and g.get("name") in ("DACH_MAX", "DACH_MIN"):
                val = float(g.find(NS_GEN + "value").text)
                (dmax if g.get("name") == "DACH_MAX" else dmin).append(val)
            elif g.tag == NS_GML + "posList" and g.text:
                c = g.text.split()
                xs, ys, zs = c[0::3], c[1::3], c[2::3]
                for x, y, z in zip(xs, ys, zs):
                    sx += float(x); sy += float(y); n += 1
                    zmin = min(zmin, float(z))
        el.clear()
        if n == 0:
            continue
        cx, cy = sx / n, sy / n
        if not (xmin <= cx <= xmax and ymin <= cy <= ymax):
            continue
        rows.append({
            "egid": int(attrs["EGID"]) if attrs.get("EGID") else None,
            "objektart": attrs.get("OBJEKTART"),
            "gelaende": float(attrs["GELAENDEPUNKT"]) if attrs.get("GELAENDEPUNKT") else None,
            "z_min": zmin,
            "dach_max": max(dmax) if dmax else None,
            "dach_min": min(dmin) if dmin else None,
            "x": cx, "y": cy,
        })
    return pd.DataFrame(rows)


def fetch_heights(bbox_wgs84, bbox_lv95, refresh: bool = False) -> pd.DataFrame:
    """Per-building heights for all tiles intersecting the bbox (cached as parquet per tile)."""
    tiles = latest_tiles(bbox_wgs84)
    frames = []
    for sheet, href in tiles.items():
        zdest = RAW_DIR / "swissbuildings3d" / href.rsplit("/", 1)[1]
        cache = zdest.with_suffix(".heights.parquet")
        if cache.exists() and not refresh:
            frames.append(pd.read_parquet(cache))
            continue
        download(href, zdest, LICENCE, refresh=refresh)
        with zipfile.ZipFile(zdest) as z:
            gml = next(n for n in z.namelist() if n.endswith(".gml"))
            tmpdir = zdest.parent / ("_x_" + sheet)
            z.extract(gml, tmpdir)
        # Parse the whole tile (not just the bbox) so the cache is reusable by neighbours.
        df = _parse_citygml(tmpdir / gml, (-1e12, -1e12, 1e12, 1e12))
        df["sheet"] = sheet
        df.to_parquet(cache)
        record(cache, href, LICENCE, derived_from=str(zdest.name))
        (tmpdir / gml).unlink()
        tmpdir.rmdir()
        frames.append(df)
    df = pd.concat(frames, ignore_index=True)
    xmin, ymin, xmax, ymax = bbox_lv95
    df = df[(df.x >= xmin) & (df.x <= xmax) & (df.y >= ymin) & (df.y <= ymax)].copy()
    terrain = df["gelaende"].fillna(df["z_min"])
    df["height_m"] = (df["dach_max"] - terrain).where(df["dach_max"].notna())
    df["eave_m"] = (df["dach_min"] - terrain).where(df["dach_min"].notna())
    # Buildings split across sheet borders appear twice; keep the tallest record per EGID.
    with_egid = df[df.egid.notna()].sort_values("height_m", ascending=False).drop_duplicates("egid")
    return pd.concat([with_egid, df[df.egid.isna()]], ignore_index=True)
