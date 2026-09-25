# Playbook: adding a municipality

Hard-won knowledge from Brugg (incl. merged Ortsteile) and Windisch. Follow it, but the **checks** at
each step are the point: every rule of thumb here was derived from two Aargau municipalities and can fail
elsewhere. When a check fails, investigate; do not tune thresholds until it passes.

Effort observed (agent wall-clock is not tracked; relative only): Windisch was quick (twin BNO of Brugg);
Villnachern took noticeably longer because of the document hunt and a differently structured BNO. The slow
parts are finding the valid BNO and reading its table legend, not the pipeline.

## 0. Before you start

- **Merger history.** `uv run pp boundaries <Name>` lists swissBOUNDARIES3D versions. Each area change is a
  merger or boundary change. The current version has id `<bfs>` (no year); older ones are `<bfs>-<year>`.
  Merged former municipalities usually keep their own BNO for years → one *planning perimeter* per old BNO.
  Brugg 2026 = Brugg/Umiken/Lauffohr (`4095-2019`) + Schinznach-Bad (2020) + Villnachern (2026).
  - Check: news search "<Gemeinde> Fusion" for the effective date; GWR PLZ/locality names inside the BFS
    number confirm which Ortsteile are included.
  - Limit: the name search in swissBOUNDARIES3D is exact (`contains=false`). Names with a canton suffix
    (e.g. "Buchs (AG)") must be written exactly as in the dataset.
- **Canton data availability.** `https://geodienste.ch/info/services.json?cantons=<XX>&language=de` shows
  per topic whether data is "Frei erhältlich". For AG: AV, Nutzungsplanung, statische Waldgrenzen are open;
  Waldabstandslinien are "keine Daten". Other cantons differ; check before assuming.

## 1. Territory file

`etl/territories/<canton>/<bfs>-<name>.yaml`. Copy an existing one. Rules:
- **Perimeter ids must be globally unique** (the browser merges territories; zone keys are
  `<perimeter>/<code>`; the loader throws on collisions). Use the (old) municipality name, e.g. `villnachern`.
- Perimeters are evaluated in order; each is clipped to what the previous ones did not cover. List the
  oldest core first, then add the merged parts using the boundary version that *adds* them.
- A perimeter without `rulebook` is shown as "noch nicht erfasst" (text only; no map shading).

## 2. Find the BNO

**First choice: the ÖREB extract.** `uv run pp oereb-docs <territory> [--perimeter <id>] [--egrid <EGRID>]`
lists the legal documents the cantonal ÖREB cadastre links for one parcel (picks a residential parcel in
the perimeter if no EGRID is given). The "Bau- und Nutzungsordnung" entry points to oereblex
(`https://oereblex.ag.ch/api/attachments/<n>`), the legally binding document.
- Check the cover page: the oereblex copy is often the signed "Exemplar für die Genehmigung" (a scan; the
  approval stamp may be illegible → mark the date `(verify)`), or a single amendment rather than the full BNO.
- **After mergers the list can be misleading.** For a Schinznach-Bad parcel it listed Brugg's 2023
  amendment (attachment 10420), not Schinznach-Bad's own BNO. Verify title and scope before using a document.
- Several BNO entries = base BNO + Teiländerungen. Read all; newer ones override.

**Second choice: municipal websites** (consolidated "Stand …" versions, easier to read). Search
`<Gemeinde> Bau- und Nutzungsordnung BNO PDF`; files are usually under `/public/upload/assets/…`.
- Watch for **Rückweisungen / Teilgenehmigungen / Übergangsbestimmungen** (Brugg: § 24 Arbeitszone II not
  approved, old 2003 BNO still applies). They are often separate PDFs next to the BNO.
- Websites of merged municipalities decay: villnachern.ch (2026) serves the CMS provider's TLS certificate →
  curl fails; do not bypass certificate checks for legal sources.
- **brugg.ch blocks scripted access** (403, then the whole site for the IP, also in the browser). Do not
  crawl municipal sites; fetch single PDFs only, and prefer oereblex.

Then:
- Save the PDF under `data/raw/documents/<canton>-<bfs>/` and reference it as `local_path` in the rulebook
  (the verify CLI shows page context from it).
- Check the text layer: `from pp_etl.rules.extract_llm import pdf_text`. Empty or garbled → OCR first
  (`ocrmypdf -l deu`). Villnachern's scan has a usable text layer, but letters are misread ("VV2a" for "W2a",
  "0E" for "OE") — quote as extracted, interpret in notes.

## 3. Read the zone table (Aargau)

Most Aargau BNOs follow the cantonal model (Muster-BNO): **§ 13 "Übersicht und Baumasse"** with columns
Vollgeschosse | Ausnützung(sziffer) | Grünflächenziffer | Gesamthöhe (sometimes Fassadenhöhe) |
Grenzabstand klein | gross | Empfindlichkeitsstufe | BNO §.
- **Read the legend paragraphs under the table every time; symbols differ between BNOs.** Brugg/Windisch:
  `*` = set by the authority case by case. Villnachern: `*` = "Richtwert" (guideline, deviations allowed),
  `**`/`'` = conditional AZ. Map accordingly (`null` + note; zone `discretionary` if its core measures are open).
- `-` = no density figure to respect → `az_max: null` (envelope-only zone). **These zones inflate reserves**
  (see decisions #27); cap confidence and note it.
- Text extraction splits zone names across lines ("Wohn- und Ar- beitszone 2"). Quote the row as extracted
  and add the column header to the quote so a reviewer can read it.
- Look for these paragraphs; they change the arithmetic:
  - **AZ exclusions** (Brugg/Windisch § 74: "Dach-, Attika- und Untergeschosse werden bei der
    Ausnützungsziffer nicht angerechnet") → `definitions.az_counts_attika_dg: false`. If absent, `true`.
  - **Closed construction** ("offene wie auch die geschlossene Bauweise zulässig") →
    `definitions.geschlossene_bauweise_zulaessig: true` (enables party-wall setbacks).
  - **Bonuses**: EG publikumsorientiert (+0.1 AZ, often WA zones only), Arealüberbauung (+1 Geschoss).
  - Special overlays with text rules (Nachverdichtung, Hochhausstandorte) → `flags_from_text` with quote.
  - How heights are measured (Windisch: Gesamthöhe to top of roof substructure) → note on the param.
  - **Conditional AZ** (Villnachern: higher AZ only with ≥ 2/3 dwelling units) → base AZ = lower value,
    the higher one as a bonus (`az_delta`, `default_on: false`) with the condition in the label.
  - **Zone exceptions to closed construction** (Villnachern: not in E2/E2a) → zone-level
    `geschlossene_bauweise: {value: false, …}` overrides the rulebook-wide definition.
  - Percentage bonuses (Villnachern Arealüberbauung "bis max. 15 %") → `az_delta` = 15 % × base AZ, note it.
  - Not modelled (note them): Fassadenhöhe (engine uses storeys + Gesamthöhe), Einliegerwohnung bonus.
- Cantonal law (applies unless the BNO says otherwise; canton file `etl/config/cantons/AG.yaml`):
  Waldabstand 18 m (BauG § 48 Abs. 1 lit. c), Untergeschoss definition BauV § 23 (floor above ≤ 0.8 m on
  average above the façade line), Attika/Dachgeschoss per IVHB/BauV (attic assumed allowed; unverified).
- Not every municipality follows the model. Zürich-style or older BNOs may use Baumassenziffer,
  Überbauungsziffer or Gebäudehöhe instead of AZ. The engine supports AZ, ÜZ, VG, GH; anything else needs
  an engine extension (both Python and TS, plus golden cases) — do not squeeze it into the wrong field.

## 4. Write the rulebook

`etl/rulebooks/<canton>/<bfs>-<name>.yaml` (one per planning perimeter). The generator scripts used for
Brugg/Windisch were throwaway; copy the structure of an existing rulebook. For a new BNO the LLM extractor
drafts it (`make rules-extract PDF=… OUT=…`, needs API credentials and costs money; ask first).
- `match.typ_kommunal_code`: **codes are only unique within a municipality** (112101 is W2 in Brugg,
  Einfamilienhauszone E2 in Villnachern). Get them with `uv run pp zones <territory>`.
- Every building zone needs an entry, including non-residential ones (work, public, Familiengarten,
  special zones). National main-use codes: 11–15, 17 = buildable → must be mapped; 16 (green/water in
  building zone) and 18 (traffic) need no entry.
- Codes may carry misleading labels ("Strasse" coded as 1211 in Windisch). Map by code, note the oddity.
- Optional but helpful: add non-buildable zones inside the building area (16xx Grünzone/Freihaltezone) as
  non-residential entries with a note quoting their rule (e.g. Windisch § 31: Familiengärten allowed). The
  inspector then explains parcels that are partly green zone.
- Everything starts `verified: false`. Only `pp rules verify` sets it.
- `uv run pp rules validate` must pass.

## 5. Build and check

```bash
uv run pp build <territory>     # first run downloads canton-wide data once (~1 GB for AG)
uv run pp zones <territory>     # UNMAPPED list must be empty for covered perimeters
uv run pp qa <territory>        # rules of thumb; inspect every WARN
make test                       # golden + Python↔TS parity for all built territories
```
Then look at the map. The checks that caught real bugs so far:

| Symptom | Cause found | Fix now in pipeline |
|---|---|---|
| Existing floor area 5–10× dwelling area | Terraced houses / garage podiums: footprint × GWR storeys | dwelling-area fallback (`existing_alt_ratio_max`) |
| Row houses "not allowed today" en masse, allowed ≈ 0 | uniform setback on shared walls | party walls exempt when closed construction allowed |
| Many "unbuilt" long thin residential parcels | streets zoned like the adjacent zone | `infrastructure` via AV land cover |
| Construction site shows as empty | GWR GSTAT 1001–1003 were ignored | projects counted/flagged |
| Huge reserve on a recent Gestaltungsplan development | envelope-only zone + GP | **not fixed** (improvements §6) — inspect top parcels |
| Height exceedances on slopes | heights not measured from relevant terrain | no height check on slope-flagged parcels |
| New building missing / parcel "empty" although built | AV survey lags GWR (new buildings only as projected footprints) | AV/GWR reconciliation (`lcsfproj`, GWR status) |
| Terraced houses on steep slopes > AZ | Untergeschosse excluded from AZ | **not modelled** (improvements §4) |

Also do a spot check with local knowledge where possible; Stephan knows parts of Brugg and Windisch well.

## 6. Data-source quirks (keep in mind)

- **geodienste.ch OGC API** requires `crs=…/EPSG/0/2056`; bbox filtering is unreliable and attribute filters
  unsupported → the pipeline uses canton GeoPackages (`fetch/geodienste.py`, topics `av`,
  `npl_nutzungsplanung`, `npl_waldgrenzen`). The same URL pattern works for other cantons.
- **swissBUILDINGS3D 3.0**: FileGDB = geometry only; attributes (EGID, DACH_MAX, GELAENDEPUNKT) only in the
  **CityGML** edition. STAC items per 1:25k sheet and year; take the newest per sheet; skip national mosaics.
- **GWR** (`public.madd.bfs.admin.ch/<canton>.zip`): building has EGRID; GSTAT 1004 = existing,
  1001/1002/1003 = projected/approved/under construction, 1007 = demolished; dwellings WSTAT 3004 = existing.
- **SearchServer** (address search): `bbox` works only in LV95 with `sr=2056` and ranks rather than filters.
- **Zoning slivers**: neighbour zones leak along municipal borders → dropped if < 50% inside and < 500 m².
- **Browser checks**: the Chrome tab used for automation is often hidden → MapLibre never renders.
  Open with `?raf=timeout`. Hash-only URL changes do not reload the page (add a dummy query param).

## 7. External links

Per-parcel links (ÖREB extract PDF, cantonal map viewer, map.geo.admin.ch) are URL templates in
`etl/config/cantons/<XX>.yaml` (`links`, placeholders `{egrid}`, `{e}`/`{n}` in LV95, `{lat}`/`{lng}` in WGS84). For a new canton,
find its ÖREB service (cadastre.ch lists cantonal endpoints) and its viewer's URL format (open the viewer,
use its share button, read the URL). AG Online Karten: `?center=<E>,<N>&z=<zoom>`.

## 8. After adding

- `make build-all`, `make test`, commit.
- Add the municipality to README "covers", and a line to `docs/decisions.md` (what was different).
- If something in this playbook was wrong or missing, fix the playbook in the same commit.
