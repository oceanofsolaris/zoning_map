"""Territory definitions (one current municipality, 1..n planning perimeters)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel

from .paths import CONFIG_DIR, TERRITORY_DIR


class Perimeter(BaseModel):
    id: str
    label: str
    boundary_feature: str
    rulebook: str | None = None


class Territory(BaseModel):
    territory_id: str
    bfs: int
    name: str
    canton: str
    boundary: dict[str, Any]
    sources: dict[str, dict[str, Any]]
    planning_perimeters: list[Perimeter]
    qa_locations: list[dict[str, Any]] = []
    config: dict[str, Any] = {}

    @property
    def key(self) -> str:
        """Path-friendly key used for data folders: <canton>/<bfs>."""
        return f"{self.canton}/{self.bfs}"


def _deep_merge(a: dict, b: dict) -> dict:
    out = dict(a)
    for k, v in b.items():
        out[k] = _deep_merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def load_territory(ref: str) -> Territory:
    """Load by id ('AG-4095-brugg'), path, or '<canton>/<file>'."""
    p = Path(ref)
    if not p.exists():
        candidates = list(TERRITORY_DIR.glob("*/*.yaml"))
        matches = [c for c in candidates if yaml.safe_load(c.read_text()).get("territory_id") == ref
                   or c.stem == ref or f"{c.parent.name}/{c.stem}" == ref]
        if not matches:
            raise FileNotFoundError(f"No territory '{ref}' in {TERRITORY_DIR}")
        p = matches[0]
    return Territory(**yaml.safe_load(p.read_text()))


def all_territories() -> list[Territory]:
    return [Territory(**yaml.safe_load(p.read_text())) for p in sorted(TERRITORY_DIR.glob("*/*.yaml"))]


def load_config(territory: Territory | None = None) -> dict[str, Any]:
    cfg = yaml.safe_load((CONFIG_DIR / "default.yaml").read_text())
    if territory and territory.config:
        cfg = _deep_merge(cfg, territory.config)
    return cfg
