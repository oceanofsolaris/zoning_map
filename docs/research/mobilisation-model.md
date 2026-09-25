# From zoning capacity to expected housing supply

**A research design for estimating how much of a municipality's zoning reserve is mobilised, and how rule changes shift it**

Draft v0.1, 25 September 2026. Status: for review by Stephan before any implementation.
Scope: Kanton Aargau (pilot: Brugg incl. Umiken/Lauffohr/Villnachern, Windisch), designed to scale canton-wide.

---

## 0. Summary

**Problem.** The tool currently reports *zoning capacity*: allowed floor area minus existing floor area. For
Brugg/Umiken that is ≈ 500,000 m² aGF, or ≈ 4,300 dwellings, which is several times the city's existing
housing stock growth over decades. As a basis for policy ("what does AZ +0.1 in W2 buy us?") it is
misleading, because capacity says nothing about *whether and when* it is used. Swiss practice acknowledges
this only through flat factors (Stadt Zürich multiplies capacity by an "Ausbaugrad" of 85 %) or qualitative
availability surveys (Raum+). No published Swiss model links parcel-level rules to time-resolved expected supply.

**Proposed estimand.** For horizon *H* (10/20 years) and rule set *R*: the expected net additional dwellings
E[ΔU(H; R)] with an uncertainty interval, and above all the **policy effect** E[ΔU(H; R′)] − E[ΔU(H; R)] of
a rule change. The tool should say things like *"with current rules ≈ X–Y additional dwellings are expected
in Brugg by 2045 (of ≈ 4,300 theoretically possible); AZ +0.1 in W2 adds ≈ a–b of them"* (numbers to be
estimated; placeholders here and in §9 are illustrative only).

**Preliminary evidence from data already in this repository** (§4, all numbers provisional):
- Annual demolition rates of residential buildings in Aargau (2020–2025) are low and strongly age-dependent:
  single-family houses built before 1960 ≈ 0.44 %/year, 1961–70 ≈ 0.29 %, 1971–80 ≈ 0.11 %, after 1980 ≈ 0.02 %.
- When a parcel is redeveloped, the number of dwellings rises ≈ 3.6× on average (≈ 4.6× on former
  single-family parcels).
- Recent new buildings use their allowance in a U-shape over parcel size: ≈ 0.88 on small parcels
  (row houses), **≈ 0.5–0.6 on 400–900 m² parcels** (new single-family houses), ≈ 0.85–0.95 on large parcels.
- New apartments are larger than the tool assumes: 96 m² net ≈ 120 m² aGF per flat (tool: 100 m²).
- A naive replacement-only projection for Brugg/Umiken predicts ≈ 14 new dwellings/year; ≈ 65/year were
  actually added in 2015–2024. The gap decomposes into **channels the naive model ignores**: dwellings added
  inside existing buildings (43 %), development in zones treated as non-residential or discretionary (≈ 35 %,
  e.g. public-building zone, old town), and a few large projects (19 projects with ≥ 10 flats = 70 % of volume).

**Proposed model** (§5–6): a *multi-channel* supply model. Each channel has an event hazard (does something
happen on this parcel/site in year *t*?) and an intensity model (how many dwellings if it does?):
(A) large sites, (B) additions and conversions in existing buildings, (C) redevelopment of built parcels,
(D) first development of vacant parcels. Hazards are discrete-time complementary log-log models with
building-age baselines, parcel, market and regulatory covariates, and municipality/year random effects.
Intensity combines a typology choice (single-family / row / apartment block) with a typology-specific
utilisation model, then converts floor area to dwellings and persons. **Rules enter through the economic
value of the reserve**, so a rule change shifts both hazard and intensity. That elasticity is the
parameter that matters for policy. It is identified from staggered BNO revisions across Aargau
municipalities (event study / difference-in-differences) and zone-boundary comparisons, and cross-checked
against Büchler & Lutz (2024) for Kanton Zürich.

**Work plan** (§10): ≈ 9 months full-time equivalent, thesis-sized. The critical path is reconstructing
historical zoning rules (for identification) and a consistent event history (GWR demolition records are
only complete from ≈ 2020). Validation (§8) uses temporal and municipal hold-outs, calibration plots and
back-tests of past revisions, and is benchmarked against the flat-factor methods used in practice.

---

## 1. Motivation and use cases

The tool serves three audiences (spec §1). Each implies requirements on a "realistic supply" measure:

| Use case | Question | Requirement |
|---|---|---|
| 1. Citizens exploring scenarios | "What would AZ +0.1 in W2 change?" | Direction and rough size right; understandable wording; honest uncertainty |
| 2. Policy makers (Einwohnerrat, Stadtrat, planning) | "How much housing would this BNO revision add in 10–20 years? Which lever is most effective?" | **Directionally correct deltas between rule sets**; comparable across municipalities; documented method that could survive peer review |
| 3. Homeowners | "Should I densify when I retire or sell?" | Feasibility and options for *their* parcel, not a probability that they will act |

Design consequences:
- The central output is a **difference between scenarios**, not a level. Errors that are common to both
  scenarios (e.g. overall market conditions) partly cancel, which makes the policy use case more robust
  than forecasting levels.
- Horizons of 10 and 20 years match planning cycles (a BNO revision is expected every ≈ 15 years).
- Per-parcel probabilities of redevelopment are sensitive: they can read as pressure on (often elderly)
  owners, which the spec (§8.4) rules out. They are estimated internally but shown only aggregated. For
  individual parcels, the tool shows categories ("parcels like this are rarely redeveloped before …").

---

## 2. Estimands

For parcel *i*, year *t*, rule set *R*:

- *K*(i, R): allowed aGF under R (existing engine).
- *S*(i, t): existing aGF and dwellings.
- Channels *c* ∈ {A large sites, B additions/conversions, C redevelopment, D vacant infill}.
- Hazard h_c(i, t | R): probability that an event of channel *c* starts on *i* in year *t*.
- Intensity: if an event happens, net added dwellings ΔU_c(i | R) (random, with distribution).

Expected net additional dwellings over horizon H:

  E[ΔU(H; R)] = Σ_i Σ_c Σ_{t=1..H} P(no prior event on i before t) · h_c(i, t | R) · E[ΔU_c(i | R)]

(with lags between event start and completion, and a cap of one major event per parcel in the horizon).

Policy effect of changing R → R′: τ(H) = E[ΔU(H; R′)] − E[ΔU(H; R)], reported with a posterior
predictive interval. Persons: dwellings × expected occupancy by dwelling size (§6.5).

---

## 3. Literature review

### 3.1 Swiss practice: capacity accounting without behaviour

- **Stadt Zürich, BZO revision, "Kapazitäts- und Reserveberechnung" (KAREB).** Capacity = aGSF × AZ plus
  attic (0.65 of an average full storey) and, in hillside zones, basements (0.6 of a storey in W2b). The
  result is multiplied by an **"Ausbaugrad" of 85 %** "für das nicht vollständige Ausschöpfen der zulässigen
  Ausnützung … (z.B. ungünstige Parzellenform, Baubeschränkungen, Wirtschaftlichkeit)". Core zones and zones
  for public buildings are assumed to be at capacity. The report states that the reserve is used "über einen
  langen Zeitraum in Abhängigkeit von der wirtschaftlichen Situation"; **there is no time dimension.**
  *Relevance:* the de-facto Swiss standard is a flat intensity factor. Our §4.3 evidence suggests the factor
  is strongly typology-dependent (0.5–0.95).
- **Kanton Zürich, Raumbeobachtung.** Annual floor-area reserve monitoring. The "Ausbaugrad" (built ÷
  allowed) of residential and mixed zones was reported at 66 % for 2009. This is a stock measure, not a flow.
- **Raum+ (ETH Zürich, Professur für Raumentwicklung; Swiss-wide estimates 2012, 2017).** Parcel-level
  inventories of reserves built with municipalities, classifying Innenentwicklungspotenziale, Baulücken,
  Aussenreserven, and recording obstacles ("Hemmnisse") and owner interest. Reported headline: about 30 % of
  inner potentials and building gaps are available without obstacles; the most frequent obstacle is **lack
  of owner willingness**. *Relevance:* the closest Swiss evidence on mobilisability, but qualitative and
  cross-sectional (no hazard rates, no rule elasticities).
- **ARE, "Nutzungsreserven im Bestand – Konzeptstudie".** Methodological groundwork for estimating floor-area
  reserves in the existing stock nationwide (e.g. from building-insurance volumes); discusses reserves that
  are only partially mobilisable (parcel shape/size).
- **Statistik Stadt Zürich, Ersatzneubau statistics.** 100 demolished dwellings are replaced by ≈ 161 new ones
  (floor area roughly doubles); the share of new dwellings coming from replacement construction rose from
  17 % (2000–04) to 55 % (2020–24). *Relevance:* a benchmark for our replacement multiplier (Aargau ≈ 3.6,
  consistent with lower initial density).
- **Single-family neighbourhoods.** MetamorpHouse (Beyeler; Age-Stiftung) and EspaceSuisse guidance document
  that densification in EFH areas hinges on owners' life stages (generational change, older owners in large
  houses). The Federal Office for Housing (BWO) announced a national study on EFH neighbourhoods
  (results expected end 2026) — **a possible data partner and a benchmark to watch.**

**Gap.** Swiss practice converts capacity to "realistic capacity" with flat factors or surveys. There is no
estimated, validated model of *when* reserves are used, nor of how *rule changes* shift the timing.

### 3.2 Empirical effects of upzoning

- **Büchler & Lutz (2024), J. Urban Economics 143** — Kanton Zürich, 25 years of land-use relaxations.
  Increasing the allowed FAR raises living space and dwellings by **≈ 9 % within 5–10 years** in upzoned areas,
  more for larger upzonings and where zoning was binding, with positive spillovers to adjacent areas, and
  no measurable local hedonic rent effect. *Relevance:* the closest external estimate of the elasticity we need,
  in the same institutional setting. It serves as a prior and a validation target.
- **Greenaway-McGrevy & Phillips (2023), J. Urban Economics 136** — Auckland's 2016 Unitary Plan upzoned ≈ ¾
  of residential land. Permits rose strongly in upzoned areas; the design accounts for displacement from
  non-upzoned areas. *Relevance:* methodological template for separating new supply from displacement.
- **Freemark (2020), Urban Affairs Review** — Chicago transit-oriented upzoning: land prices rose, no
  measurable short-run increase in construction (from memory; verify before citing). *Relevance:* effects can be slow and absent in the short run.
  The horizon matters.

### 3.3 Economics of redevelopment

- Redevelopment as an **option**: land with an existing building is redeveloped when the value of the
  best new use, net of construction and demolition cost, exceeds the value of the current use (Capozza &
  Helsley 1989; Rosenthal & Helsley 1994; Munneke 1996). Uncertainty makes it optimal to wait (real-options
  value), so redevelopment lags the moment it first becomes profitable.
- **Teardowns**: Dye & McMillen (2007) model demolition probability in Chicago. Prime candidates are
  small, old houses near transit, and teardown prices approximate land value. McMillen & O'Sullivan (2013)
  estimate a hazard of time to demolition after sale. Clapp & Salavei (2010) value the redevelopment option
  in hedonic prices.
- **Building age cycles**: Brueckner & Rosenthal (2009) link neighbourhood change to the age of the housing
  stock. This matches our strong age gradient (§4.1).

*Relevance:* motivates a hazard driven by (i) the **value of the reserve** (capacity × price − cost),
(ii) the **value of the existing structure** (age, size, condition), (iii) frictions (ownership, owner life
stage, regulatory risk). Rules enter through (i).

### 3.4 "Realistic capacity" in planning practice elsewhere

- **California housing elements.** Cities must show sites for their housing targets. In the 2003–2014 cycle,
  local governments permitted only about 47 % of the housing they had planned for, which motivated rules
  requiring a "realistic" capacity. Monkkonen, Elmendorf and co-authors propose estimating
  **site-level development probabilities from data**, which is the approach proposed here.
- **Seattle OPCD, zoned development capacity**: parcels count as redevelopable when existing development is
  below 40 % of the allowed amount. A threshold heuristic; our evidence suggests a smooth hazard instead.
- **UrbanSim** (Waddell 2002): parcel-level pro-forma developer model inside an integrated land-use model.
  A structural alternative; data-hungry (prices, costs) and hard to validate. We borrow the pro-forma idea
  for the homeowner module (§9), not for the aggregate forecast.
- **Parcel geometry**: recent Auckland evidence shows that parcel shape limits how much zoned capacity is
  valued and realised. This supports geometry features in the intensity model.

### 3.5 What exists, and what we contribute

| Need | Existing | Gap we address |
|---|---|---|
| Capacity by parcel | Zürich KAREB, Kanton ZH, Raum+, this tool | — |
| Intensity of realisation | flat 85 % (Zürich) | typology- and parcel-dependent intensity, estimated |
| Timing / probability of use | qualitative (Raum+), thresholds (Seattle) | estimated hazards by channel, validated |
| Effect of rule changes | Büchler & Lutz (ZH, aggregate areas) | parcel-level elasticity for AG; scenario tool |
| Transparent, reproducible, open data | rare | full open-data pipeline, open code |

**No existing model can be adopted as is.** Büchler & Lutz provide the elasticity benchmark but no
parcel-level predictive model; Raum+ provides obstacle categories but no rates. The contribution is a
validated, open, parcel-level, multi-channel model for Switzerland.

---

## 4. Preliminary evidence from this repository's data

All numbers come from the Aargau GWR public extract (September 2026) and the processed Brugg/Windisch data.
They were produced with exploratory scripts (not committed). They are **indicative only**: definitions
will be refined in phase 2 (§10).

### 4.1 Demolition hazard by building type and age (Aargau, 2020–2025)

Annual demolitions ÷ standing stock, residential buildings (GKAT 1020/1030/1040), construction year from
`GBAUJ`, else the midpoint of the period code `GBAUP` (2 % missing both):

| Built | EFH (single-family) | ZFH (two-family) | MFH (multi-family) |
|---|---|---|---|
| < 1919 | 0.42 % | 0.39 % | 0.21 % |
| 1919–45 | 0.44 % | 0.44 % | 0.25 % |
| 1946–60 | 0.45 % | 0.38 % | 0.67 % |
| 1961–70 | 0.29 % | 0.20 % | 0.18 % |
| 1971–80 | 0.11 % | 0.11 % | 0.07 % |
| 1981–90 | 0.03 % | 0.03 % | 0.01 % |
| after 1990 | ≈ 0.01–0.02 % | ≈ 0.00–0.06 % | ≈ 0.01 % |

All EFH: 0.18 %/year (≈ 108,000 buildings, 1,173 demolitions in 6 years). Two caveats:
- **Recording break:** demolitions recorded per year jump from ≈ 400 (2018) to ≈ 1,000 (2020) and stay
  there. This is almost certainly improved recording, not a real surge, so pre-2020 GWR demolition counts
  cannot be used for hazards without correction (§7.2).
- Demolition is only one channel. Aufstockungen, extensions and conversions do not appear here.

### 4.2 What replaces demolished buildings

Parcels (EGRID) with a residential demolition 2020–2024: for 82 % a new residential building is already
recorded (existing or projected). Dwellings after ÷ before: **3.6** in total (median per parcel 2.5); on
former single-family parcels **4.6**. For comparison, Stadt Zürich reports 1.61, starting from a much denser stock.

### 4.3 How much of the allowance new buildings use

Utilisation (calibrated existing aGF ÷ allowed aGF) of parcels whose main building dates from 2005 or later,
Brugg + Windisch, n = 322:

| Parcel size | n | median | IQR |
|---|---|---|---|
| < 400 m² | 101 | 0.88 | 0.76–1.02 |
| 400–600 m² | 67 | 0.62 | 0.49–0.83 |
| 600–900 m² | 61 | 0.52 | 0.40–0.71 |
| 900–1,500 m² | 37 | 0.88 | 0.59–1.03 |
| 1,500–3,000 m² | 29 | 0.83 | 0.60–0.97 |
| > 3,000 m² | 25 | 0.94 | 0.82–1.09 |

Interpretation: intensity depends mostly on **which typology gets built**. Mid-size parcels are often
rebuilt as single-family houses that do not use the AZ. Small parcels (row houses) and large parcels
(apartment blocks by developers) use it nearly fully. A flat 85 % factor overstates single-family parcels
and understates developer sites. The AZ was binding for 93 % of these new builds.

### 4.4 Dwelling sizes of new construction (Aargau, built since 2015)

Mean net dwelling area: MFH 96 m² (median 3 rooms), ZFH 135 m², EFH 178 m². With the tool's
net-to-gross factor 1.25, an MFH flat needs ≈ 120 m² aGF, not the 100 m² assumed so far, so the
current dwelling counts are ≈ 20 % too high.

### 4.5 A naive projection fails, instructively

Brugg/Umiken, 20 years. The age-specific demolition hazards (§4.1) are applied to built parcels; a
first-development rate of ≈ 1.5 %/year (share of today's built parcels first built in 2016–25) to vacant
residential parcels. Redevelopment is assumed to reach 85 % of the allowance at 120 m² per flat:

- predicted: ≈ 285 dwellings in 20 years ≈ **14 per year**;
- observed 2015–2024: **646 new dwellings (≈ 65 per year)**; 148 dwellings recorded as demolished
  (under-recorded before 2020).

Decomposition of the observed 646 dwellings:

| Channel | Dwellings | Share |
|---|---|---|
| In buildings built 2014 or later | 371 | 57 % |
| Added to existing buildings (conversion, attic, split, extension) | 275 | 43 % |
| — in zones currently treated as non-residential/discretionary (ÖBA 109, Altstadt 108, City 23, …) | ≈ 245 | ≈ 38 % |
| — in projects with ≥ 10 dwellings (19 parcels) | 455 | 70 % |
| — inside a Gestaltungsplan perimeter | 141 | 22 % |

Lessons for the model:
1. **Additions and conversions** are a major channel (the dwelling creation year `WBAUJ` makes them
   observable; some may be recording artefacts and need checking).
2. **Zones without an AZ** (old town, centre, public-building zones) produce many dwellings. A model that
   treats them as zero capacity misses a third of supply.
3. **Supply is lumpy.** A few large sites dominate, so they need site-level treatment, not an average hazard.
4. Hazards pooled across the canton are too low for a regional centre like Brugg, so market and location
   effects are essential.

---

## 5. Conceptual model

### 5.1 Channels

| Channel | Unit | Event | Typical actor | Main drivers |
|---|---|---|---|---|
| A. Large sites | site (parcel or contiguous group, ≥ ≈ 3,000 m² or ≥ ≈ 20 potential dwellings) | development project starts | developer, institution | planning status (GP, Planungspflicht), ownership, market |
| B. Additions / conversions | building | ≥ 1 dwelling added without demolition | owner | reserve that fits the structure (attic, Aufstockung), building size, age, owner life stage |
| C. Redevelopment | parcel with building(s) | demolition + new building | owner/buyer/developer | value of reserve vs. value of existing building, age, location, frictions |
| D. Vacant infill | unbuilt residential parcel | first building | owner/developer | reserve, size/shape, access, hoarding |

### 5.2 Economic core

Following the redevelopment-option literature, an owner of parcel *i* develops in year *t* when the latent
net value exceeds a threshold that includes the option value of waiting and frictions:

  V_it = P_t(loc_i) · Q(K_i(R), geometry_i, typology) − C_t(typology) − W_it(S_i, age_i) − F_it

- P_t(loc): price or rent level of new floor area at the location and time.
- Q(·): realisable floor area of the best feasible typology. **This is where the rules R enter.**
- C_t: construction and demolition cost (Swiss construction price index).
- W_it: value of the existing use (larger and younger buildings → higher).
- F_it: frictions (ownership fragmentation, owner life stage, Einsprache risk, heritage, GP obligation).

We do not observe V directly. The hazard is modelled as a flexible increasing function of its observable
components, with economically signed covariates (§6.3). The key consequence for policy: **a rule change
enters only via Q(K(R)).** Its effect is large where the reserve is valuable relative to the existing use
(old small buildings, good location, high prices) and near zero elsewhere. Büchler & Lutz's finding that
effects concentrate where zoning is binding follows directly from this.

---

## 6. Statistical model

### 6.1 Units and events (from GWR, AV, swissBUILDINGS3D)

- **Parcel-year panel** for channels C and D; **building-year panel** for channel B; **site inventory** for
  channel A. Parcels change over time (subdivision, merging); use today's parcels with a crosswalk
  (EGRID history if obtainable; else spatial matching of historical building points).
- **Event definitions** (to be validated on a hand-checked sample of ≈ 200 events):
  - C, redevelopment: demolition of a main building (`GSTAT` 1007, `GABBJ`) followed by a new residential
    building on the same parcel within 5 years, or a new building replacing a footprint (AV/3D change detection).
  - D, first development: new main building on a parcel without a previous main building.
  - B, addition: dwellings with `WBAUJ` later than the building's `GBAUJ` (+ dwelling-count increases),
    Aufstockungen via storey or height changes between swissBUILDINGS3D editions (2018/2021/2024).
  - A, large site: any of the above on a site from the inventory, plus GWR projects (`GSTAT` 1001–1003)
    as pipeline states.
- **Outcome size**: net dwellings added (new − demolished), aGF added (GWR areas / footprints × storeys).

### 6.2 Covariates

| Group | Variables | Source |
|---|---|---|
| Rules | allowed aGF (engine, historical rules), reserve ratio, reserve in dwellings, binding constraint, bonuses | rulebooks (current + historical) |
| Parcel | area, shape (compactness, width), slope, drop across buildable area, forest/water constraints, corner/street access | AV, swissALTI3D, this pipeline |
| Building | age (piecewise), type, dwellings, footprint, storeys, heating-system replacement date (renovation proxy) | GWR |
| Ownership proxies | multi-dwelling since 1965 (condominium proxy), public/cooperative (not open → proxies), SDR | GWR, AV |
| Demography (aggregate only) | share of residents 65+ / 80+ in the hectare (generational change) | STATPOP hectare grid |
| Location | ÖV-Güteklasse, distance to station/centre, noise | ARE, BAFU, swisstopo |
| Market | municipal vacancy rate, regional rent/price index, construction price index | BFS (open), Wüest/IAZI (licence) |
| Regulation | Gestaltungsplan(pflicht), heritage, ISOS, Planungszone, recent revision (anticipation) | NPL, AGIS |
| Spatial | redevelopment in neighbourhood in past 5 years (contagion) | panel |

### 6.3 Hazard models (channels B, C, D)

Discrete-time complementary log-log hazard per channel *c*:

  cloglog(h_c(i,t)) = α_c(age_it) + β_c′X_it + γ_c · g(Q_it(R_t) · P_t − W_it) + u_m(i) + v_t + ε_spatial

- α_c: piecewise-constant baseline in building age (or years since zoning for vacant parcels).
- g(·): monotone spline of the economic reserve value. Monotonicity is enforced so that more allowed
  floor area can never reduce the hazard.
- u_m: municipality random effect (partial pooling for small municipalities); v_t: year effects for the market cycle.
- Competing risks: channels B and C are mutually exclusive in a year; estimated jointly (multinomial) or as
  cause-specific hazards.
- Estimation: Bayesian hierarchical model (Stan/brms or PyMC) for uncertainty propagation, and a
  gradient-boosted discrete-time survival model as a flexible benchmark (§8).
- Rare events: ≈ 0.2 %/year × ≈ 150,000 residential parcels in AG ≈ 300 events/year for channel C. That is
  enough over 5–6 years of clean data for a model with ≈ 20–30 parameters plus random effects.

### 6.4 Intensity (conditional on an event)

1. **Typology choice**, multinomial logit: single-family / two-family / row / apartment block, as a function
   of parcel size and shape, allowed aGF, zone type, location, market, era.
2. **Utilisation given typology**: beta regression (or zero-one-inflated beta) of realised aGF ÷ allowed aGF,
   on geometry (§4.3 shows typology-dependent levels). A **"realistic envelope"** feature (maximum depth
   ≈ 12–16 m for daylight, building-length limits, GZ/green-space share) captures the "Pentagon effect" on
   large parcels and the "misshaped building" effect on small ones.
3. **Dwellings** = aGF ÷ dwelling size (typology- and era-specific distribution; MFH ≈ 120 m² aGF, §4.4).
4. **Persons** = Σ dwellings × occupancy by dwelling size (STATPOP/GWR-based aggregate tables; never per building).

Training data: all new buildings since ≈ 2005 in Aargau with reconstructed allowed capacity at the time of
construction (requires the historical rules; with current rules as a fallback, flagged).

### 6.5 Large sites (channel A)

Lumpy, planning-driven projects need a site pipeline model rather than a parcel hazard:
- Inventory: parcels or contiguous same-owner groups (ownership not open → contiguous unbuilt or
  low-utilisation areas) above a size threshold, GP perimeters, Planungspflicht areas, zones without AZ.
- States: idle → planning (GP in preparation) → approved (GP approved; oereblex dates) → permit/project
  (GWR 1001–1003) → built. Transition probabilities from Aargau history (GP approval dates on oereblex;
  project dates in GWR).
- Intensity: from the GP (if approved: its floor area) or the site's allowed capacity × typology intensity.
- This channel is where the tool is least predictive; it should show sites individually ("Areal X: in
  Planung, ≈ 80–120 Wohnungen möglich") rather than folding them into a probability.

### 6.6 Aggregate calibration

Parcel-level models are calibrated so that predicted municipal totals match observed flows. Target: BFS
building and housing statistics (new dwellings per municipality and year), reconstructed from GWR
`WBAUJ` for all Aargau municipalities back to ≈ 2000. The hierarchical structure (u_m) absorbs level
differences; the calibration check is part of validation (§8).

### 6.7 Counterfactuals and uncertainty

For a rule change R → R′: recompute Q(K(R′)) with the existing engine, propagate through hazard and
intensity, and simulate parcel outcomes over H years (Monte Carlo over posterior draws and event
randomness, with municipality/year effects shared across parcels so that uncertainty does not
average away). Report the median and an 80 % interval of E[ΔU] and of τ.

---

## 7. Identification: estimating the effect of rules

The policy-relevant parameter is the response of hazard and intensity to allowed capacity (γ_c and the
intensity slopes). Naive cross-sectional estimates are biased: large reserves coincide with old buildings,
peripheral locations or owners who do not sell.

### 7.1 Strategies

1. **Staggered BNO revisions across Aargau (main design).** Roughly 200 municipalities revised their
   Nutzungsplanung at different dates (many after the 2014 RPG revision, often with AZ changes per zone).
   Event study / staggered DiD at parcel level with heterogeneity-robust estimators (Callaway & Sant'Anna
   2021; Sun & Abraham 2021): parcels whose allowed capacity rose vs. comparable parcels not yet revised.
   This is the Büchler & Lutz design transferred to Aargau.
2. **Zone-boundary discontinuities.** Within a municipality, parcels on either side of a W2|W3 boundary are
   similar in location and building stock but differ in allowed capacity. Spatial regression discontinuity
   on hazard and intensity, with building age as a covariate.
3. **External prior.** Büchler & Lutz (≈ +9 % dwellings in 5–10 years after FAR increases in ZH) as an
   informative prior on the aggregate elasticity; the Aargau estimate should be consistent or explain why not.

### 7.2 Threats and mitigations

| Threat | Mitigation |
|---|---|
| Upzoning targets areas expected to grow (selection) | event-study pre-trends; DiD with not-yet-treated controls; boundary design |
| Anticipation (Planungszonen, public participation years before approval) | date treatment at public exhibition (Auflage) as well as approval; test pre-trends |
| Displacement (growth shifts from non-upzoned to upzoned areas; Auckland) | estimate spillovers explicitly; report net municipal effects |
| Historical rules unavailable/incomplete | phase-1 feasibility check (§10); restrict to municipalities with reconstructable before/after rules |
| GWR recording breaks (demolitions pre-2020) | use construction-based events (reliable) for long panels; demolitions only from 2020; cross-check with swissBUILDINGS3D editions |
| Parcel boundary changes | crosswalk via building points; sensitivity to excluding changed parcels |

---

## 8. Validation

**Benchmarks** (the model must beat these to justify its complexity):
1. Capacity as reported today (no mobilisation).
2. Zürich-style flat factor: capacity × 0.85 spread evenly over a horizon.
3. Raum+-style availability share: 30 % of reserves "available".
4. Threshold rule (Seattle): parcels < 40 % utilised develop at a constant rate.
5. Naive age-hazard model (§4.5).

**Tests:**
- **Temporal hold-out:** fit on 2020–2023, predict 2024–2025 (clean demolition data); for construction-based
  events, fit on 2005–2014, predict 2015–2024.
- **Spatial hold-out:** leave-municipalities-out cross-validation (the tool will be applied to new ones).
- **Discrimination and calibration:** PR-AUC (rare events), Brier score, reliability curves by decile;
  calibration of municipal totals (MAPE of 10-year dwelling growth across municipalities).
- **Policy back-test:** for municipalities revised in 2012–2016, predict 2016–2025 construction with and
  without the revision; compare with observed DiD estimates.
- **Face validity:** Stephan's local spot checks (as with the capacity engine), Raum+ inventories where
  available (possible data partnership), and Büchler & Lutz magnitudes.

**Acceptance criteria (proposal):** municipal 10-year totals within ±30 % for ≥ 70 % of municipalities
(stated a priori); policy back-test sign correct and magnitude within the confidence interval of the DiD
estimate; clearly better Brier score than benchmarks 2 and 5.

---

## 9. Presentation in the tool

Wording examples (numbers illustrative only):
- Municipality panel: "Theoretische Reserve: 4'300 Wohnungen · Davon in 20 Jahren voraussichtlich
  genutzt: X–Y" (range, horizon selectable), with the channel breakdown.
- Scenario: "Mit AZ +0.1 in W2: zusätzlich ≈ a–b Wohnungen in 20 Jahren (theoretisch: +780)". The
  blocker ranking ranks by *expected* additional dwellings, not theoretical capacity. This can change the
  ranking: capacity in areas with young buildings counts for little.
- Parcel view: no individual probability; show typology-based options and feasibility (homeowner use case),
  and category statements ("Parzellen mit Gebäuden dieses Alters werden selten vor … neu bebaut").
- Methodology page: model, data, validation results, known biases; model version per estimate.

**Homeowner module (separate, later):** a pro-forma feasibility view per parcel: realisable typologies,
indicative construction cost (Swiss cost benchmarks), indicative value (market data if licensed), and the
steps (Voranfrage, neighbours, developer partnership). This follows your observation that owners often
secure the permit and leave execution to a developer.

---

## 10. Work plan (≈ 9 months FTE)

| Phase | Months | Work | Deliverable | Go/no-go |
|---|---|---|---|---|
| 0. Scoping | 0.5 | Confirm estimands, horizon, acceptance criteria with Stephan | this document, signed off | — |
| 1. Historical rules feasibility | 1.5 | For 10 sample municipalities: can pre/post-revision BNOs and zoning plans be obtained (oereblex history, municipal archives, AGIS "Zeitstände")? LLM extraction of old BNOs; match old zone plans | feasibility report; ≥ 5 municipalities with complete before/after rules | if < 5: identification relies on boundary RDD + external prior |
| 2. Event history | 1.5 | Canton-wide parcel/building panel 2000–2025 from GWR (+ swissBUILDINGS3D change detection 2018→2024); event definitions; hand-validated sample of 200 events | panel dataset + event codebook + precision/recall of event detection | event precision ≥ 90 % |
| 3. Descriptives | 1 | Hazards by age/type/municipality; intensity by typology/size; channel decomposition for all AG municipalities | descriptive report (extends §4) | — |
| 4. Hazard models | 1.5 | Channels B–D; Bayesian hierarchical + boosted benchmark; temporal/spatial CV | fitted models, CV report | beats benchmarks 2 and 5 |
| 5. Intensity + large sites | 1 | Typology choice, utilisation, dwelling size, occupancy; site inventory and pipeline model | intensity models, site inventory | — |
| 6. Identification | 1.5 | Staggered DiD / event study across revisions; boundary RDD; reconcile with Büchler & Lutz | elasticity estimates with robustness | — |
| 7. Validation + integration | 1 | Policy back-test; calibration; integrate into engine (Python + TS mirror or precomputed hazard tables); UI | validated model in the tool; methodology page | acceptance criteria met |
| 8. Write-up | (overlapping) | Paper-style write-up (target: disP / Swiss Journal of Economics and Statistics / Journal of Housing Economics) | manuscript | — |

**Main risks:**
1. Historical zoning not reconstructable. Mitigations: boundary RDD, external prior; narrower claims.
2. Event recording artefacts (demolition break, `WBAUJ` corrections). Mitigations: construction-based
   events, 3D change detection, hand validation.
3. Market data only under licence. Mitigations: BFS vacancy and price indices; municipality × year effects
   absorb most of it.
4. Small numbers for large sites. Mitigation: show them individually rather than modelling them.

**Implementation note for the tool:** the browser engine should not run a Bayesian model. The pipeline
precomputes, per parcel, the hazard/intensity *response curves* to allowed capacity (e.g. at a grid of
capacity multipliers). The TypeScript engine interpolates them live, like today's footprint-by-setback
table. Scenarios therefore stay instantaneous and the Python↔TS parity approach carries over.

---

## 11. Open questions for Stephan

1. Horizon(s) to show by default: 10, 20 years, or both?
2. Is the "no per-parcel probability" rule right, or should owners see their own parcel's category?
3. Market data: are licensed price/rent indices (Wüest Partner, IAZI, Fahrländer) an option (e.g. via an
   academic partner), or open data only?
4. Partnerships: Raum+ (ETH) inventories for Aargau municipalities, Kanton Aargau (Raumentwicklung),
   the BWO single-family-neighbourhood study. Worth contacting, and at which stage?
5. Scope of the first implementation: canton-wide estimation (needed for identification) vs. Brugg/Windisch only.

---

## 12. Quick wins independent of the full model

These follow from §4 and could be done before the research project:
1. Dwelling size 120 m² aGF per flat for apartment blocks (currently 100 m²).
2. Report the capacity range (optimistic/conservative setbacks) as the headline (improvements §1).
3. Show new-dwelling history per municipality (2015–2024 from GWR `WBAUJ`) next to the reserve, e.g.
   "Reserve ≈ 66 Jahre Bautätigkeit im bisherigen Tempo". This is simple, honest and needs no model.
4. Treat zones without AZ (old town, centre, public buildings) as a separate "Sonderzonen" channel in
   the panel instead of zero or unlimited capacity.

---

## References

Verified in this session (search results or documents read):
- Büchler, S. & Lutz, E. C. (2024). Making housing affordable? The local effects of relaxing land-use regulation. *Journal of Urban Economics*, 143. https://www.sciencedirect.com/science/article/pii/S0094119024000597
- Greenaway-McGrevy, R. & Phillips, P. C. B. (2023). The impact of upzoning on housing construction in Auckland. *Journal of Urban Economics*, 136. https://ideas.repec.org/a/eee/juecon/v136y2023ics0094119023000244.html
- Dye, R. F. & McMillen, D. P. (2007). Teardowns and land values in the Chicago metropolitan area. *Journal of Urban Economics*. https://www.sciencedirect.com/science/article/abs/pii/S0094119006000581
- McMillen, D. & O'Sullivan, A. (2013). Option value and the price of teardown properties. *Journal of Urban Economics*, 74, 71–82. https://ideas.repec.org/a/eee/juecon/v74y2013icp71-82.html
- Stadt Zürich (2025). Revision BZO, Beilage 3: Kapazitäts- und Reserveberechnung (KAREB). https://www.stadt-zuerich.ch/content/dam/web/de/planen-bauen/projekte-und-ausschreibungen/dokumente/oe-rekursauflage-afs/bzo-revision/dokumente/erlaeuterungsbericht/Erlaeuterungsbericht_Beilage_3_Kapazitaets-_und_Reserveberechnung.pdf
- Statistik Stadt Zürich. Ersatzneubau / Hohe Neubautätigkeit stark von Wohnersatz geprägt. https://www.stadt-zuerich.ch/de/politik-und-verwaltung/statistik-und-daten/daten/bauen-und-wohnen/bautaetigkeit/bauliche-erneuerung/ersatzneubau.html
- Kanton Zürich, Raumbeobachtung (Ausbaugrad, Geschossflächenreserven). https://www.zh.ch/de/planen-bauen/raumplanung/raumbeobachtung.html
- Raum+ (ETH Zürich). Schweizweite Abschätzung der Nutzungsreserven 2017; method description. https://raumplus.ethz.ch/de/download/Nutzungsreserven_2017.pdf ; https://www.raumplus.ethz.ch/de/was-ist-raumplus/
- ARE. Nutzungsreserven im Bestand – Konzeptstudie. https://www.are.admin.ch/dam/de/sd-web/E23jgeQTIs5v/nutzungsreservenimbestand.pdf
- UCLA Lewis Center (Monkkonen, Elmendorf et al.). A New Approach to the Housing Element Update. https://www.lewis.ucla.edu/research/new-approach-housing-element-update/
- Seattle OPCD. Zoned development capacity. https://web5.seattle.gov/opcd/population-and-demographics/zoned-development-capacity
- Age-Stiftung. MetamorpHouse. https://www.age-stiftung.ch/foerderung/metamorphouse-netzwerk-fuer-die-weiterentwicklung-von-wohneigentum-im-alter ; EspaceSuisse, Leitfaden zur Verdichtung von EFH-Quartieren. https://www.espacesuisse.ch/de/news/leitfaden-zur-verdichtung-von-efh-quartieren
- Parcel geometry and zoning capitalisation, Auckland (2026). *New Zealand Economic Papers*. https://www.tandfonline.com/doi/full/10.1080/00779954.2026.2674733

From the standard literature, bibliographic details **not re-verified in this session** (check before citing):
- Capozza, D. R. & Helsley, R. W. (1989). The fundamentals of land prices and urban growth. *Journal of Urban Economics*, 26.
- Rosenthal, S. S. & Helsley, R. W. (1994). Redevelopment and the urban land price gradient. *Journal of Urban Economics*, 35.
- Munneke, H. J. (1996). Redevelopment decisions for commercial and industrial properties. *Journal of Urban Economics*, 39.
- Brueckner, J. K. & Rosenthal, S. S. (2009). Gentrification and neighborhood housing cycles. *Review of Economics and Statistics*, 91(4).
- Clapp, J. M. & Salavei, K. (2010). Hedonic pricing with redevelopment options. *Journal of Urban Economics*, 67.
- Freemark, Y. (2020). Upzoning Chicago: Impacts of a zoning reform on property values and housing construction. *Urban Affairs Review*, 56(3).
- Waddell, P. (2002). UrbanSim: Modeling urban development for land use, transportation, and environmental planning. *Journal of the American Planning Association*, 68(3).
- Callaway, B. & Sant'Anna, P. H. C. (2021). Difference-in-differences with multiple time periods. *Journal of Econometrics*, 225(2).
- Sun, L. & Abraham, S. (2021). Estimating dynamic treatment effects in event studies with heterogeneous treatment effects. *Journal of Econometrics*, 225(2).
