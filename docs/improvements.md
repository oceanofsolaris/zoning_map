# Plan for improvements

Backlog of agreed improvements that are not built yet. Newest first.

## 1. Headline as a range (agreed, backburner)

The headline reserve uses optimistic setbacks (small boundary distance on all sides): 523k m² aGF for
Brugg/Umiken. With conservative setbacks it is 341k m². Show both everywhere a total appears
("341'000–523'000 m²"). Colour the map by the lower bound, or offer a toggle.

- Engine already returns `gf_allowed_opt_m2` / `gf_allowed_con_m2`; add `headroom_con_m2` and sum both.
- Municipality panel, blocker ranking and CSV: report the range.

## 2. "Realistisch mobilisierbar in ~20 Jahren" (agreed, backburner)

A second measure next to the legal zoning capacity. It weights each parcel's reserve by how likely it is
to be used within ~20 years:

| Category | Why |
|---|---|
| Unbuilt parcels | Highest; still slowed by land hoarding |
| Replacement candidates (low utilisation, building older than ~50 years) | Renewal cycle; most single-family reserve is only reachable this way |
| Extension/Aufstockung (reserve fits the existing structure) | Small chunks, owner-driven |
| Buildings < 25 years, likely condominiums (MFH ≥ 4 flats since 1965), heritage | ≈ 0 |

- Calibrate the weights on observed construction in Brugg since ~2000. GWR has the construction year
  (`GBAUJ`) and demolitions (`GABBJ`); record per category which parcels were actually redeveloped.
- Report "years of construction at the historical pace". Brugg/Umiken added roughly 88k m² aGF per decade
  over 1996–2025, so the reserve lasts ~4–6 decades.
- Reference case: Frickermattenstrasse 7a/7b realised ≈ the maximum AZ, seven years from planning to start.

## 3. Single-family options (spec §7.5, P1)

Aufstockung / Anbau / Einliegerwohnung / Ersatzneubau per single-family parcel. This makes visible that
most reserve on single-family parcels needs a replacement building.

## 4. Other open items

- Grünflächenziffer as an envelope constraint (footprint ≤ (1 − GZ) × aGSF − access/parking).
- Baulinien (AGIS Erschliessungspläne), Planungszonen flag, ISOS overlay.
- Rulebooks for Schinznach-Bad and Villnachern.
- PMTiles + GeoParquet delivery.
