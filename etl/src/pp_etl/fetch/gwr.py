"""Federal building and dwelling register (GWR), public cantonal extract (SQLite)."""

from __future__ import annotations

import sqlite3
import zipfile
from pathlib import Path

import pandas as pd

from ..paths import RAW_DIR
from .http import download

URL = "https://public.madd.bfs.admin.ch/{canton}.zip"
LICENCE = "BFS GWR public data, attribution required (see license.pdf in the archive)"

BUILDING_COLS = ["EGID", "EGRID", "GGDENR", "GKODE", "GKODN", "GSTAT", "GKAT", "GKLAS",
                 "GBAUJ", "GBAUP", "GABBJ", "GAREA", "GASTW", "GANZWHG", "GEBF", "GSCHUTZR"]


def sqlite_path(canton: str, refresh: bool = False) -> Path:
    canton = canton.lower()
    zdest = RAW_DIR / "gwr" / f"{canton}.zip"
    download(URL.format(canton=canton), zdest, LICENCE, refresh=refresh)
    out = RAW_DIR / "gwr" / canton
    db = out / "data.sqlite"
    if refresh or not db.exists():
        with zipfile.ZipFile(zdest) as z:
            z.extract("data.sqlite", out)
    return db


def read_buildings(canton: str, bfs: int) -> pd.DataFrame:
    with sqlite3.connect(sqlite_path(canton)) as c:
        cols = ", ".join(BUILDING_COLS)
        return pd.read_sql(f"SELECT {cols} FROM building WHERE GGDENR = ?", c, params=(bfs,))


def read_dwellings(canton: str, bfs: int) -> pd.DataFrame:
    with sqlite3.connect(sqlite_path(canton)) as c:
        return pd.read_sql(
            "SELECT d.EGID, d.EWID, d.WSTAT, d.WAREA, d.WAZIM FROM dwelling d "
            "JOIN building b USING (EGID) WHERE b.GGDENR = ?", c, params=(bfs,))


def read_entrances(canton: str, bfs: int) -> pd.DataFrame:
    """Addresses (street, number, PLZ) per building; used for the inspector and search."""
    with sqlite3.connect(sqlite_path(canton)) as c:
        return pd.read_sql(
            "SELECT e.EGID, e.STRNAME, e.DEINR, e.DPLZ4, e.DPLZNAME FROM entrance e "
            "JOIN building b USING (EGID) WHERE b.GGDENR = ?", c, params=(bfs,))


def read_codes(canton: str) -> pd.DataFrame:
    with sqlite3.connect(sqlite_path(canton)) as c:
        return pd.read_sql("SELECT CECODID, CMERKM, CODTXTKD, CODTXTLD FROM code", c)
