"""Territory pipeline: fetch → clean → join → geometry facts → metrics → export.

One call per territory (a current municipality). Everything municipality- or
canton-specific comes from the territory YAML and the rulebooks; the code only
knows national data models (DM.01-AV-CH, MGDM Nutzungsplanung, GWR, swisstopo).
"""

from __future__ import annotations

import json
import logging
import math
import warnings
from dataclasses import dataclass, field
from typing import Any

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from pyproj import Transformer

from ..engine import capacity
from ..engine.calibrate import calibrate_existing_to_agf
from ..fetch import boundary as fb
from ..fetch import alti, buildings3d, geodienste, gwr
from ..paths import PROCESSED_DIR
from ..rules.models import engine_rules, load_rulebook, validate, verification_status, zone_lookup
from ..territory import Territory, load_config, load_territory
from . import export

log = logging.getLogger(__name__)
warnings.filterwarnings("ignore", message=".*keep_geom_type.*")

# Overlay flags from the national zoning model (typ_kantonal_code of
# ueberlagernde_nutzungsplaninhalte_flaechen). `label` restricts by communal label (regex).
OVERLAY_FLAGS = [
    {"flag": "gestaltungsplan", "codes": ["6112"]},
    {"flag": "gestaltungsplan_pflicht", "codes": ["6213"]},
    {"flag": "hochhausstandort", "codes": ["6911"]},
    {"flag": "heritage", "codes": ["6931"]},
    {"flag": "ortsbildschutz", "codes": ["5111"]},
    {"flag": "hazard", "codes": ["5311", "5312", "5313"]},
    {"flag": "gewaesserraum", "codes": ["5231", "5239"]},
    {"flag": "nachverdichtung", "codes": ["6924"], "label": "(?i)nachverdichtung"},
    {"flag": "keine_arealueberbauung", "codes": ["6924"], "label": "(?i)keine areal"},
    {"flag": "aufwertung_strassenraum", "codes": ["6924", "6925"], "label": "(?i)aufwertung"},
]
MIN_OVERLAY_SHARE = 0.10  # share of the parcel an overlay must cover to flag it

# AV land cover types that make a parcel infrastructure rather than building land
INFRA_LANDCOVER = ["Strasse_Weg", "Trottoir", "Verkehrsinsel", "Bahn", "Gewaesser_fliessendes", "Gewaesser_stehendes"]

# GWR codes (BFS feature catalogue 4.2)
GSTAT_EXISTING = 1004
GSTAT_PROJECT = {1001: "projektiert", 1002: "bewilligt", 1003: "im_bau"}
GKAT_RESIDENTIAL = {1020, 1030, 1040}
GKLAS_SINGLE_FAMILY = 1110


@dataclass
class Build:
    territory: Territory
    cfg: dict[str, Any]
    muni: Any = None
    perimeters: gpd.GeoDataFrame | None = None
    rulebooks: dict[str, dict] = field(default_factory=dict)
    rules: dict[str, dict] = field(default_factory=dict)
    parcels: gpd.GeoDataFrame | None = None
    parts: gpd.GeoDataFrame | None = None
    buildings: gpd.GeoDataFrame | None = None
    zones: gpd.GeoDataFrame | None = None
    overlays: gpd.GeoDataFrame | None = None
    projects: gpd.GeoDataFrame | None = None
    qa: dict[str, Any] = field(default_factory=dict)


def _clean(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].copy()
    geom = shapely.make_valid(shapely.force_2d(gdf.geometry.values))
    gdf = gdf.set_geometry(gpd.GeoSeries(geom, index=gdf.index, crs=gdf.crs))
    # make_valid can yield GeometryCollections; keep polygonal parts only
    gdf["geometry"] = gdf.geometry.apply(
        lambda g: shapely.union_all([p for p in getattr(g, "geoms", [g]) if p.geom_type in ("Polygon", "MultiPolygon")])
        if g.geom_type == "GeometryCollection" else g)
    return gdf[~gdf.geometry.is_empty]


# ---------------------------------------------------------------- stages

def load_boundaries(b: Build) -> None:
    t = b.territory
    b.muni = fb.boundary_geometry(t.name, t.boundary["feature_id"])
    covered = shapely.Polygon()
    rows = []
    for p in t.planning_perimeters:
        g = fb.boundary_geometry(t.name, p.boundary_feature).intersection(b.muni).difference(covered)
        covered = covered.union(g)
        rows.append({"perimeter": p.id, "label": p.label, "rulebook": p.rulebook, "geometry": g})
        if p.rulebook:
            rb = load_rulebook(p.rulebook)
            validate(rb)
            b.rulebooks[p.id] = rb
            for code, r in engine_rules(rb).items():
                b.rules[f"{p.id}/{code}"] = r
    b.perimeters = gpd.GeoDataFrame(rows, geometry="geometry", crs=2056)
    log.info("perimeters: %s", [(r["perimeter"], round(r["geometry"].area / 1e4, 1)) for r in rows])


def load_av(b: Build) -> None:
    t = b.territory
    canton = t.sources["av"]["canton"]
    where = f"BFSNr = {t.bfs}"
    par = _clean(geodienste.read_layer("av", canton, "resf", where=where))
    par = par.rename(columns={"EGRIS_EGRID": "egrid", "Nummer": "parcel_no"})
    par = par[["egrid", "parcel_no", "geometry"]].reset_index(drop=True)
    par["egrid"] = par["egrid"].fillna("").astype(str)
    par["area_m2"] = par.area
    par["id"] = np.arange(len(par), dtype=int)
    b.parcels = par

    sdr = _clean(geodienste.read_layer("av", canton, "dprsf", where=where))
    b.qa["sdr"] = sdr[["EGRIS_EGRID", "Art", "geometry"]].rename(columns={"EGRIS_EGRID": "egrid"})

    lcall = _clean(geodienste.read_layer("av", canton, "lcsf", where=where))
    b.qa["landcover"] = lcall[lcall.Art.isin(INFRA_LANDCOVER)][["Art", "geometry"]]
    lc = lcall[lcall.Art == "Gebaeude"].copy()
    lc["egid"] = pd.to_numeric(lc["GWR_EGID"].replace("", None), errors="coerce").astype("Int64")
    lc = lc[["egid", "geometry"]].reset_index(drop=True)
    lc["bid"] = np.arange(len(lc), dtype=int)
    lc["footprint_m2"] = lc.area
    b.buildings = lc
    log.info("AV: %d parcels, %d SDR, %d building footprints", len(par), len(sdr), len(lc))


def load_zoning(b: Build) -> None:
    canton = b.territory.sources["npl"]["canton"]
    z = geodienste.read_layer("npl_nutzungsplanung", canton, "grundnutzung", bbox=b.muni.bounds)
    z = _clean(z[z.rechtsstatus == "inKraft"])
    z = z[z.intersects(b.muni)].copy()
    full_area = z.area
    z["geometry"] = z.geometry.intersection(b.muni)
    z = _clean(z)
    # Drop neighbour-municipality slivers caused by small boundary mismatches.
    inside = z.area / full_area.loc[z.index]
    z = z[(inside >= 0.5) | (z.area >= 500)]
    # perimeter per zoning polygon (by representative point)
    rp = gpd.GeoDataFrame(geometry=z.representative_point(), crs=2056)
    j = gpd.sjoin(rp, b.perimeters[["perimeter", "geometry"]], how="left", predicate="within")
    z["perimeter"] = j["perimeter"].groupby(level=0).first()
    z["zone"] = None
    unmapped = []
    for pid, rb in b.rulebooks.items():
        lut = zone_lookup(rb)
        field_ = rb["zone_match_field"]
        m = z.perimeter == pid
        z.loc[m, "zone"] = z.loc[m, field_].map(lambda c: f"{pid}/{lut[c]}" if c in lut else None)
        # Buildable zones (national main use 11–15, 17) without a rulebook entry are a data error.
        # 16 (green/water within building zones) and 18 (traffic) are not buildable and need no entry.
        missing = z[m & z.zone.isna() & z.typ_kantonal_code.str.match(r"^1[1-57]")]
        unmapped += sorted(set(zip(missing[field_], missing.typ_kommunal_bezeichnung)))
    if unmapped:
        log.warning("Building-zone codes without rulebook entry: %s", unmapped)
    b.qa["unmapped_zone_codes"] = [list(u) for u in unmapped]
    z["building_zone"] = z.typ_kantonal_code.str.startswith("1")
    b.zones = z[["typ_kommunal_code", "typ_kommunal_bezeichnung", "typ_kantonal_code", "hauptnutzung_code",
                 "perimeter", "zone", "building_zone", "geometry"]].reset_index(drop=True)

    ov = geodienste.read_layer("npl_nutzungsplanung", canton, "ueberlagernde_nutzungsplaninhalte_flaechen", bbox=b.muni.bounds)
    ov = _clean(ov[ov.rechtsstatus == "inKraft"])
    ov = ov[ov.intersects(b.muni)]
    rows = []
    for spec in OVERLAY_FLAGS:
        sel = ov[ov.typ_kantonal_code.isin(spec["codes"])]
        if spec.get("label"):
            sel = sel[sel.typ_kommunal_bezeichnung.str.contains(spec["label"], regex=True)]
        for _, r in sel.iterrows():
            rows.append({"flag": spec["flag"], "label": r.typ_kommunal_bezeichnung, "geometry": r.geometry})
    b.overlays = gpd.GeoDataFrame(rows, geometry="geometry", crs=2056)
    log.info("zoning: %d base polygons, %d flagged overlays", len(b.zones), len(b.overlays))


def load_gwr_and_heights(b: Build) -> None:
    t, pcfg = b.territory, b.cfg["pipeline"]
    canton = t.sources["gwr"]["canton"]
    g_all = gwr.read_buildings(canton, t.bfs)
    dw_all = gwr.read_dwellings(canton, t.bfs)
    dw = dw_all[dw_all.WSTAT == 3004]  # existing dwellings
    dagg = dw.groupby("EGID").agg(dwellings=("EWID", "count"), warea_sum=("WAREA", "sum"),
                                  warea_missing=("WAREA", lambda s: int(s.isna().sum()))).reset_index()
    g = g_all[g_all.GSTAT == GSTAT_EXISTING].merge(dagg, on="EGID", how="left")

    # Buildings in the pipeline (projected / approved / under construction), located by GWR coordinates
    ntg = b.cfg["engine"]["net_to_gross"]
    pr = g_all[g_all.GSTAT.isin(GSTAT_PROJECT) & ~g_all.GKLAS.isin(pcfg["existing_exclude_gklas"])].copy()
    pagg = dw_all.groupby("EGID").agg(p_dwellings=("EWID", "count"), p_warea=("WAREA", "sum")).reset_index()
    pr = pr.merge(pagg, on="EGID", how="left")
    pr["gf_est_m2"] = np.where(pr.p_warea.fillna(0) > 0, pr.p_warea * ntg,
                               np.where(pr.GEBF.notna(), pr.GEBF, pr.GAREA * pr.GASTW.fillna(2) * b.cfg["engine"]["envelope_to_agf"]))
    pr = pr[pr.GKODE.notna() & pr.GKODN.notna()]
    b.projects = gpd.GeoDataFrame(pr, geometry=gpd.points_from_xy(pr.GKODE, pr.GKODN), crs=2056)
    ent = gwr.read_entrances(canton, t.bfs)
    ent["addr"] = (ent.STRNAME.fillna("") + " " + ent.DEINR.fillna("")).str.strip()
    addr = ent.groupby("EGID").addr.apply(lambda s: sorted(set(a for a in s if a))).rename("addresses")
    plz = ent.groupby("EGID").DPLZNAME.first().rename("locality")
    g = g.merge(addr, left_on="EGID", right_index=True, how="left").merge(plz, left_on="EGID", right_index=True, how="left")
    b.qa["gwr_n_existing"] = int(len(g))
    b.qa["gwr_n_residential"] = int(g.GKAT.isin(GKAT_RESIDENTIAL).sum())

    bl = b.buildings.merge(g.rename(columns={"EGID": "egid"}), on="egid", how="left")

    # heights: swissBUILDINGS3D by EGID, else the tallest 3D building whose centroid falls in the footprint
    to_wgs = Transformer.from_crs(2056, 4326, always_xy=True)
    x0, y0, x1, y1 = b.muni.bounds
    lo0, la0 = to_wgs.transform(x0, y0)
    lo1, la1 = to_wgs.transform(x1, y1)
    h = buildings3d.fetch_heights((lo0, la0, lo1, la1), (x0, y0, x1, y1))
    h = h[h.height_m.notna() & (h.height_m > 0)]
    by_egid = h[h.egid.notna()].groupby("egid").agg(h_egid=("height_m", "max"), eave_egid=("eave_m", "max"))
    by_egid.index = by_egid.index.astype("Int64")
    bl = bl.merge(by_egid, left_on="egid", right_index=True, how="left")
    pts = gpd.GeoDataFrame(h[["height_m", "eave_m"]], geometry=gpd.points_from_xy(h.x, h.y), crs=2056)
    sj = gpd.sjoin(pts, bl[["bid", "geometry"]], how="inner", predicate="within")
    by_space = sj.groupby("bid").agg(h_space=("height_m", "max"), eave_space=("eave_m", "max"))
    bl = bl.merge(by_space, left_on="bid", right_index=True, how="left")
    bl["height_m"] = bl.h_egid.fillna(bl.h_space)
    bl["eave_m"] = bl.eave_egid.fillna(bl.eave_space)
    bl["height_source"] = np.where(bl.h_egid.notna(), "swissbuildings3d_egid",
                                   np.where(bl.h_space.notna(), "swissbuildings3d_spatial", None))

    sh = b.cfg["engine"]["storey_height_m"]
    bl["storeys"] = bl.GASTW.astype("Float64")
    bl["storeys_source"] = np.where(bl.GASTW.notna(), "gwr", None)
    est = (bl.height_m / sh).round().clip(lower=1)
    fill = bl.storeys.isna() & bl.height_m.notna()
    bl.loc[fill, "storeys"] = est[fill]
    bl.loc[fill, "storeys_source"] = "height"

    # Which footprints count towards existing floor area (auxiliary buildings do not count as aGF)
    excl = set(pcfg["existing_exclude_gklas"])
    bl["counts"] = (
        ~bl.GKLAS.isin(excl)
        & ((bl.egid.notna() & bl.GKLAS.notna()) | (bl.footprint_m2 >= pcfg["existing_min_footprint_no_egid_m2"]))
        & (bl.footprint_m2 >= pcfg["existing_min_footprint_m2"])
    )
    # Where footprint × storeys is implausibly larger than the GWR dwelling areas (terraced houses,
    # blocks on garage podiums, farmhouses with barns), use the dwelling-based estimate instead.
    alt = bl.warea_sum * ntg
    prim = bl.footprint_m2 * bl.storeys.astype(float)
    bl["use_alt"] = (bl.GKAT.isin([1020, 1030]) & (bl.warea_sum.fillna(0) > 0) & (bl.warea_missing.fillna(1) == 0)
                     & (prim > pcfg["existing_alt_ratio_max"] * alt)).fillna(False).astype(bool)
    bl["gf_alt_m2"] = alt
    b.qa["buildings_existing_from_dwellings"] = int((bl.use_alt & bl.counts).sum())
    b.buildings = bl
    matched = g.EGID.isin(bl.egid.dropna())
    b.qa["gwr_matched_to_footprint"] = float(matched.mean())
    res = g.GKAT.isin(GKAT_RESIDENTIAL)
    b.qa["gwr_residential_matched_to_footprint"] = float(matched[res].mean())
    b.qa["footprints_with_height"] = float(bl.height_m.notna().mean())
    log.info("GWR matched to footprints: %.1f%% (residential %.1f%%); footprints with height %.1f%%",
             100 * b.qa["gwr_matched_to_footprint"], 100 * b.qa["gwr_residential_matched_to_footprint"],
             100 * b.qa["footprints_with_height"])


def geometry_facts(b: Build) -> None:
    """Zone parts, buildable footprint per setback, existing buildings and flags per parcel (§7.1)."""
    pcfg, ecfg = b.cfg["pipeline"], b.cfg["engine"]
    par = b.parcels
    # parcel perimeter (largest share)
    pp = gpd.overlay(par[["id", "geometry"]], b.perimeters[["perimeter", "geometry"]], how="intersection")
    pp["a"] = pp.area
    par["perimeter"] = par.id.map(pp.sort_values("a").groupby("id").perimeter.last())
    covered = {p.id for p in b.territory.planning_perimeters if p.rulebook}
    par["covered"] = par.perimeter.isin(covered)
    b.parcels = par
    # zone parts
    ov = gpd.overlay(par[["id", "geometry"]], b.zones[["zone", "perimeter", "typ_kommunal_bezeichnung",
                                                      "building_zone", "geometry"]], how="intersection", keep_geom_type=True)
    ov["area_m2"] = ov.area
    ov = ov.merge(par[["id", "area_m2"]].rename(columns={"area_m2": "parcel_area"}), on="id")
    ov = ov[(ov.area_m2 >= pcfg["min_zone_part_m2"]) & (ov.area_m2 / ov.parcel_area >= pcfg["min_zone_part_share"])]
    # merge several polygons of the same zone within one parcel
    ov["zkey"] = ov.zone.fillna("~" + ov.typ_kommunal_bezeichnung.fillna("?"))
    parts = ov.dissolve(by=["id", "zkey"], aggfunc={"zone": "first", "perimeter": "first",
                                                   "typ_kommunal_bezeichnung": "first", "building_zone": "first"}).reset_index()
    parts["area_m2"] = parts.area
    parts["agsf_m2"] = parts.area_m2  # §7.1 step 2 default
    # buildable footprint per setback: parcel minus a band along boundaries that need a setback, ∩ zone part
    setback_lines = _setback_lines(b)
    pg = par.set_index("id").geometry.loc[parts.id].values
    sl = setback_lines.loc[parts.id].values
    steps = ecfg["setback_steps_m"]
    for s in steps:
        parts[f"fp_{s}"] = shapely.area(shapely.intersection(_inner(pg, sl, s), parts.geometry.values))
    # envelope polygon for display at each zone's small boundary distance
    ga = parts.zone.map(lambda z: (b.rules.get(z) or {}).get("ga_klein_m") if isinstance(z, str) else None)
    ga = ga.fillna(ecfg["default_grenzabstand_m"]).astype(float).values
    parts["envelope_geom"] = shapely.intersection(_inner(pg, sl, ga), parts.geometry.values)
    b.parts = parts


    # existing buildings allocated to parcels by intersection
    bl = b.buildings
    pieces = gpd.overlay(bl[["bid", "geometry"]], par[["id", "geometry"]], how="intersection", keep_geom_type=True)
    pieces["piece_m2"] = pieces.area
    pieces = pieces[pieces.piece_m2 >= pcfg["min_building_overlap_m2"]]
    pieces = pieces.merge(bl.drop(columns="geometry"), on="bid")
    share = pieces.piece_m2 / pieces.footprint_m2
    pieces["gf_m2"] = np.where(pieces.counts & ~pieces.use_alt, pieces.piece_m2 * pieces.storeys.astype(float), 0.0)
    pieces["gf_fixed_m2"] = np.where(pieces.counts & pieces.use_alt, pieces.gf_alt_m2 * share, 0.0)
    # effective storeys are unknown for terraced/irregular buildings; skip them in the storey check
    pieces["storeys_chk"] = pieces.storeys.astype(float).where(~pieces.use_alt)
    main = pieces[pieces.counts]
    missing_storeys = main[main.storeys.isna() & ~main.use_alt].groupby("id").size()
    agg = main.groupby("id").agg(
        gf_existing_m2=("gf_m2", lambda s: float(np.nansum(s))),
        gf_fixed_m2=("gf_fixed_m2", "sum"),
        existing_from_dwellings=("use_alt", "any"),
        storeys_max=("storeys_chk", "max"),
        height_max_m=("height_m", "max"),
        n_buildings=("bid", "nunique"),
        dwellings_existing=("dwellings", "sum"),
        warea_sum=("warea_sum", "sum"),
        footprint_existing_m2=("piece_m2", "sum"),
    )
    # main building = largest counted footprint piece
    mb = main.sort_values("piece_m2").groupby("id").last()
    agg["gklas_main"] = mb.GKLAS
    agg["year_built"] = mb.GBAUJ
    agg["period_built"] = mb.GBAUP
    agg["egid_main"] = mb.egid
    agg["egids"] = main.dropna(subset=["egid"]).groupby("id").egid.apply(lambda s: sorted({int(e) for e in s}))
    agg["addresses"] = main.groupby("id").addresses.apply(
        lambda s: sorted({a for lst in s if isinstance(lst, list) for a in lst}))
    par = par.merge(agg, left_on="id", right_index=True, how="left")
    par["n_buildings"] = par.n_buildings.fillna(0).astype(int)
    par["gf_existing_m2"] = par.gf_existing_m2.fillna(0.0)
    par["gf_fixed_m2"] = par.gf_fixed_m2.fillna(0.0)
    par["existing_from_dwellings"] = par.existing_from_dwellings.fillna(False).astype(bool)
    par = _allocate_projects(b, par, pcfg)
    par["gf_existing_alt_m2"] = par.warea_sum.fillna(0) * ecfg["net_to_gross"]
    par["missing_storeys"] = par.id.isin(missing_storeys.index)

    # flags
    flags: dict[int, list[str]] = {i: [] for i in par.id}
    res_parts = parts[parts.zone.map(lambda z: bool(z) and b.rules[z]["residential"])]
    for i, n in parts.groupby("id").size().items():
        if n > 1:
            flags[i].append("multi_zone")
    firm = par.project_status.isin(["bewilligt", "im_bau"])
    for i in par.id[(par.missing_storeys | (par.n_buildings > 0) & par.height_max_m.isna()) & ~firm]:
        flags[i].append("missing_height")
    for i in par.id[~par.covered]:
        flags[i].append("not_covered")
    for i in par.id[par.existing_from_dwellings]:
        flags[i].append("existing_from_dwellings")
    for i, st in par.loc[par.project_status.notna(), ["id", "project_status"]].itertuples(index=False):
        flags[i].append(st)
    # slope: mean terrain slope within the parcel (swissALTI3D)
    par["slope_pct"] = _parcel_slope(b, par)
    for i in par.id[par.slope_pct > pcfg["slope_flag_pct"]]:
        flags[i].append("slope")
    lcv = b.qa.pop("landcover")
    if len(lcv):
        li = gpd.overlay(par[["id", "area_m2", "geometry"]], lcv, how="intersection")
        share = (li.area / li.area_m2).groupby(li.id).sum()
        for i in share[share >= pcfg["infrastructure_share"]].index:
            flags[i].append("infrastructure")
    nonres_dom = parts.sort_values("area_m2").groupby("id").last()
    for i, z in nonres_dom.zone.items():
        if not z or not b.rules[z]["residential"]:
            flags[i].append("non_residential_zone")
    # SDR overlap
    sdr = b.qa.pop("sdr")
    if len(sdr):
        so = gpd.overlay(par[["id", "area_m2", "geometry"]], sdr[["geometry"]], how="intersection")
        so["share"] = so.area / so.area_m2
        for i in so[so.share >= pcfg["sdr_overlap_share"]].id.unique():
            flags[i].append("sdr_overlap")
    # overlays
    if len(b.overlays):
        oo = gpd.overlay(par[["id", "area_m2", "geometry"]], b.overlays, how="intersection")
        oo["share"] = oo.area / oo.area_m2
        for (i, f), s in oo.groupby(["id", "flag"]).share.sum().items():
            if s >= MIN_OVERLAY_SHARE and f not in flags[i]:
                flags[i].append(f)
    # rulebook verification: unverified if any engine-relevant value of a residential zone on the parcel is unverified
    unverified_zones = set()
    for pid, rb in b.rulebooks.items():
        for z in rb["zones"]:
            vals = [v for v in (z.get("params") or {}).values() if isinstance(v, dict) and v.get("source")]
            if z.get("basis"):
                vals.append(z["basis"])
            if any(not v.get("verified") for v in vals):
                unverified_zones.add(f"{pid}/{z['code']}")
    for i, zs in res_parts.groupby("id").zone:
        if set(zs) & unverified_zones:
            flags[i].append("rulebook_unverified")
    par["flags"] = par.id.map(flags)
    par["parcel_small"] = par.area_m2 < ecfg["small_parcel_m2"]
    b.parcels = par


def _allocate_projects(b: Build, par: gpd.GeoDataFrame, pcfg: dict) -> gpd.GeoDataFrame:
    """Attach GWR buildings in the pipeline to parcels.

    Approved or under-construction projects count as built: they replace the existing main
    buildings when their footprint is at least half the existing one (replacement new build),
    otherwise they add to them. Projected (not yet approved) buildings are only flagged.
    """
    pr = b.projects
    par["project_status"] = None
    par["projects"] = [[] for _ in range(len(par))]
    if pr is None or pr.empty:
        return par
    sj = gpd.sjoin(pr, par[["id", "geometry"]], how="inner", predicate="within")
    order = {"projektiert": 0, "bewilligt": 1, "im_bau": 2}
    idx = par.set_index("id")
    rows = {}
    for pid, grp in sj.groupby("id"):
        status = max((GSTAT_PROJECT[int(x)] for x in grp.GSTAT), key=order.get)
        rows[pid] = status
        firm = grp[grp.GSTAT.isin([1002, 1003])]
        items = [{"egid": int(r.EGID), "status": GSTAT_PROJECT[int(r.GSTAT)], "dwellings": None if r.p_dwellings != r.p_dwellings else int(r.p_dwellings),
                  "gf_est_m2": round(float(r.gf_est_m2), 1), "footprint_m2": None if r.GAREA != r.GAREA else float(r.GAREA)} for r in grp.itertuples()]
        par.at[par.index[par.id == pid][0], "projects"] = items
        if firm.empty:
            continue
        gf_proj = float(firm.gf_est_m2.sum())
        fp_proj = float(firm.GAREA.fillna(0).sum())
        i = par.index[par.id == pid][0]
        fp_old = float(idx.at[pid, "footprint_existing_m2"]) if idx.at[pid, "footprint_existing_m2"] == idx.at[pid, "footprint_existing_m2"] else 0.0
        if fp_proj >= 0.5 * fp_old:  # replacement new build
            par.at[i, "gf_existing_m2"] = 0.0
            par.at[i, "gf_fixed_m2"] = gf_proj
            par.at[i, "storeys_max"] = np.nan
            par.at[i, "height_max_m"] = np.nan
        else:
            par.at[i, "gf_fixed_m2"] = par.at[i, "gf_fixed_m2"] + gf_proj
        par.at[i, "n_buildings"] = int(par.at[i, "n_buildings"]) + len(firm)
    par["project_status"] = par.id.map(rows)
    b.qa["parcels_with_projects"] = {k: int(v) for k, v in par.project_status.value_counts().items()}
    return par


def _parcel_slope(b: Build, par: gpd.GeoDataFrame) -> pd.Series:
    from rasterio import features

    to_wgs = Transformer.from_crs(2056, 4326, always_xy=True)
    x0, y0, x1, y1 = par.total_bounds
    slope, transform = alti.slope_raster((*to_wgs.transform(x0, y0), *to_wgs.transform(x1, y1)))
    # erode by 2 m so embankments and retaining walls along boundaries do not dominate
    geoms = [g.buffer(-2.0) if g.buffer(-2.0).area > 20 else g for g in par.geometry]
    ids = features.rasterize(((g, i + 1) for g, i in zip(geoms, par.id)), out_shape=slope.shape,
                             transform=transform, fill=0, dtype="int32", all_touched=False)
    ok = (ids > 0) & np.isfinite(slope)
    n = np.bincount(ids[ok], minlength=len(par) + 1)
    s = np.bincount(ids[ok], weights=slope[ok], minlength=len(par) + 1)
    mean = np.where(n > 0, s / np.maximum(n, 1), np.nan)[1:]
    return pd.Series(mean[par.id.values], index=par.index)


def _inner(parcel_geoms, setback_lines, dist):
    """Parcel minus a band of width `dist` along the boundary lines that need a setback."""
    band = shapely.buffer(setback_lines, dist, cap_style="flat", join_style="mitre")
    band = np.where(np.asarray(dist) > 0, band, None) if np.ndim(dist) else (band if dist > 0 else None)
    if band is None:
        return parcel_geoms
    out = shapely.difference(parcel_geoms, band)
    return np.where(shapely.is_missing(band), parcel_geoms, out)


def _setback_lines(b: Build) -> pd.Series:
    """Per parcel: boundary lines that need a boundary distance.

    Where the rulebook allows closed construction (geschlossene Bauweise) and a
    building on this parcel abuts a building on the neighbouring parcel, the
    shared stretch of boundary is a party wall and gets no setback.
    """
    par, bl = b.parcels, b.buildings
    gap = b.cfg["pipeline"]["party_wall_gap_m"]
    boundary = pd.Series(shapely.boundary(par.geometry.values), index=par.id.values)
    closed_ok = {pid for pid, rb in b.rulebooks.items()
                 if (rb.get("definitions") or {}).get("geschlossene_bauweise_zulaessig", {}).get("value")}
    pieces = gpd.overlay(bl[["bid", "geometry"]], par[["id", "perimeter", "geometry"]] if "perimeter" in par
                         else par[["id", "geometry"]], how="intersection", keep_geom_type=True)
    pieces = pieces[pieces.area >= 2.0].reset_index(drop=True)
    if "perimeter" in pieces:
        pieces = pieces[pieces.perimeter.isin(closed_ok)].reset_index(drop=True)
    left = pieces[["id", "geometry"]]
    pairs = gpd.sjoin(left, left, how="inner", predicate="dwithin", distance=gap)
    pairs = pairs[pairs.id_left != pairs.id_right]
    if pairs.empty:
        return boundary
    ga = shapely.buffer(left.geometry.values[pairs.index.values], gap / 2 + 0.05)
    gb = shapely.buffer(left.geometry.values[pairs.index_right.values], gap / 2 + 0.05)
    contact = pd.Series(shapely.intersection(ga, gb), index=pairs.id_left.values)
    contact = contact[~shapely.is_empty(contact.values)]
    region = contact.groupby(level=0).agg(lambda g: shapely.union_all(g.values))
    ids = region.index.values
    exempt = shapely.buffer(region.values, 0.5)
    boundary.loc[ids] = shapely.difference(boundary.loc[ids].values, exempt)
    b.qa["parcels_with_party_walls"] = int(len(ids))
    return boundary


def engine_inputs(b: Build) -> list[dict[str, Any]]:
    steps = b.cfg["engine"]["setback_steps_m"]
    by_id = {i: g for i, g in b.parts.groupby("id")}
    out = []
    for r in b.parcels.itertuples():
        g = by_id.get(r.id)
        parts = []
        if g is not None:
            for p in g.itertuples():
                parts.append({
                    "zone": p.zone if p.zone else None,
                    "area_m2": round(p.area_m2, 2), "agsf_m2": round(p.agsf_m2, 2),
                    "fp": [round(getattr(p, f"fp_{s}"), 2) for s in steps],
                })
        out.append({
            "area_m2": round(r.area_m2, 2), "flags": list(r.flags), "parts": parts,
            "existing": {
                "gf_m2": round(float(r.gf_existing_m2), 2),
                "gf_fixed_m2": round(float(r.gf_fixed_m2), 2),
                "storeys_max": None if pd.isna(r.storeys_max) else float(r.storeys_max),
                "height_max_m": None if pd.isna(r.height_max_m) else round(float(r.height_max_m), 2),
                "n_buildings": int(r.n_buildings),
            },
        })
    return out


def run(territory_ref: str) -> Build:
    t = load_territory(territory_ref)
    cfg = load_config(t)
    b = Build(territory=t, cfg=cfg)
    load_boundaries(b)
    load_av(b)
    load_zoning(b)
    load_gwr_and_heights(b)
    geometry_facts(b)

    inputs = engine_inputs(b)
    ecfg = dict(cfg["engine"])
    fit = calibrate_existing_to_agf(b.parcels, inputs, b.rules, ecfg, cfg["pipeline"]["calibration"])
    b.qa["calibration"] = fit
    if fit.get("factor"):
        ecfg["existing_to_agf"] = fit["factor"]
    results = capacity.compute_all(inputs, b.rules, ecfg)
    b.qa["totals"] = capacity.summarise(inputs, results)
    b.qa["blocker_ranking"] = capacity.blocker_ranking(inputs, b.rules, ecfg)
    b.qa["rulebooks"] = {pid: verification_status(rb) for pid, rb in b.rulebooks.items()}
    b.cfg = {**cfg, "engine": ecfg}

    outdir = PROCESSED_DIR / t.key
    outdir.mkdir(parents=True, exist_ok=True)
    export.write_all(b, inputs, results, outdir)
    return b
