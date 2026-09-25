"""Helpers for adding a municipality: boundary versions, zone codes per perimeter, QA checks.

These codify the manual steps from the Brugg/Windisch work (see docs/playbook-new-municipality.md).
"""

from __future__ import annotations

import json
import warnings
from typing import Any

import geopandas as gpd
import pandas as pd

from .fetch.boundary import boundary_geometry, fetch_boundaries
from .fetch.geodienste import read_layer
from .paths import PROCESSED_DIR, RULEBOOK_DIR
from .rules.models import load_rulebook, zone_lookup
from .territory import load_territory

warnings.filterwarnings("ignore")


def boundary_versions(name: str) -> pd.DataFrame:
    """All swissBOUNDARIES3D versions for a municipality name; the geometry changes mark mergers."""
    b = fetch_boundaries(name)
    b["area_ha"] = (b.area / 1e4).round(1)
    b["bounds"] = b.geometry.bounds.round(0).astype(int).values.tolist()
    b = b.sort_values("jahr")
    # keep only rows where the area changes (merger/boundary change) plus the latest
    changed = b.area_ha.ne(b.area_ha.shift())
    return b.loc[changed | (b.index == b.index[-1]), ["feature_id", "jahr", "area_ha", "bounds"]]


def zone_codes(territory_ref: str) -> pd.DataFrame:
    """Zoning codes (Grundnutzung) per planning perimeter, with area and the rulebook zone they map to."""
    t = load_territory(territory_ref)
    muni = boundary_geometry(t.name, t.boundary["feature_id"])
    z = read_layer("npl_nutzungsplanung", t.sources["npl"]["canton"], "grundnutzung", bbox=muni.bounds)
    z = z[(z.rechtsstatus == "inKraft") & z.intersects(muni)].copy()
    rows = []
    covered = gpd.GeoSeries(dtype="geometry", crs=2056)
    for p in t.planning_perimeters:
        g = boundary_geometry(t.name, p.boundary_feature).intersection(muni).difference(covered.union_all() if len(covered) else muni.buffer(0).difference(muni))
        covered = pd.concat([covered, gpd.GeoSeries([g], crs=2056)])
        sub = z[z.representative_point().within(g)]
        # the rulebook may not exist yet (this listing is the input for writing it)
        lut = zone_lookup(load_rulebook(p.rulebook)) if p.rulebook and (RULEBOOK_DIR / p.rulebook).exists() else {}
        for (code, label, kant), grp in sub.groupby(["typ_kommunal_code", "typ_kommunal_bezeichnung", "typ_kantonal_code"]):
            rows.append({"perimeter": p.id, "code": code, "label": label, "kantonal": kant,
                         "n": len(grp), "area_ha": round(grp.area.sum() / 1e4, 2),
                         "building_zone": str(kant)[:2] in ("11", "12", "13", "14", "15", "17"),
                         "rulebook_zone": lut.get(code, "")})
    return pd.DataFrame(rows)


def qa(territory_ref: str) -> list[dict[str, Any]]:
    """Plausibility checks on a built territory. Thresholds are rules of thumb from Brugg/Windisch, not law."""
    t = load_territory(territory_ref)
    d = PROCESSED_DIR / t.key
    tj = json.loads((d / "territory.json").read_text())
    q = tj["qa"]
    p = gpd.read_parquet(d / "parcels.parquet")
    c = p[p.covered & p.gf_allowed_m2.notna()]
    out = []

    def check(name, ok, value, hint):
        out.append({"check": name, "status": "ok" if ok else "WARN", "value": value, "hint": hint})

    check("unmapped building-zone codes", not q.get("unmapped_zone_codes"), q.get("unmapped_zone_codes"),
          "add rulebook entries (non-residential ones too); run `pp zones`")
    m = q.get("gwr_residential_matched_to_footprint", 0)
    check("GWR residential matched to footprints", m > 0.95, round(m, 3), "< 95%: check AV/GWR year mismatch or EGID field")
    h = q.get("footprints_with_height", 0)
    check("footprints with 3D height", h > 0.75, round(h, 3), "low: swissBUILDINGS3D tiles missing? check STAC sheet ids")
    cal = q.get("calibration", {})
    f = cal.get("factor")
    check("calibration samples", (cal.get("n_samples") or 0) >= 8, cal.get("n_samples"), "few new buildings: factor falls back to default; consider pooling")
    check("calibration factor plausible", f is None or 0.6 <= f <= 1.0, f, "outside 0.6–1.0: inspect samples (terraces, GP areas, projects)")
    share_over = (c.allowed_today == False).mean()  # noqa: E712
    check("share 'not allowed today'", share_over < 0.15, round(float(share_over), 3), "high: setbacks/row houses/heights? inspect examples")
    binding = c.binding_constraint.value_counts(normalize=True).round(2).to_dict()
    check("binding mix", True, binding, "Aargau AZ zones: AZ usually binds most; many 'envelope' → check setbacks and no-build areas")
    unb = c[c.n_buildings == 0]
    check("unbuilt residential parcels", True, {"n": len(unb), "ha": round(float(unb.area_m2.sum()) / 1e4, 1)},
          "compare with Bauzonenstatistik; road parcels leaking in shows as many long thin 'unbuilt' parcels")
    top = c.sort_values("headroom_gf_m2", ascending=False).head(8)
    check("top headroom parcels (inspect!)", True,
          [(r.parcel_no, round(r.headroom_gf_m2), json.loads(r.zones)[0]["zone"] if json.loads(r.zones) else None,
            [f for f in json.loads(r.flags) if f in ("gestaltungsplan", "gestaltungsplan_pflicht", "discretionary", "hochhausstandort")])
           for r in top.itertuples()],
          "envelope-only zones and realised Gestaltungspläne inflate reserves (improvements.md §6)")
    tot = q["totals"]
    check("reserve vs existing", tot["headroom_gf_m2"] < 1.5 * tot["agf_existing_m2"],
          {"reserve": round(tot["headroom_gf_m2"]), "existing": round(tot["agf_existing_m2"])}, "reserve > 1.5 × existing is suspicious")
    return out


def oereb_documents(territory_ref: str, perimeter: str | None = None, egrid: str | None = None) -> list[tuple[str, str]]:
    """Legal documents linked in the ÖREB extract of one parcel (the canonical way to find the valid BNO).

    Without an EGRID, a residential-zone parcel inside the given planning perimeter is picked.
    """
    import httpx

    from .territory import load_config

    t = load_territory(territory_ref)
    tmpl = (load_config(t).get("oereb") or {}).get("extract_json")
    if not tmpl:
        raise SystemExit(f"No `oereb.extract_json` URL template in etl/config/cantons/{t.canton}.yaml")
    if not egrid:
        per = next(p for p in t.planning_perimeters if perimeter in (None, p.id))
        muni = boundary_geometry(t.name, t.boundary["feature_id"])
        g = boundary_geometry(t.name, per.boundary_feature).intersection(muni)
        z = read_layer("npl_nutzungsplanung", t.sources["npl"]["canton"], "grundnutzung", bbox=g.bounds)
        z = z[z.typ_kantonal_code.str.startswith("11") & z.representative_point().within(g)]
        pt = (z.loc[z.area.idxmax()].geometry if len(z) else g).representative_point()
        par = read_layer("av", t.sources["av"]["canton"], "resf", bbox=(pt.x - 50, pt.y - 50, pt.x + 50, pt.y + 50))
        par = par[par.intersects(pt.buffer(0.5))]
        if par.empty:
            raise SystemExit("No parcel found at the sample point; pass --egrid")
        egrid = par.EGRIS_EGRID.iloc[0]
    d = httpx.get(tmpl.format(egrid=egrid), timeout=120).json()
    seen: list[tuple[str, str]] = []

    def walk(o):
        if isinstance(o, dict):
            u, tt = o.get("TextAtWeb"), o.get("Title")
            u = u[0]["Text"] if isinstance(u, list) and u else u
            tt = tt[0]["Text"] if isinstance(tt, list) and tt else tt
            if u and (tt, u) not in seen:
                seen.append((tt, u))
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(d)
    return [("EGRID", egrid)] + seen
