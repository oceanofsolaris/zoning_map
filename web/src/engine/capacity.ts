// Capacity engine – TypeScript mirror of etl/src/pp_etl/engine/capacity.py.
// Keep both in lockstep; both must pass tests/golden/*.json.

export type Conf = "low" | "medium" | "high";

export interface Bonus { id: string; az_delta: number; vg_delta: number }
export interface Rules {
  code: string; residential: boolean; discretionary: boolean;
  az_max: number | null; uez_max: number | null; vg_max: number | null;
  attika_allowed: boolean; attika_factor: number | null; gh_max_m: number | null;
  ga_klein_m: number | null; ga_gross_m: number | null; az_counts_attika: boolean;
  bonuses: Bonus[]; confidence_cap: Conf | null;
  vg_min?: number | null; // set by applyScenario: the zone's own storey count
}
export type RuleSet = Record<string, Rules>;
export interface Part { zone: string | null; area_m2: number; agsf_m2: number; fp: number[] }
export interface Existing { gf_m2: number; gf_fixed_m2?: number; storeys_max: number | null; height_max_m: number | null; n_buildings: number }
export interface ParcelFacts { area_m2: number; flags: string[]; parts: Part[]; existing: Existing }
export interface ZoneDelta { d_az?: number; d_vg?: number }
export interface Scenario { zones?: Record<string, ZoneDelta>; bonuses?: Record<string, boolean> }
export interface EngineConfig {
  gf_per_dwelling_m2: number; gf_per_resident_m2: number; storey_height_m: number; attika_factor: number;
  envelope_to_agf: number; existing_to_agf: number; tol_gf: number; tol_height_m: number;
  setback_mode: "optimistic" | "conservative"; setback_steps_m: number[]; default_grenzabstand_m: number;
  scenario_storey_raises_height: boolean; small_parcel_m2: number; setback_range_medium_threshold: number;
  [k: string]: unknown;
}
export type Kind = "non_building" | "non_residential" | "discretionary" | "residential";
export type Binding = "az" | "envelope" | "discretionary" | "non_residential" | "none";
export interface PartResult { kind: Kind; gf: number | null; binding: Binding; env_height: number | null }
export interface Result {
  gf_allowed_m2: number | null; gf_allowed_opt_m2: number | null; gf_allowed_con_m2: number | null;
  binding_constraint: Binding; envelope_height_m: number | null; agf_existing_m2: number;
  utilisation: number | null; headroom_gf_m2: number | null; headroom_units: number | null;
  headroom_residents: number | null; allowed_today: boolean | null; exceedances: string[];
  confidence: Conf; flags: string[];
  parts: { zone: string | null; gf: number | null; binding: Binding; env_height: number | null }[];
}

const CONF_ORDER: Conf[] = ["low", "medium", "high"];
const CAP_MEDIUM_FLAGS = ["multi_zone", "missing_height", "slope", "discretionary"];
const CAP_LOW_FLAGS = ["gestaltungsplan", "hochhausstandort", "sdr_overlap", "rulebook_unverified"];

export function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] + t * (ys[i] - ys[i - 1]);
    }
  }
  return ys[ys.length - 1];
}

export function applyScenario(rules: RuleSet, scenario: Scenario | null | undefined, cfg: EngineConfig): RuleSet {
  if (!scenario) return rules;
  const zones = scenario.zones ?? {};
  const bonusesOn = scenario.bonuses ?? {};
  const out: RuleSet = {};
  for (const [code, r0] of Object.entries(rules)) {
    const r = { ...r0 };
    if (r.residential && !r.discretionary) {
      let dAz = 0;
      let dVg = 0;
      for (const key of ["*", code]) {
        const z = zones[key];
        if (z) { dAz += z.d_az ?? 0; dVg += z.d_vg ?? 0; }
      }
      for (const b of r.bonuses ?? []) {
        if (bonusesOn[b.id]) { dAz += b.az_delta ?? 0; dVg += b.vg_delta ?? 0; }
      }
      if (r.az_max !== null && dAz) r.az_max = Math.max(0, r.az_max + dAz);
      if (r.vg_max !== null && dVg) {
        // Extra storeys are an option, not an obligation: remember the zone's own count.
        r.vg_min = r.vg_max;
        r.vg_max = Math.max(0, r.vg_max + dVg);
        if (r.gh_max_m !== null && cfg.scenario_storey_raises_height) r.gh_max_m = r.gh_max_m + dVg * cfg.storey_height_m;
      }
    }
    out[code] = r;
  }
  return out;
}

export function storeys(r: Rules, cfg: EngineConfig): [number | null, number] {
  const vg = r.vg_max;
  if (vg === null && r.gh_max_m !== null) return [Math.floor(r.gh_max_m / cfg.storey_height_m), 0];
  if (vg === null) return [null, 0];
  let attic = 0;
  if (r.attika_allowed) attic = r.attika_factor !== null ? r.attika_factor : cfg.attika_factor;
  return [vg, attic];
}

export function setbackFor(r: Rules, mode: string, cfg: EngineConfig): number {
  const klein = r.ga_klein_m !== null ? r.ga_klein_m : cfg.default_grenzabstand_m;
  if (mode === "conservative" && r.ga_gross_m !== null) return r.ga_gross_m;
  return klein;
}

export function computePart(part: Part, r: Rules | null | undefined, cfg: EngineConfig, mode: string): PartResult {
  if (!r) return { kind: "non_building", gf: null, binding: "none", env_height: null };
  if (!r.residential) return { kind: "non_residential", gf: null, binding: "non_residential", env_height: null };
  const [vg, attic] = storeys(r, cfg);
  if (r.discretionary || vg === null) return { kind: "discretionary", gf: null, binding: "discretionary", env_height: null };

  let fp = interp(cfg.setback_steps_m, part.fp, setbackFor(r, mode, cfg));
  if (r.uez_max !== null) fp = Math.min(fp, r.uez_max * part.agsf_m2);
  const k = cfg.envelope_to_agf;

  let envHeight = (vg + attic) * cfg.storey_height_m;
  if (r.gh_max_m !== null) envHeight = Math.min(envHeight, r.gh_max_m);

  if (r.az_max === null) return { kind: "residential", gf: fp * (vg + attic) * k, binding: "envelope", env_height: envHeight };

  const gfAz = r.az_max * part.agsf_m2;
  let gf: number;
  let binding: Binding;
  if (r.az_counts_attika) {
    const gfEnv = fp * (vg + attic) * k;
    gf = Math.min(gfAz, gfEnv);
    binding = gfAz <= gfEnv ? "az" : "envelope";
  } else {
    // AZ counts full storeys only (e.g. BNO Brugg § 74); the attic adds area in proportion to the built
    // footprint. A builder chooses the storey count between the zone's own and the (scenario) maximum.
    gf = 0;
    binding = "envelope";
    const nMin = r.vg_min ?? vg;
    for (let n = Math.trunc(nMin); n <= Math.trunc(vg); n++) {
      if (n <= 0) continue;
      const gfEnvN = fp * n * k;
      const gfN = Math.min(gfAz, gfEnvN) * (1 + attic / n);
      if (gfN > gf) { gf = gfN; binding = gfAz <= gfEnvN ? "az" : "envelope"; }
    }
  }
  return { kind: "residential", gf, binding, env_height: envHeight };
}

function cap(conf: Conf, c: Conf): Conf {
  return CONF_ORDER.indexOf(conf) <= CONF_ORDER.indexOf(c) ? conf : c;
}

export function computeParcel(parcel: ParcelFacts, rules0: RuleSet, cfg: EngineConfig, scenario?: Scenario | null,
                              preApplied = false): Result {
  const rules = preApplied ? rules0 : applyScenario(rules0, scenario, cfg);
  const parts = parcel.parts;
  const infra = (parcel.flags ?? []).includes("infrastructure");
  const resOpt = parts.map((p) => computePart(p, infra ? null : rules[p.zone ?? ""], cfg, "optimistic"));
  const resCon = parts.map((p) => computePart(p, infra ? null : rules[p.zone ?? ""], cfg, "conservative"));
  const headline = cfg.setback_mode === "optimistic" ? resOpt : resCon;

  const total = (res: PartResult[]): number | null => {
    // A discretionary part makes the parcel total unknown (not partial).
    if (res.some((r) => r.kind === "discretionary")) return null;
    const vals = res.map((r) => r.gf).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const gfAllowed = total(headline);
  const gfOpt = total(resOpt);
  const gfCon = total(resCon);

  let dom = 0;
  for (let i = 1; i < parts.length; i++) if (parts[i].area_m2 > parts[dom].area_m2) dom = i;
  const binding: Binding = parts.length ? headline[dom].binding : "none";
  const envHeight = parts.length ? headline[dom].env_height : null;
  const domRules = parts.length && !infra ? rules[parts[dom].zone ?? ""] ?? null : null;

  const ex = parcel.existing;
  const agfExisting = ex.gf_m2 * cfg.existing_to_agf + (ex.gf_fixed_m2 ?? 0);
  const utilisation = gfAllowed ? agfExisting / gfAllowed : null;
  const headroom = gfAllowed !== null ? Math.max(0, gfAllowed - agfExisting) : null;
  const units = headroom !== null ? Math.floor(headroom / cfg.gf_per_dwelling_m2 + 1e-9) : null;
  const residents = headroom !== null ? headroom / cfg.gf_per_resident_m2 : null;

  const exceedances: string[] = [];
  let allowedToday: boolean | null = null;
  if (ex.n_buildings > 0 && domRules && headline[dom].kind === "residential") {
    if (gfAllowed !== null && agfExisting > gfAllowed * (1 + cfg.tol_gf)) exceedances.push("gf");
    if (domRules.vg_max !== null && ex.storeys_max !== null &&
        ex.storeys_max > domRules.vg_max + (domRules.attika_allowed ? 1 : 0)) exceedances.push("storeys");
    // Heights ignore the relevant terrain; on slopes no height exceedance is claimed.
    const slope = (parcel.flags ?? []).includes("slope");
    if (domRules.gh_max_m !== null && ex.height_max_m !== null && !slope &&
        ex.height_max_m > domRules.gh_max_m + cfg.tol_height_m) exceedances.push("height");
    allowedToday = exceedances.length === 0;
  }

  const flags = [...(parcel.flags ?? [])];
  if (headline.some((r) => r.kind === "discretionary") && !flags.includes("discretionary")) flags.push("discretionary");
  let conf: Conf = "high";
  for (const f of flags) {
    if (CAP_MEDIUM_FLAGS.includes(f)) conf = cap(conf, "medium");
    if (CAP_LOW_FLAGS.includes(f)) conf = cap(conf, "low");
  }
  if (gfOpt && gfCon !== null && (gfOpt - gfCon) / gfOpt > cfg.setback_range_medium_threshold) conf = cap(conf, "medium");
  if (parcel.area_m2 < cfg.small_parcel_m2) conf = cap(conf, "low");
  for (const p of parts) {
    const r = rules[p.zone ?? ""];
    if (r && r.confidence_cap) conf = cap(conf, r.confidence_cap);
  }

  return {
    gf_allowed_m2: gfAllowed, gf_allowed_opt_m2: gfOpt, gf_allowed_con_m2: gfCon, binding_constraint: binding,
    envelope_height_m: envHeight, agf_existing_m2: agfExisting, utilisation, headroom_gf_m2: headroom,
    headroom_units: units, headroom_residents: residents, allowed_today: allowedToday, exceedances,
    confidence: conf, flags,
    parts: parts.map((p, i) => ({ zone: p.zone, gf: headline[i].gf, binding: headline[i].binding, env_height: headline[i].env_height })),
  };
}

export interface Totals {
  gf_allowed_m2: number; agf_existing_m2: number; headroom_gf_m2: number; headroom_units: number;
  headroom_residents: number; n_parcels: number;
}

export function summarise(results: Result[]): Totals {
  const t: Totals = { gf_allowed_m2: 0, agf_existing_m2: 0, headroom_gf_m2: 0, headroom_units: 0, headroom_residents: 0, n_parcels: 0 };
  for (const r of results) {
    if (r.gf_allowed_m2 === null) continue;
    t.n_parcels += 1;
    t.gf_allowed_m2 += r.gf_allowed_m2;
    t.agf_existing_m2 += r.agf_existing_m2;
    t.headroom_gf_m2 += r.headroom_gf_m2 ?? 0;
    t.headroom_units += r.headroom_units ?? 0;
    t.headroom_residents += r.headroom_residents ?? 0;
  }
  return t;
}

export function computeAll(parcels: ParcelFacts[], rules: RuleSet, cfg: EngineConfig, scenario?: Scenario | null): Result[] {
  const applied = applyScenario(rules, scenario, cfg);
  return parcels.map((p) => computeParcel(p, applied, cfg, null, true));
}

export interface Lever { id: string; label_de: string; delta: ZoneDelta }
export interface BlockerRow { lever: string; label_de: string; zone: string; d_headroom_gf_m2: number; d_headroom_units: number; d_gf_allowed_m2: number }

export const DEFAULT_LEVERS: Lever[] = [
  { id: "az+0.1", label_de: "AZ +0.1", delta: { d_az: 0.1 } },
  { id: "vg+1", label_de: "+1 Vollgeschoss", delta: { d_vg: 1 } },
];

export function blockerRanking(parcels: ParcelFacts[], rules: RuleSet, cfg: EngineConfig, levers = DEFAULT_LEVERS): BlockerRow[] {
  const base = summarise(computeAll(parcels, rules, cfg));
  const targets = [...Object.entries(rules).filter(([, r]) => r.residential && !r.discretionary).map(([c]) => c), "*"];
  const out: BlockerRow[] = [];
  for (const lever of levers) {
    for (const t of targets) {
      const s = summarise(computeAll(parcels, rules, cfg, { zones: { [t]: lever.delta } }));
      out.push({
        lever: lever.id, label_de: lever.label_de, zone: t,
        d_headroom_gf_m2: s.headroom_gf_m2 - base.headroom_gf_m2,
        d_headroom_units: s.headroom_units - base.headroom_units,
        d_gf_allowed_m2: s.gf_allowed_m2 - base.gf_allowed_m2,
      });
    }
  }
  out.sort((a, b) => b.d_headroom_gf_m2 - a.d_headroom_gf_m2);
  return out;
}
