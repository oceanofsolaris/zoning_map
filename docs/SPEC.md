# Parcel Potential Aargau: Specification

v1 vision plus Brugg prototype. Draft 0.1, 25 September 2026.
Owner: Stephan. Primary reader: a coding agent (Claude Code); secondary: humans reviewing the work.

---

## 0. Read this first (for the implementing agent)

> **Status 2026-09-25:** the (verify) items are resolved in [`decisions.md`](decisions.md). Notable corrections: Villnachern also merged into Brugg (1 Jan 2026); the BNO was approved by the Regierungsrat on 24 March **2021** (ER 22 Nov 2019); swissBUILDINGS3D attributes come from the CityGML edition.

- **Build the prototype described in §4.** Sections 1–3 are context, so that prototype decisions don't paint v1 into a corner.
- Items marked **(verify)** are identifiers, URLs or facts that could not be confirmed while drafting. Check them first. If one is wrong, fix it in this document and log the change in `docs/decisions.md`.
- When the semantics of Swiss or Aargau building law are unclear, **do not guess silently.** Encode the assumption as a named config parameter with a default, and list it on the methodology page (§8.3).
- The legal texts (BNO, BauV) are in German. Keep German domain terms in identifiers where there is no clean English equivalent (e.g. `az_max`, `grenzabstand_klein_m`). All abbreviations are expanded in the glossary (§14).
- Stop and ask Stephan instead of improvising when any of these happen:
  - a data source needs registration or payment;
  - the consolidated BNO text cannot be found;
  - zone codes in the zoning dataset don't match the BNO.

---

## 1. Purpose

Swiss zoning often allows substantially more floor area than exists, especially in single-family neighbourhoods. Nobody shows this parcel by parcel. For every parcel, the tool answers:

1. How much floor area do current rules allow, and how much is built? (utilisation, headroom)
2. Which rule is binding? (Ausnützungsziffer, storeys/height, setbacks, coverage)
3. Would the existing building be allowed today?
4. What could realistically be added here? For single-family plots: add a storey, an extension, a granny flat, or a replacement building.
5. At municipal level: how much capacity does the zoning hold, and how much would a given upzoning scenario add?

| Audience | Main questions | Typical use |
|---|---|---|
| Homeowners | Q4 | "What could I do with my plot?" |
| Developers | Q1, Q2 | Find soft sites (large headroom, old low-density buildings, few constraints) |
| Policy: councillors, planners, advocates | Q2, Q3, Q5 | BNO revisions, parliamentary motions, public debate on densification |

**Non-goals (prototype and v1):**
- legal advice or permit predictions;
- identifying owners;
- market valuation from scraped listings;
- generating building designs.

---

## 2. v1 target (context; don't build yet)

| Area | v1 |
|---|---|
| Coverage | All municipalities in Kanton Aargau (about 200) |
| Rulebooks | LLM-extracted from each BNO and human-verified through a review queue; versioned with effective dates; detection of new BNO revisions |
| Views | Owner, Developer, Policy (§8) |
| Overlays | ISOS, heritage objects, flood hazard, forest and watercourse setbacks, groundwater protection zones, road noise, public transport quality classes (ÖV-Güteklassen) |
| Analyses | Capacity totals per municipality; binding-constraint breakdown; scenario builder with spatial predicates (e.g. "within 500 m of a station"); cross-municipality comparison |
| Outputs | Shareable URLs; CSV/GeoParquet export; one-page summary per municipality |
| Data delivery | PMTiles + GeoParquet on static hosting |
| Feedback | "Report an error" per parcel, feeding the rulebook review queue |
| Context data | STATPOP hectare grid for density context (never per-building occupancy) |

---

## 3. Visualisation base: why not fork civicmapper

[civicmapper](https://github.com/Center-for-Land-Economics/civicmapper) (Center for Land Economics, MIT licence) is a **good reference architecture but a poor base** for this project.

**Reasons not to fork:**
- **Schema mismatch.** Its loader requires US assessment columns (`REALLANDVA`, `REALIMPROV`), and its metric dropdowns come from a hard-coded allowlist in `viz/src/utils.dictionary.ts`. Swiss parcels have no public assessed values, so we would have to rewrite the core loader anyway.
- **Different core interactions.** Civicmapper colours parcels by value metrics. Our core is a per-parcel rule breakdown, a "ghost envelope" of the allowed volume over the real building, and live scenario recomputation. None of that exists there.
- **Maturity.** Young repository with few commits and contributors; we'd be tracking a moving target.

**What to borrow:**
- The stack: TypeScript, Vite, MapLibre GL JS, PMTiles, GeoParquet via `hyparquet`.
- The per-city config pattern: a `cities/<key>.json` file plus a data dictionary.
- The ETL-to-GeoParquet pattern.

The MIT licence allows copying snippets with attribution.

**Possible later synergy:** if Swiss land-value estimates ever exist, contributing a Swiss city to civicmapper could be worthwhile.

---

## 4. Prototype scope: Brugg AG

**Territory:** Einwohnergemeinde Brugg (BFS number 4095, verify), including the Ortsteile Umiken and Lauffohr. Take the municipal boundary from swissBOUNDARIES3D.

**Schinznach-Bad** merged into Brugg in 2020 and probably still has its own BNO (verify). It would need a second rulebook, so it is P1. Show it as "not yet covered" until then.

**Known state of Brugg's zoning** (starting points, not guaranteed complete):
- The **base BNO** was approved on 24 March 2019 following the full revision of the Nutzungsplanung.
- A **Teilgenehmigung** covered the Zentrums- and Altstadtzone and communally protected buildings. These parts were affected by an appeal from the Aargauer Heimatschutz and involve ISOS areas. See `https://oereblex.ag.ch/api/attachments/8536`.
- **Teiländerung "Rückweisungsänderungen 1. Teil"** (Einwohnerrat, 21 January 2022): rules for high-rise buildings (§ 7, § 85 Abs. 2), Zone Campus (§ 16 Abs. 5), Gestaltungsplan Sommerhalde. See `https://oereblex.ag.ch/api/attachments/8877`.
- **Teiländerung "Rückweisungsänderungen 2. Teil"** (Einwohnerrat, 1 September 2023): § 23 Arbeitszone I, § 58 parking layout, § 59 low-car housing, § 74 Ausnützungsziffer (new paragraph), additions to Anhang III (communally protected buildings). See `https://oereblex.ag.ch/api/attachments/10420` (scanned, noisy OCR) and `https://oereblex.ag.ch/api/attachments/8535`.
- The zone table notes that the Stadtrat may grant an AZ bonus of 0.1 for publicly oriented ground-floor uses in residential and work zones. This is discretionary: model it as an optional bonus, off by default.
- Some zones carry no density figures (marked with an asterisk in the zone table). Treat these as "discretionary" (see §7).
- Brugg has designated high-rise locations (Hochhausstandorte) and a Zone Campus. Flag them; don't model them in the prototype.

→ **Rule:** use the ÖREB cadastre or the current Nutzungsplanung dataset for the zone assignment of each parcel. Compile a consolidated rulebook in which every parameter records which document and date it comes from.

### 4.1 Priorities

**P0 (prototype must have)**
1. A reproducible pipeline for Brugg: fetch → clean → join → compute metrics → export. One command.
2. A Brugg rulebook (YAML) for all building zones. Extraction is LLM-assisted; every value carries provenance (document, page, paragraph, verbatim quote); every value is human-verified with the `verify` CLI.
3. A capacity engine in Python with golden tests (§7, §11).
4. A web map showing:
   - parcels coloured by headroom;
   - 3D buildings;
   - a ghost envelope for the selected parcel;
   - a parcel inspector with the rule table and binding constraint;
   - an "allowed today?" layer.
5. A municipality panel: totals, utilisation histogram, binding-constraint breakdown.
6. Scenario sliders per zone (ΔAZ, Δ full storeys) with live recomputation. This needs a TypeScript mirror of the engine arithmetic that passes the same golden tests.
7. A blocker ranking: which single rule change (AZ +0.1, +1 storey, per zone and overall) adds the most capacity.
8. CSV export of parcel metrics; a methodology and sources page; disclaimer; attribution.

**P1 (after P0 works end to end)**
- Single-family options (§7.5).
- Constraint overlays: ISOS, heritage (cantonal objects plus the BNO Anhang), flood hazard, forest, watercourse space (Gewässerraum).
- A setback scenario lever, using precomputed footprints.
- A soft-site ranking with a transparent score.
- The Schinznach-Bad rulebook.
- A distance-to-station scenario predicate (buffer around Bahnhof Brugg).
- A municipal one-page summary (HTML, printable).

**Out of scope for the prototype**
- Other municipalities; backend, accounts.
- Prices and valuation; owner data.
- Gestaltungsplan-specific rules (flag only).
- Parking requirements (flag only).
- Terrain-dependent height measurement (flag slope only).

---

## 5. Data sources

All processing in **LV95 (EPSG:2056)**. Reproject to **EPSG:4326** only for web export. Cache every download under `data/raw/` with a manifest (URL, date, checksum, licence).

Join keys:
- **EGRID** for parcels;
- **EGID** for buildings (AV building footprints carry a GWR EGID attribute, verify);
- **EWID** for dwellings;
- **BFS number** for municipalities.

| # | Dataset | Use | Access | Licence | Notes |
|---|---|---|---|---|---|
| 1 | swissBOUNDARIES3D (swisstopo) | Municipal boundary | STAC `ch.swisstopo.swissboundaries3d` (verify); map layer `ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill` | Open, attribution | Select by BFS number |
| 2 | Amtliche Vermessung (AV) Aargau | Parcels (Liegenschaften, with EGRID and number); SDR (building rights) parcels; building footprints (Bodenbedeckung "Gebäude", with EGID) | AGIS Direktdownload via the Geodatenliste on ag.ch (search "Amtliche Vermessung", "Liegenschaften"), or geodienste.ch "Amtliche Vermessung" (MOpublic / DM.01-AV-CH) (verify which is open for AG) | AGIS open data: "open use, must provide source" (verify per dataset) | Exclude SDR from land area; flag SDR overlap |
| 3 | Nutzungsplanung kommunal (AG) | Base zoning per area (Grundnutzung), overlay zones, building lines (Baulinien), forest setback lines, Gestaltungsplan perimeters | AGIS Geodatenliste (search "Nutzungsplanung", "Bauzonen"), or geodienste.ch "Nutzungsplanung (kantonal/kommunal)", model 73 (verify) | As above | Zone codes must match the rulebook's `code` field |
| 4 | Planungszonen (AG) | Flag parcels under a planning freeze | AGIS dataset `AGIS.are_Planungszonen` | Open, attribution | P0 flag |
| 5 | ÖREB cadastre (AG) | Authoritative per-parcel check; links to legal documents | Web service following the swisstopo directive: `GetEGRID` (by E/N coordinates) and `GetExtractById` (JSON/XML). Find the AG base URL via ag.ch/oereb or the cadastre.ch list of cantonal endpoints (verify) | Public | At most 2 requests per second; cache responses; use for validation and document links, not as the bulk source |
| 6 | Legal texts | BNO Brugg and its amendments; cantonal BauG (SAR 713.100) and BauV (SAR 713.121) (verify SAR numbers) | oereblex.ag.ch (via ÖREB extract links), stadt-brugg.ch, gesetzessammlungen.ag.ch | Public | Some PDFs are scans with poor OCR; re-OCR if needed |
| 7 | Gebäude- und Wohnungsregister (GWR), public extract | Buildings: class, construction year, storeys, number of dwellings, footprint area, energy reference area if present. Dwellings: rooms, area | `https://public.madd.bfs.admin.ch/ag.zip` (SQLite, refreshed daily; verify for AG, confirmed for ZH), or housing-stat.ch/__publicdata. Codes per the BFS feature catalogue 4.2 | Open, attribution | Field names: EGID, GKODE/GKODN, GKAT, GKLAS, GBAUJ/GBAUP, GASTW, GANZWHG, GAREA, GEBF; dwellings EWID, WAZIM, WAREA (verify which are in the public extract). Construction year is missing for some old buildings; use the period code as fallback |
| 8 | swissBUILDINGS3D 3.0 | Building heights (roof max, eave proxy) | STAC `https://data.geo.admin.ch/api/stac/v1/collections/ch.swisstopo.swissbuildings3d_3_0`; 1 km tiles; GDB/DWG/CityGML | Open, attribution | Fallback: normalised surface model = swissSURFACE3D raster minus swissALTI3D, median within each footprint |
| 9 | swissALTI3D | Terrain, slope flag | STAC `ch.swisstopo.swissalti3d` | Open | Flag parcels with mean slope above 10% |
| 10 | Address search (frontend) | Geocoding typed addresses | `https://api3.geo.admin.ch/rest/services/api/SearchServer?type=locations&searchText=…` (verify CORS) | Open | Returns LV95 and WGS84 coordinates |
| 11 | Basemap | Background | swisstopo vector tiles, light basemap style, e.g. `https://vectortiles.geo.admin.ch/styles/ch.swisstopo.lightbasemap.vt/style.json` (verify); SWISSIMAGE WMTS as optional aerial | Open, attribution | |
| 12 | ÖV-Güteklassen (ARE) | Scenario predicates, context (P1/v1) | `ch.are.gueteklassen_oev` | Open | |
| 13 | ISOS | Heritage overlay (P1) | `ch.bak.bundesinventar-schuetzenswerte-ortsbilder` | Open | Brugg's old town has ISOS areas |
| 14 | Heritage objects | Overlay (P1) | Cantonal objects: AGIS "Denkmalpflege" dataset (verify name). Communal: BNO Brugg Anhang III (a list in PDF → LLM extraction + match to parcels by address or parcel number) | Open / public | |
| 15 | Flood hazard map, forest boundaries, watercourse space, groundwater protection zones (AG) | Overlays (P1) | AGIS Geodatenliste | Open, attribution | Brugg sits at the Aare–Reuss–Limmat confluence, so flood hazard matters |
| 16 | Road noise (sonBASE) | Context (v1) | e.g. `ch.bafu.laerm-strassenlaerm_tag` | Open | |
| 17 | STATPOP hectare grid (BFS) | Density context (v1) | BFS | Open | Never derive per-building occupancy |
| 18 | Bauzonenstatistik (ARE) | Validation: unbuilt residential zone area in Brugg | ARE publications | Open | Order-of-magnitude check only |
| 19 | Prices | None in the prototype | – | – | v1: user-entered assumptions; licensed data only with a partner |

geo.admin.ch also provides `identify` and `find` endpoints (api3.geo.admin.ch) for point queries against the federal layers. These are useful for spot checks.

---

## 6. Data model

### 6.1 Rulebook (YAML, one file per municipality)

Path: `etl/rulebooks/AG/4095-brugg.yaml`. Every numeric parameter is an object with a value and provenance. `verified: true` may only be set by the `verify` CLI after a human confirms it.

> **The values below are illustrative only. They are not Brugg's actual parameters.** Extract the real ones from the documents.

```yaml
rulebook_id: AG-4095-brugg
municipality: { bfs: 4095, name: Brugg, canton: AG }   # verify BFS number
version: 0.1.0
compiled_at: 2026-09-25
sources:
  - id: bno_2019
    title: "Bau- und Nutzungsordnung Stadt Brugg (genehmigt 24.03.2019)"
    url: "<find consolidated version>"
    effective_from: 2019-03-24
  - id: teil2_2023
    title: "Teiländerung BNO, Rückweisungsänderungen 2. Teil (Einwohnerrat 01.09.2023)"
    url: "https://oereblex.ag.ch/api/attachments/10420"
    effective_from: "<approval date, verify>"
cantonal_definitions:            # from BauV AG; how aGF, aGSF, heights etc. are measured
  agf_definition: { text: "...", source: bauv_ag, section: "§ ...", verified: false }
zones:
  - code: "W2"                   # exactly as in the Nutzungsplanung dataset
    label_de: "Wohnzone 2"
    residential: true
    discretionary: false         # true if density figures are set case by case
    params:
      az_max:                { value: 0.45, source: bno_2019, page: 9, section: "§ 16 Abs. 1", quote: "…", verified: false }
      ueberbauungsziffer_max: { value: null }
      gruenflaechenziffer_min: { value: 0.3, source: bno_2019, page: 9, section: "…", quote: "…", verified: false }
      vollgeschosse_max:     { value: 2, … }
      attika_or_dg_allowed:  { value: true, … }
      attika_factor:         { value: null }    # fraction of a full storey; null → config default
      fassadenhoehe_max_m:   { value: 7.5, … }
      gesamthoehe_max_m:     { value: 11.0, … }
      grenzabstand_klein_m:  { value: 4.0, … }
      grenzabstand_gross_m:  { value: 8.0, … }
      gebaeudelaenge_max_m:  { value: 30.0, … }
      empfindlichkeitsstufe: { value: "II", … }
    bonuses:
      - id: eg_publikumsorientiert
        az_delta: 0.1
        discretionary: true
        default_on: false
        source: teil2_2023
    notes: []
```

A JSON Schema for this file lives at `etl/src/pp_etl/rules/rulebook.schema.json`. CI validates every rulebook against it.

### 6.2 Parcel output (one feature per Liegenschaft)

Canonical format: GeoParquet (EPSG:4326 geometry). Prototype web export: GeoJSON, with the same properties.

| Property | Type | Meaning |
|---|---|---|
| `egrid`, `parcel_no`, `bfs` | str/int | Identifiers |
| `area_m2`, `bauzone_area_m2`, `agsf_m2` | float | Parcel area; area within building zones; approximate anrechenbare Grundstücksfläche |
| `zones` | list | `[{code, area_m2, share}]` for each zone part |
| `egids`, `n_buildings`, `gklas_main`, `year_built` | list/int | From GWR; `gklas_main` is the building class of the largest building |
| `storeys_existing`, `height_existing_m`, `dwellings_existing` | num | Largest building / totals |
| `gf_existing_m2`, `gf_existing_alt_m2` | float | Primary: footprint × storeys. Alternative: GWR dwelling area × net-to-gross factor |
| `gf_allowed_az_m2`, `gf_allowed_env_m2`, `gf_allowed_m2` | float/null | AZ-based, envelope-based, and final (the minimum of the defined ones) |
| `binding_constraint` | enum | `az`, `envelope`, `discretionary`, `non_residential`, `none` |
| `utilisation` | float/null | Existing ÷ allowed |
| `headroom_gf_m2`, `headroom_units`, `headroom_residents` | float/int | Additional capacity (never negative) |
| `allowed_today` | bool/null | False means the existing building probably exceeds current rules |
| `exceedances` | list | e.g. `["storeys", "az"]` |
| `footprint_buildable_m2` | object | Buildable footprint per zone part at setbacks `{0, 2, 3, 4, 5, 6, 8}` m (for scenario interpolation) |
| `envelope_height_m`, `envelope_geom` | float/geom | For the ghost envelope. The geometry may be a separate layer keyed by EGRID |
| `confidence` | enum | `high`, `medium`, `low` (§7.6) |
| `flags` | list | `multi_zone`, `gestaltungsplan`, `planungszone`, `hochhausstandort`, `sdr_overlap`, `missing_height`, `slope`, `heritage`, `isos`, `hazard`, `non_residential_zone`, `rulebook_unverified` |
| `rulebook_version` | str | For traceability |

### 6.3 Building output

`egid`, `egrid`, `footprint_geom`, `height_m` (with source), `storeys` (with source), `gklas`, `year_built`, `dwellings`. Used for 3D extrusion and the inspector.

---

## 7. Capacity engine

**Design principle:** the geometry is precomputed in Python; the arithmetic lives in two implementations.
- A Python engine for the pipeline.
- A TypeScript mirror for live scenarios in the browser.

Both must pass the same golden test vectors (`tests/golden/*.json`) to within 0.1 m². Keep the arithmetic small and pure so that mirroring it is trivial.

### 7.1 Geometry facts (Python, per parcel and zone part)

1. Intersect the parcel with the building-zone polygons to get the zone parts.
2. Compute `agsf_m2` per zone part. Default: the zone-part area. Optionally subtract areas inside forest, watercourse space or traffic zones. This is a config switch; document it.
3. Compute the buildable footprint polygon per zone part:
   - buffer the parcel inwards by a uniform setback;
   - subtract strips beyond building lines (Baulinien) and forest setback lines where data exists.

   Compute the buildable area at setbacks {0, 2, 3, 4, 5, 6, 8} m.

   Aargau distinguishes a small and a large boundary distance, with the large one usually on the main living façade. Its orientation is unknown per parcel. Therefore:
   - **optimistic:** use `grenzabstand_klein_m` on all sides (default for headline numbers);
   - **conservative:** use `grenzabstand_gross_m` on all sides;
   - report both values as a range in the inspector.
4. Existing buildings on the parcel: footprints, heights, storeys, dwellings, construction year.
5. Envelope geometry for display: buildable polygon (optimistic) extruded to the envelope height (§7.2).

### 7.2 Allowed floor area (the mirrored arithmetic)

```text
for each zone part z of parcel p (residential zones only; others → non_residential):
    r = rules[z.code] with scenario deltas applied
    if r.discretionary:            → gf_env only, binding = discretionary, confidence ≤ medium
    gf_az  = r.az_max * z.agsf                           (if az_max defined)
    fp     = interp(z.footprint_buildable_by_setback, r.grenzabstand_klein_m)
    if r.ueberbauungsziffer_max: fp = min(fp, r.ueberbauungsziffer_max * z.agsf)
    storeys_eff = r.vollgeschosse_max + (r.attika_factor or cfg.attika_factor if r.attika_or_dg_allowed else 0)
    if r.vollgeschosse_max is null and r.gesamthoehe_max_m:
        storeys_eff = floor(r.gesamthoehe_max_m / cfg.storey_height_m)
    gf_env = fp * storeys_eff * cfg.envelope_to_agf
    gf_allowed_z = min(defined(gf_az, gf_env))
    binding_z    = "az" if gf_az is defined and gf_az <= gf_env else "envelope"

gf_allowed = Σ_z gf_allowed_z
binding    = binding of the zone part with the largest area
envelope_height_m = min(storeys_eff * storey_height, gesamthoehe_max_m if defined)
```

Bonuses such as `eg_publikumsorientiert` add to `az_max` only when switched on in the scenario.

### 7.3 Existing floor area and derived metrics

```text
gf_existing     = Σ_buildings footprint_b * storeys_b
                   (storeys from GWR GASTW; else round(height_b / storey_height))
gf_existing_alt = Σ_dwellings WAREA * cfg.net_to_gross          (residential only)
agf_existing    = gf_existing * cfg.existing_to_agf

utilisation        = agf_existing / gf_allowed
headroom_gf_m2     = max(0, gf_allowed - agf_existing)
headroom_units     = floor(headroom_gf_m2 / cfg.gf_per_dwelling_m2)
headroom_residents = headroom_gf_m2 / cfg.gf_per_resident_m2

allowed_today = not (
       agf_existing   > gf_allowed * (1 + cfg.tol_gf)
    or storeys_max    > vollgeschosse_max + (1 if attika_or_dg_allowed else 0)
    or height_max_m   > gesamthoehe_max_m + cfg.tol_height_m )
```

**Calibration of `existing_to_agf`:** AZ counts anrechenbare Geschossfläche under the Aargau definition, which differs from gross footprint × storeys.
- Take buildings completed in 2019 or later (built under the current BNO) in AZ-bound zones.
- Fit the factor so that their median utilisation is about 0.95.
- Report the fitted value on the methodology page. Never hide it.

### 7.4 Scenarios and blocker ranking

A scenario is a list of rule deltas, optionally restricted by a spatial predicate:

```yaml
id: w2w3-plus
deltas:
  - zones: [W2, W3]
    az_max: +0.2
    vollgeschosse_max: +1
    where: { within_m_of_station: 600 }   # P1; v1: oev_gueteklasse_in: [A, B]
```

- **Prototype sliders:** per residential zone, ΔAZ in steps of 0.05 and Δ full storeys in {0, +1, +2}. P1 adds setback −1/−2 m.
- **Scenario output:** Δ allowed floor area, Δ units, Δ residents; a map of Δ per parcel; a per-zone table.
- **Blocker ranking:** for each lever L ∈ {AZ +0.1, +1 storey, (P1) setback −1 m, (P1) +3 m height}, apply L alone to each zone and to all zones. Sum Δ capacity over residential parcels and show a bar chart titled "Welche einzelne Regeländerung bringt am meisten Wohnraum?". This is the policy-facing output. Make it exportable as CSV and as a PNG or SVG.

### 7.5 Single-family options (P1)

Applies to parcels whose main building is a single-dwelling building (GKLAS 1110, verify code). Show each option with Δ m², Δ dwellings, the binding rule, and "needs checking" flags.

| Option | Computation | Flags |
|---|---|---|
| Add a storey (Aufstockung) | +1 storey × existing footprint if storeys and height allow; capped by AZ headroom | Structure, attic rules |
| Extension or second building (Anbau) | min(AZ headroom, free buildable footprint × storeys). Free buildable footprint = buildable polygon minus the existing footprint buffered by the building distance | Building distance, access |
| Granny flat or split (Einliegerwohnung) | Same floor area, +1 dwelling | Parking (+1 space), fire safety, separate entrance, condominium division |
| Replacement building (Ersatzneubau) | Full allowed floor area → dwellings | Demolition, heritage, tenants |

### 7.6 Confidence

Start at `high`, then:
- **cap at `medium`** for: `multi_zone`, `missing_height`, `slope`, `discretionary`, or an optimistic–conservative setback range wider than 30%;
- **cap at `low`** for: `gestaltungsplan`, `hochhausstandort`, `sdr_overlap`, `rulebook_unverified`, or a parcel smaller than 150 m².

### 7.7 Soft-site score (P1, developer view)

The score is transparent and configurable. Show its components in the inspector.

```text
score = min(headroom_units, cfg.cap_units)
        * f_age(year_built)                # e.g. 1.0 if < 1980, 0.6 if 1980–1999, 0.2 if ≥ 2000
        * f_type(gklas_main)               # single-dwelling / low-density higher
        * f_size(area_m2)                  # below 500 m² penalised
        * (1 - penalties(heritage, isos, hazard, gestaltungsplan, sdr_overlap))
```

---

## 8. Frontend

### 8.1 Stack and structure

- **Stack:** TypeScript, Vite, MapLibre GL JS, vanilla components with a small reactive store. Charts with Observable Plot, or hand-written SVG if simpler.
- **No backend.** Everything is static files.
- **Data loading:**
  - prototype: `public/data/brugg_parcels.geojson`, `brugg_buildings.geojson`, `brugg_envelopes.geojson`, `rulebook.json`;
  - v1: PMTiles plus GeoParquet (via `hyparquet`), following civicmapper.
- **URL state:** view, selected EGRID, active scenario, and active layers are encoded in the URL so every state can be shared.
- **Engine:** `web/src/engine/capacity.ts` mirrors §7.2–7.4 and is tested against `tests/golden/`.

### 8.2 Map layers

1. **Basemap:** swisstopo light vector style. Toggle to SWISSIMAGE.
2. **Headroom (default layer):** parcels coloured by `headroom_gf_m2` per m² of parcel area. More room means a stronger colour, because the story is "where is room".
   - Parcels with `allowed_today = false` get a distinct hatch.
   - Non-residential zones are shown neutral and grey.
3. **Utilisation (alternative layer):** `utilisation` from 0 to above 1.2.
4. **Zones:** base zoning at low opacity, using the conventional Swiss zoning-plan colours (residential yellows and oranges, core and old-town browns, work zones violet/grey).
5. **Buildings:** 3D extrusion from zoom 16, using `height_m`.
6. **Ghost envelope (signature element):** for the selected parcel, a translucent extrusion of the buildable footprint up to `envelope_height_m`, drawn around the real building. Label: "Hüllkurve (vereinfacht)".
7. **Scenario Δ:** parcels coloured by Δ capacity under the active scenario.
8. **Overlays (P1):** ISOS, heritage, flood hazard, forest, watercourse space.

### 8.3 Panels and interactions (German UI)

**Address search:** geo.admin.ch SearchServer → fly to the parcel and select it.

**Parcel inspector (Parzelle), click on a parcel:**
- address(es) and parcel number;
- zone(s) with share of area;
- a rule table: parameter, value, and a link to the source paragraph;
- a bar comparing existing and allowed floor area, with the optimistic–conservative range;
- the binding rule in plain words (e.g. "Hier begrenzt die Ausnützungsziffer");
- an "allowed today?" badge, worded cautiously ("vermutlich über heutigen Regeln");
- flags and confidence;
- the single-family options (P1);
- "Fehler melden", which in the prototype opens a prefilled mailto or a GitHub issue link.

**Municipality panel (Gemeinde):**
- totals: existing and allowed floor area, headroom in m², dwellings and residents;
- a utilisation histogram;
- binding-constraint shares;
- the scenario sliders with live Δ;
- the blocker ranking chart;
- the top 20 soft sites (P1);
- CSV export.

**Methodology and sources (Methodik & Quellen), a modal or page:**
- every assumption and config default;
- the fitted `existing_to_agf` value;
- rulebook verification status;
- data sources with attribution;
- the disclaimer.

**Required text:**
- Disclaimer (always visible in the footer): "Unverbindliche Schätzung auf Basis öffentlicher Daten. Massgebend sind die rechtskräftigen Pläne und Vorschriften sowie der Entscheid der Baubehörde."
- Attribution: "Quellen: Kanton Aargau (AGIS, ÖREB-Kataster), swisstopo, Bundesamt für Statistik (GWR)", plus others as used.

### 8.4 Language and tone

- The UI is in German, i18n-ready; code and comments in English.
- The owner-facing wording speaks of possibilities, never judgments. Say "Reserve" or "Möglichkeiten", not "unternutzt" or "ineffizient". This tool must not read as pressure on older homeowners.
- Never display anything about who lives in a building or how many people do.

### 8.5 Design direction (brief for the implementing agent)

- **Subject:** Swiss municipal zoning and cadastral plans. **Audience:** homeowners, councillors, developers. **Primary job:** show where the rules allow more than exists, and which rule binds.
- **Signature element:** the ghost envelope over the real building. Spend boldness there; keep everything else quiet and disciplined.
- **Visual cues:** take them from Swiss zoning-plan conventions and cadastral line work (fine parcel lines, a restrained zone palette), not from generic dashboard kits. Avoid the SaaS card grid.
- **Typography:** choose deliberately rather than by default. Use tabular numerals for all figures, and one family or two clearly distinct ones.
- **Quality floor:** keyboard focus visible, colour-blind-safe ramps, reduced motion respected, usable on a phone (the inspector becomes a bottom sheet).
- If a frontend-design skill is available in your environment, apply it.

---

## 9. Repository layout and commands

```text
parcel-potential/
  README.md
  docs/
    SPEC.md                  # this document
    decisions.md             # log of deviations and verified identifiers
    progress.md              # per-milestone notes + screenshots
  etl/                       # Python ≥3.11, managed with uv
    pyproject.toml           # geopandas, shapely>=2, pyogrio, pyproj, rasterio, duckdb (spatial), pydantic, pyyaml, httpx, typer
    src/pp_etl/
      fetch/                 # boundary.py, av.py, nutzungsplanung.py, gwr.py, buildings3d.py, alti.py, oereb.py, overlays.py
      rules/                 # rulebook.schema.json, models.py, extract_llm.py, verify_cli.py
      engine/                # capacity.py, scenarios.py, calibrate.py
      build/                 # join.py, geometry_facts.py, metrics.py, export.py
    rulebooks/AG/4095-brugg.yaml
    config/default.yaml      # all cfg.* defaults from §13
    tests/                   # unit tests + golden runner
  tests/golden/              # shared JSON test vectors (Python + TS)
  web/
    package.json             # vite, typescript, maplibre-gl, @observablehq/plot (optional), vitest
    src/engine/capacity.ts
    src/map/  src/ui/  src/i18n/de.json
    public/data/             # exported prototype data (gitignored except small fixtures)
  data/                      # raw/ and processed/ (gitignored), manifest.json committed
  Makefile                   # make data | make rules-extract | make rules-verify | make build | make test | make web
```

**LLM extraction** (`extract_llm.py`):
- Input: BNO PDFs (text layer; OCR fallback with Tesseract, German model).
- Output: a rulebook YAML draft in which every value has `page`, `section` and `quote`.
- The model is set via an environment variable (default: a current Claude model such as `claude-sonnet-5`). Never hard-code the model or keys.
- For the Brugg prototype it is fine for the agent to do the extraction in-session. But keep this interface, because v1 must run it across about 200 municipalities.

**Verify CLI** (`verify_cli.py`): shows each extracted value next to the source page snippet. The human accepts, edits or rejects; the result writes `verified: true` and `verified_by`.

---

## 10. Milestones

Each milestone ends with an entry in `docs/progress.md` and, from M1 on, screenshots.

| Milestone | Deliverable | Done when |
|---|---|---|
| **M0** Scaffold and fetch | Repo layout; `make data` downloads the boundary, AV, zoning, GWR and 3D tiles for Brugg with a manifest | Re-running is idempotent; all identifiers marked (verify) are resolved in `decisions.md` |
| **M1** Join and inspect | Parcels, zone parts, buildings with heights, GWR joined; a raw QA map page | Over 95% of GWR residential buildings in Brugg are matched to a footprint and parcel |
| **M2** Rulebook | BNO documents collected; LLM draft; verify CLI; Stephan verifies | Every residential zone has all P0 params with provenance; schema passes |
| **M3** Engine | Python engine, calibration, golden tests (at least 15 cases), exports | Tests green; the calibration value is reported |
| **M4** Map and inspector | Headroom layer, 3D buildings, ghost envelope, inspector, "allowed today?" layer | The 5 QA locations in §11 look right |
| **M5** Scenarios and policy | TS engine mirror (golden tests green), sliders, blocker ranking, municipality panel, CSV export, methodology page | Scenario totals equal the Python output for the same scenario |
| **M6** P1 items | Single-family options, overlays, soft-site score, Schinznach-Bad, station predicate, one-pager | As scoped |

---

## 11. Validation and acceptance

1. **Rulebook:** 100% of residential-zone parameters verified by a human, with provenance. Spot-check 5 values against the ÖREB extract of the corresponding parcels.
2. **Golden tests (at least 15)** must include:
   - a single-zone AZ-bound parcel;
   - an envelope-bound parcel;
   - a multi-zone parcel;
   - a discretionary zone;
   - an over-built ("not allowed today") parcel;
   - a Gestaltungsplan parcel (flag only);
   - a scenario with ΔAZ and Δstoreys;
   - the bonus switched on;
   - a parcel with an SDR overlap.
3. **Hand check:** 10 random residential parcels computed by hand from the BNO and the parcel area. The engine must agree within ±5% for AZ-bound cases.
4. **Sanity checks:**
   - The count of residential buildings equals the GWR count for Brugg within ±2%.
   - Buildings completed in 2019 or later have a median utilisation between 0.8 and 1.1 (after calibration). Outliers are listed and explained (bonuses, Gestaltungspläne, errors).
   - Headroom on unbuilt residential parcels is of the same order of magnitude as the Bauzonenstatistik reserve for Brugg.
5. **Visual QA locations:**
   - the old town (expect `discretionary` and heritage flags);
   - a 1960s–80s single-family street on the Bruggerberg slope (expect headroom and a slope flag);
   - a recent multi-family development (expect utilisation around 1);
   - a Hochhausstandort (flag);
   - the Zone Campus (non-residential).
6. **Honesty:** every headline number in the UI links to its assumptions.

---

## 12. Pitfalls and known unknowns

- **Brugg's amendment history.** The BNO has been amended several times, with partial approvals after appeals. Don't assume a single PDF is the whole truth; build the consolidated rulebook with per-parameter sources (§4).
- **Scanned PDFs.** Some amendment documents are scans with poor OCR, so re-OCR them. LLM output must quote the source text so a human can check it.
- **Definitions of aGF and aGSF.** AZ uses Aargau's definition of anrechenbare Geschossfläche. The existing floor area estimated from footprint × storeys, or from GWR dwelling area (which is net living area), is not the same quantity. Hence the calibration step (§7.3) and the two existing-floor-area estimates.
- **Heights and terrain.** Heights are measured from the relevant terrain (massgebendes Terrain), which matters on slopes (Bruggerberg). The prototype ignores this and flags slopes.
- **Setback orientation.** The side that gets the large boundary distance is unknown, hence the optimistic/conservative range.
- **Special regimes.** Gestaltungspläne, Arealüberbauung bonuses, Hochhausstandorte and planning zones override or modify the base rules. The prototype flags them and does not model them.
- **SDR parcels** (building rights) overlap Liegenschaften. Don't double-count land.
- **Condominiums** (Stockwerkeigentum) are not visible in open data, although fragmented ownership often blocks redevelopment in practice. Say so on the methodology page.
- **Capacity is not supply.** Headroom is a theoretical maximum under current rules, not a forecast of construction. Say so wherever totals appear.
- **Licensing:** attribution is required for all sources. Respect ÖREB rate limits. Cache everything.
- **Privacy:** no owner data, no person-level occupancy, no scraping of listings or the land register.

---

## 13. Decisions with defaults (proceed with these; Stephan may override)

| ID | Decision | Default |
|---|---|---|
| D1 | Territory | Brugg incl. Umiken and Lauffohr; Schinznach-Bad in P1 (include in P0 only if its rulebook takes under a day) |
| D2 | Languages | German UI, English code |
| D3 | `gf_per_dwelling_m2` | 100 (gross floor area per new dwelling) |
| D4 | `gf_per_resident_m2` | 55 (gross; about 46 m² net living area per person × 1.2) |
| D5 | `storey_height_m`, `attika_factor` | 3.0 m; 0.6 of a full storey where an attic or set-back top storey is allowed and the BNO doesn't specify |
| D6 | `envelope_to_agf`, `net_to_gross` | 0.9; 1.25 |
| D7 | `existing_to_agf` | 1.0 before calibration; fitted per §7.3 |
| D8 | Tolerances | `tol_gf` 0.10; `tol_height_m` 1.0 |
| D9 | Headline setback | Optimistic (small boundary distance on all sides), with the conservative range shown |
| D10 | Hosting | Local only until Stephan reviews; then static hosting (e.g. GitHub Pages) |
| D11 | Backend | None |
| D12 | LLM for extraction | Configured by environment variable; default a current Claude model |

---

## 14. Glossary

| Term | Meaning |
|---|---|
| aGF (anrechenbare Geschossfläche) | Floor area that counts towards the AZ; defined in the cantonal building ordinance |
| aGSF (anrechenbare Grundstücksfläche) | Parcel area that counts as the base for the AZ |
| Arealüberbauung | Coordinated development of a larger area, often with a density bonus |
| AV (amtliche Vermessung) | Official cadastral survey: parcels, building footprints |
| AZ (Ausnützungsziffer) | Floor area ratio: aGF ÷ aGSF |
| BauG / BauV | Aargau building act / building ordinance |
| BFS (Bundesamt für Statistik) | Federal Statistical Office; also the source of municipality numbers |
| BNO (Bau- und Nutzungsordnung) | Municipal building and zoning ordinance |
| EGID / EGRID / EWID | Federal identifiers for building / parcel / dwelling |
| Einwohnerrat | Municipal parliament (Brugg has one) |
| ES (Empfindlichkeitsstufe) | Noise sensitivity level of a zone |
| ETL | Extract, transform, load: the data pipeline |
| FH / GH (Fassadenhöhe / Gesamthöhe) | Façade height / total height (IVHB terms) |
| GA (Grenzabstand) | Boundary distance (setback); "klein" (small) and "gross" (large) variants |
| Gestaltungsplan | Special-use plan that can override base zoning for an area |
| GWR (Gebäude- und Wohnungsregister) | Federal building and dwelling register |
| GZ (Grünflächenziffer) | Minimum green-space ratio |
| ISOS | Federal inventory of Swiss heritage townscapes (Bundesinventar der schützenswerten Ortsbilder der Schweiz) |
| IVHB | Intercantonal agreement harmonising building terms |
| LV95 | Swiss national coordinate system (EPSG:2056) |
| ÖREB (Kataster der öffentlich-rechtlichen Eigentumsbeschränkungen) | Cadastre of public-law restrictions on land ownership |
| ÖV-Güteklasse | Public-transport quality class of a location (A best to D) |
| PMTiles / GeoParquet | Single-file vector-tile archive / columnar geodata format |
| SDR (selbständiges und dauerndes Recht) | Independent, permanent right, e.g. a building right, registered as its own "parcel" |
| STAC | SpatioTemporal Asset Catalog: the download API of data.geo.admin.ch |
| Stockwerkeigentum | Condominium ownership |
| ÜZ (Überbauungsziffer) | Site coverage ratio |
| VG (Vollgeschoss) | Full storey |
