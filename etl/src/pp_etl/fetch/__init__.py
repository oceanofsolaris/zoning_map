"""Data fetchers. Each caches under data/raw and records a manifest entry."""

from __future__ import annotations


def fetch_all(territory_ref: str, refresh: bool = False) -> None:
    from pyproj import Transformer

    from ..territory import load_territory
    from . import alti, boundary, buildings3d, geodienste, gwr

    t = load_territory(territory_ref)
    bnd = boundary.fetch_boundaries(t.name, refresh=refresh)
    geodienste.gpkg_path("av", t.sources["av"]["canton"], refresh=refresh)
    geodienste.gpkg_path("npl_nutzungsplanung", t.sources["npl"]["canton"], refresh=refresh)
    gwr.sqlite_path(t.sources["gwr"]["canton"], refresh=refresh)
    g = boundary.boundary_geometry(t.name, t.boundary["feature_id"])
    tr = Transformer.from_crs(2056, 4326, always_xy=True)
    x0, y0, x1, y1 = g.bounds
    buildings3d.fetch_heights((*tr.transform(x0, y0), *tr.transform(x1, y1)), g.bounds, refresh=refresh)
    alti.latest_tiles((*tr.transform(x0, y0), *tr.transform(x1, y1)))  # tiles are downloaded during build
    del bnd
