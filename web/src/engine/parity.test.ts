// Parity with the Python pipeline on real exported data (skipped when data has not been built).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blockerRanking, computeAll, summarise, type EngineConfig } from "./capacity";

const DIR = join(__dirname, "../../public/data/AG/4095");
const have = existsSync(join(DIR, "territory.json")) && existsSync(join(DIR, "parcels.json"));

describe.skipIf(!have)("parity with Python on Brugg data", () => {
  const t = have ? JSON.parse(readFileSync(join(DIR, "territory.json"), "utf8")) : null;
  const parcels = have ? JSON.parse(readFileSync(join(DIR, "parcels.json"), "utf8")) : [];
  const cfg = t?.engine_config as EngineConfig;
  const facts = parcels.map((p: { facts: unknown }) => p.facts);

  it("per-parcel allowed floor area and binding match", () => {
    const res = computeAll(facts, t.rules, cfg);
    let mismatches = 0;
    res.forEach((r, i) => {
      const py = parcels[i].py;
      const a = r.gf_allowed_m2, b = py.gf_allowed_m2;
      if ((a === null) !== (b === null) || (a !== null && Math.abs(a - b) > 0.1) || r.binding_constraint !== py.binding_constraint
          || r.allowed_today !== py.allowed_today || r.confidence !== py.confidence) mismatches++;
    });
    expect(mismatches).toBe(0);
  });

  it("municipal totals match", () => {
    const s = summarise(computeAll(facts, t.rules, cfg));
    for (const k of ["gf_allowed_m2", "agf_existing_m2", "headroom_gf_m2"] as const) {
      expect(Math.abs(s[k] - t.qa.totals[k])).toBeLessThan(1);
    }
    expect(s.headroom_units).toBe(t.qa.totals.headroom_units);
  });

  it("blocker ranking (scenarios) matches", () => {
    const ts = blockerRanking(facts, t.rules, cfg);
    const py = t.qa.blocker_ranking as { lever: string; zone: string; d_headroom_gf_m2: number }[];
    for (const row of py) {
      const m = ts.find((x) => x.lever === row.lever && x.zone === row.zone)!;
      expect(Math.abs(m.d_headroom_gf_m2 - row.d_headroom_gf_m2), `${row.lever} ${row.zone}`).toBeLessThan(1);
    }
  });
});
