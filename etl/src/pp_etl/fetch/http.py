"""Cached downloads with a manifest (URL, date, checksum, licence).

Every raw file lives under data/raw/<source>/... and gets one manifest entry.
Re-running a fetch is idempotent: an existing file is reused unless refresh=True.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import time
from pathlib import Path
from typing import Any

import httpx

from ..paths import MANIFEST_PATH, REPO_DIR

USER_AGENT = "parcel-potential/0.1 (+https://github.com/oceanofsolaris/upzone_me)"


def _client() -> httpx.Client:
    return httpx.Client(
        headers={"User-Agent": USER_AGENT},
        timeout=httpx.Timeout(300.0, connect=30.0),
        follow_redirects=True,
    )


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_manifest() -> dict[str, Any]:
    if MANIFEST_PATH.exists():
        return json.loads(MANIFEST_PATH.read_text())
    return {"files": {}}


def record(path: Path, url: str, licence: str, **extra: Any) -> None:
    """Add or update a manifest entry for a downloaded or derived raw file."""
    manifest = load_manifest()
    key = str(path.relative_to(REPO_DIR))
    manifest["files"][key] = {
        "url": url,
        "fetched_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "sha256": sha256(path),
        "bytes": path.stat().st_size,
        "licence": licence,
        **extra,
    }
    manifest["files"] = dict(sorted(manifest["files"].items()))
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")


def download(url: str, dest: Path, licence: str, refresh: bool = False, retries: int = 3) -> Path:
    """Download url to dest (streaming) unless it already exists."""
    if dest.exists() and not refresh:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(retries):
        try:
            with _client() as c, c.stream("GET", url) as r:
                r.raise_for_status()
                with tmp.open("wb") as f:
                    for chunk in r.iter_bytes(1 << 20):
                        f.write(chunk)
            break
        except (httpx.HTTPError, OSError):
            if attempt == retries - 1:
                raise
            time.sleep(2 * (attempt + 1))
    tmp.rename(dest)
    record(dest, url, licence)
    return dest


def get_json(url: str, params: dict[str, Any] | None = None, retries: int = 3) -> Any:
    for attempt in range(retries):
        try:
            with _client() as c:
                r = c.get(url, params=params)
                r.raise_for_status()
                return r.json()
        except httpx.HTTPError:
            if attempt == retries - 1:
                raise
            time.sleep(2 * (attempt + 1))
