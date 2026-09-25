# Decisions and verified identifiers

Log of every "(verify)" item from the spec and every deliberate deviation.
Newest first within each section. Date: 2026-09-25 unless noted.

## Verified identifiers and sources (spec §5)

| Spec item | Status | Finding |
|---|---|---|
| BFS number Brugg 4095 | ✅ | swissBOUNDARIES3D feature `4095`; GWR `GGDENR=4095` |
| Schinznach-Bad merged 2020, own BNO | ✅ merged | Boundary `4095-2020` adds it; separate zone codes in the zoning data (e.g. `112102 Wohnzone 2`, Kurbauzone). Own BNO not yet collected → "noch nicht erfasst" |
| **Villnachern** (not in spec) | ⚠️ new | **Merged into Brugg on 1 Jan 2026** (boundary `4095` vs `4095-2025`; 849 GWR buildings with PLZ 5213 in BFS 4095). Own zoning codes (E2, W2a, MF3, Dorfzone …). Shown as "noch nicht erfasst" |
| swissBOUNDARIES3D access | ✅ changed | Used `api3.geo.admin.ch/rest/services/api/MapServer/find` on layer `ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill`, `searchField=gemname`. Returns all historical versions (`<bfs>-<year>`), which we use for planning perimeters. `searchField=gem_code_bfs` does not exist |
| AV Aargau open? | ✅ | geodienste.ch `av`, AG: "Frei erhältlich", "Freie Nutzung. Quellenangabe ist Pflicht". Canton GeoPackage `https://geodienste.ch/downloads/geopackage/av/AG/deu/av_AG_gpkg_lv95.zip` (510 MB). Layers `resf` (parcels, `EGRIS_EGRID`, `Nummer`), `dprsf` (SDR), `lcsf` (land cover; `Art='Gebaeude'`, `GWR_EGID`), `hadr` |
| AV footprints carry EGID | ✅ | `lcsf.GWR_EGID` (string, empty when missing) |
| Nutzungsplanung AG, model | ✅ | geodienste.ch `npl_nutzungsplanung_v1_2` (MGDM v1.2), AG open, updated 2026-09-14. GeoPackage `…/npl_nutzungsplanung_v1_2_AG_gpkg_lv95.zip`. Layers `grundnutzung`, `ueberlagernde_nutzungsplaninhalte_{flaechen,linien,punkte}`. Fields `typ_kommunal_code/_bezeichnung`, `typ_kantonal_code`, `rechtsstatus` |
| OGC API Features (geodienste) | ❌ not used | Requires `crs=…/EPSG/0/2056`; bbox filtering unreliable (point layer `HADR` ignores bbox; attribute filters unsupported). Canton GeoPackages are simpler and scale to all of AG |
| Zone codes match BNO | ✅ | Brugg/Umiken perimeter: `112101` Wohnzone 2-geschossig = W2, `113101` = W3, `114101` = W4, `132101…135101` = WA2…WA5, `134102` = WAZ4, `144101` = Zentrumszone, `141101` Kernzone, `141201` Altstadt, `143101` Cityzone, `148101` Campus, `117101/118101` Erneuerungszone. **`typ_kommunal_code` is only unique within a municipality** (`112101` is "Einfamilienhauszone E2" in Villnachern) → rulebooks are scoped to a perimeter |
| GWR public extract for AG | ✅ | `https://public.madd.bfs.admin.ch/ag.zip` (76 MB, daily). SQLite `data.sqlite`, tables `building`, `entrance`, `dwelling`, `code`. Has `EGRID`, `GASTW`, `GAREA`, `GBAUJ`, `GBAUP`, `GKLAS`, `GKAT`, `GSTAT`; dwellings `WAREA`, `WAZIM`, `WSTAT` |
| GKLAS 1110 = single-dwelling building | ✅ | per `code` table |
| swissBUILDINGS3D 3.0 STAC | ✅ changed | Per-map-sheet items (e.g. `…_2024_1070-31`). **The FileGDB has geometry only (multipatch, no attributes)**. The CityGML edition carries `EGID`, `DACH_MAX`, `DACH_MIN`, `GELAENDEPUNKT` → height = `DACH_MAX − GELAENDEPUNKT`. We stream-parse CityGML (~6 s per tile) and cache per-tile parquet |
| swissALTI3D STAC | ✅ | `ch.swisstopo.swissalti3d`, 1 km tiles, 2 m GeoTIFF asset `…_2_2056_5728.tif` |
| SearchServer CORS | ✅ | `Access-Control-Allow-Origin: *`. `bbox` only works in LV95 with `sr=2056`, and it ranks rather than filters. Results still include `lat`/`lon` |
| Basemap style URL | ✅ | `https://vectortiles.geo.admin.ch/styles/ch.swisstopo.lightbasemap.vt/style.json`, CORS open |
| ÖREB AG endpoint | ⏳ | Not needed for the prototype; not resolved yet (validation-only per spec) |
| Consolidated BNO | ✅ | "Bau- und Nutzungsordnung Ortsteile Brugg und Umiken, Stand 10. Januar 2024" (brugg.ch, text layer OK). ER 22.11.2019; RR 24.03.2021 and 15.09.2021. Contains Teiländerungen 1 & 2. Note: the spec's "approved 24 March 2019" should read **24 March 2021** |
| BauV AG SAR number | ⏳ | Not checked; only needed for the attic assumption (marked unverified) |
| Planungszonen `AGIS.are_Planungszonen` | ⏳ | Not yet fetched (flag not implemented) |
| Baulinien | ⏳ | **Not in the NPL dataset** (lines layer has hedges, forest edges, Gewässerraum). Must come from AGIS Erschliessungspläne; not implemented |

## Modelling decisions

1. **Territory ≠ rulebook.** A territory is a current municipality; it has 1..n *planning perimeters*
   (derived from historical swissBOUNDARIES3D versions), each with its own rulebook or none.
   Engine zone keys are `<perimeter>/<code>` (e.g. `brugg-umiken/W2`).
2. **AZ excludes attic storeys (BNO § 74).** Spec §7.2 multiplies the envelope by `vg + attika`
   and caps with AZ. When the rulebook says `az_counts_attika_dg: false`, the engine caps only
   the full storeys with AZ and adds the attic *in proportion to the built footprint*:
   `gf = min(AZ·aGSF, fp·VG·k) · (1 + attika/VG)`. See decision 22 for scenarios that add storeys.
3. **Party walls.** BNO § 13 Abs. 5 allows closed construction. Where buildings on both sides of
   a boundary are ≤ 0.6 m apart, that stretch of boundary gets no setback. Without this, row
   houses got ~2 m² allowed and were flagged "not allowed today" en masse.
4. **Infrastructure parcels.** In Aargau, streets are often zoned like the adjacent area. Parcels
   with ≥ 50% AV land cover of road/rail/water get the `infrastructure` flag and no capacity
   (348 parcels in Brugg/Umiken). Unbuilt residential land dropped from 44 ha to 17 ha.
5. **A discretionary part makes the parcel total unknown** (null), not partial (golden case 19).
6. **Existing floor area** counts main buildings only. It excludes GKLAS 1242 (garages) and 1274
   (other small structures), footprints < 10 m², and footprints without EGID < 50 m².
7. **Calibration** (§7.3): 19 parcels built since 2019 in AZ-bound zones; raw median
   utilisation 1.194 → `existing_to_agf = 0.796`.
8. **Scenario +1 storey also raises Gesamthöhe by one storey** (`scenario_storey_raises_height`);
   otherwise the height limit silently cancels the lever.
9. **Zone Campus is `discretionary`, not `non_residential`** (spec §11.5 expected
   non-residential): § 16 Abs. 2 permits housing and § 16 Abs. 4 requires ≥ 15% residential share.
10. **Zentrumszone** has no AZ ("-") → envelope-only; confidence capped at medium (§ 17 Abs. 3
    Gestaltungsplanpflicht). Large boundary distance "*" → conservative uses the small one.
11. **Arbeitszone II** (`122199 Arbeitszone ES IV`) is mapped to AII; § 24 is excluded from approval
    (old BNO 2003 § 25 applies). Non-residential either way.
12. **Slope flag** uses the mean slope of the parcel eroded by 2 m (swissALTI3D 2 m). With the spec
    threshold of 10%, 45% of covered parcels are flagged; Brugg is hilly. Threshold is in config.
13. **Confidence** follows §7.6 strictly. Because the rulebook is unverified, every residential parcel
    is `low` until `pp rules verify` has run. Other reasons are still listed in the inspector.
14. **Frontend data**: static GeoJSON + `parcels.json` (engine facts). The browser recomputes all
    parcels for scenarios (4.6k parcels × 18 blocker scenarios < 100 ms). Map colours use MapLibre
    feature-state, so no GeoJSON re-upload. `web/src/data/source.ts` is the only module to swap
    for PMTiles/GeoParquet in v1.
15. **`?raf=timeout` debug switch**: drives MapLibre with timers so that background/automated tabs
    render (used for screenshots).
16. **Model for LLM extraction**: `PP_LLM_MODEL`, default `claude-sonnet-5` per spec D12. The
    Brugg rulebook itself was extracted in-session (spec §9 allows this).
17. **Existing floor area from dwellings (feedback, parcel 245 Herrenmatt 3).** For residential buildings
    (GKAT 1020/1030) with complete GWR dwelling areas where footprint × storeys > 2 × (Σ WAREA × 1.25),
    the dwelling-based estimate is used, as an unscaled `gf_fixed_m2` engine input (361 buildings:
    terraced houses, blocks on garage podiums, farmhouses with barns). Herrenmatt 3: 16 flats, 8 GWR
    storeys in terraces; footprint × storeys gave 18k m² aGF, now 2.7k m² (utilisation 0.96). The storey
    check is skipped for these buildings.
18. **GWR building projects.** GSTAT 1001/1002/1003 buildings are located by GWR coordinates. Approved
    (1002) and under-construction (1003) projects count as built (dwellings × 1.25, else GEBF). They replace
    the existing buildings when their footprint is ≥ 50% of the old one, otherwise they add to them.
    Projected (1001) buildings are flagged only. Map: dotted pattern. Brugg/Umiken: 5 im Bau, 13 bewilligt, 9 projektiert.
    Reference case Frickermattenstrasse 7a/7b (Umiken, parcels 5217/6833): 2 × 5 flats, ~453 m² living area
    each on ~900 m², i.e. AZ ≈ 0.5 (the W2 maximum) plus attic. Seven years from planning (2018) to
    groundbreaking (Feb 2026). The model's maximum for 5217 is 585 m²; the project reaches ~97%.
19. **No height exceedance on slope-flagged parcels.** Heights are measured without the relevant terrain,
    so on slopes the check is unreliable (golden case 22).
20. **New overlay flag** `aufwertung_strassenraum` (§ 8 BNO; NPL 6924/6925 "Aufwertung …"). It carries no
    density bonus.
21. **Report link bug fixed.** The "Fehler melden" link used `location.href` before the URL had been
    updated, so it pointed to the previously selected parcel.
22. **Storey count is chosen, not forced (feedback: W2 AZ max, +2 storeys was lower than +1).** Because the
    attic scales with the built footprint, forcing all permitted storeys made more storeys *reduce* capacity
    once the AZ binds. The engine now takes the best storey count between the zone's own count and the scenario
    maximum. Current-rule results are unchanged; scenarios are monotone (golden cases 07, 16, 18 updated,
    23 added). Fewer storeys than the zone's own count are deliberately not considered: that would add a
    "one storey + large attic" loophole to the baseline.
23. **Terraced houses on slopes exceed the AZ as estimated (parcel 5180, Aarestrasse 37a–d, 45% slope).**
    The approved project has 4 flats, 519 m² living area over 5 levels; the estimate of ≈ 649 m² aGF vs. 559 m²
    allowed gives utilisation 1.16. The most likely explanation is legal accounting: BNO § 74 excludes
    Untergeschosse and Attika from the AZ, and under BauV § 23 a storey counts as an Untergeschoss if the floor
    above protrudes on average ≤ 0.8 m above the façade line. On steep slopes several terrace levels can
    qualify, so only a fraction of the built area counts. Not verified against the permit (not public). Not modelled yet (see improvements.md).
24. **Forest distance (Waldabstand), from feedback on Sandbock parcels 5041/5042/5408.** Aargau: 18 m for
    buildings (BauG § 48 Abs. 1 lit. c); 8 m for small structures/extensions/underground parts (not modelled).
    The Brugg BNO sets no own value. Canton-level settings now live in `etl/config/cantons/<canton>.yaml`
    (merged between default and territory config). Forest = static forest boundaries (geodienste
    `npl_waldgrenzen_v1_2`, open for AG) ∪ forest zones of the zoning plan (Hauptnutzung 44) ∪ AV land cover
    `geschlossener_Wald`. Its 18 m buffer is removed from every buildable footprint and envelope. The land
    still counts for aGSF, so AZ-bound parcels can keep their allowed floor area in a narrower footprint.
    Flags: `waldabstand` (≥ 10% of the parcel in the band), `bestand_im_waldabstand` (existing main building
    inside; grandfathered, replacement needs an exception). Brugg/Umiken: 426 and 155 parcels; reserve
    523k → 513k m². Municipal Waldabstandslinien are "keine Daten" on geodienste for AG, and exceptions or
    Rodung/Ersatzaufforstung are not modelled. Parcel 5042: the forest line in the building zone was fixed
    in 2008; buildings from 2013/2018 stand 8 m from it.
25. **Second municipality: Windisch (BFS 4123), 2026-09-25.** BNO "Stand Juni 2022" (RR 18.12.2019 / 6.5.2020),
    structurally a twin of Brugg's (joint "Raum Brugg Windisch" planning): the same § 74, EG bonus and closed
    construction. Differences: Zentrumszone 3 VG / 14 m, and Gesamthöhe measured to the top of the roof
    substructure. Added with a territory YAML + rulebook only. **No pipeline code changes were needed**, apart
    from one missing rulebook entry (Familiengartenzone). Result: 1,839 parcels, 99.2% GWR residential matched,
    calibration 0.74 (17 samples), reserve ≈ 361k m².
26. **Multi-territory frontend.** The browser loads any set of territories (`#t=id1,id2`; default all in
    `index.json`) and merges them into one dataset with global parcel ids. Zone keys are
    `<perimeter>/<code>` and must be unique across territories; the loader checks this. The calibrated
    `existing_to_agf` now travels per parcel (`existing.existing_to_agf`, golden case 24), so one engine config
    serves all territories. The municipality panel has a Gemeinde selector; blocker rankings are computed
    per scope. The parity test runs for every built territory.
27. **Observation (not changed): envelope-only zones inside realised Gestaltungspläne look rosy.** Example:
    Windisch, Hauserstrasse 2a ff. (Zentrumszone, built 2014 under a Gestaltungsplan) shows ≈ 19k m² reserve
    because the Zentrumszone has no AZ and the simplified envelope covers the whole parcel. See
    improvements.md.
28. **Panel and Gemeinde UX for many municipalities (feedback).** The side panel is closed by default. It opens
    on a parcel click (parcel tab; the Gemeinde follows the parcel) or via the "Gemeinde" button (Gemeinde under
    the map centre). Closing it clears the selection. There is no "all Gemeinden" view: the Gemeinde tab shows
    one Gemeinde at a time, and the map outside it is greyed out (mask = world minus the exported
    `boundary.geojson`). Scenario settings live in one global scenario keyed by `<perimeter>/<zone>`, so each
    Gemeinde keeps its settings when switching. The map shows all Gemeinden's changes; "Zurücksetzen" resets only
    the current Gemeinde. Bonus switches are now scoped per perimeter (`<perimeter>/<bonus id>`; a bare id still
    means "everywhere"), mirrored in both engines (golden cases 25/26). URL: `g=<territory>` when the Gemeinde
    tab is open.
29. **Parcel constraints shown separately from estimate notes (feedback).** The pipeline exports per-parcel
    `constraints` ({id, share?, labels?, length_m?}). The inspector shows them under "Regeln" as
    "Weitere Einschränkungen auf dieser Parzelle", each with its effect ("in der Hülle berücksichtigt" /
    "nur markiert, nicht gerechnet" / "Hinweis") and legal basis. Texts live in one catalog
    (`web/src/ui/constraints.ts`); a new constraint type needs one catalog entry plus the pipeline emitting it.
    "Hinweise zur Schätzung" keeps only notes on the estimate itself (verification, missing data, slope, …).
    The **Gewässerraum** (NPL 5231/5239) is now a no-build area like the forest distance (GSchV Art. 41c;
    config `gewaesserraum_no_build`). Party-wall stretches are shown as a modelled constraint with their length.
