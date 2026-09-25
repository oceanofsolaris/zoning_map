// Golden vectors shared with the Python engine (tests/golden/*.json).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeParcel, type EngineConfig, type Result } from "./capacity";

const DIR = join(__dirname, "../../../tests/golden");
const base = JSON.parse(readFileSync(join(DIR, "_base.json"), "utf8"));
const files = readdirSync(DIR).filter((f) => f.endsWith(".json") && !f.startsWith("_")).sort();
const RATIO_KEYS = new Set(["utilisation", "headroom_residents"]);

describe("golden vectors", () => {
  it("has at least 15 cases", () => expect(files.length).toBeGreaterThanOrEqual(15));
  for (const f of files) {
    const c = JSON.parse(readFileSync(join(DIR, f), "utf8"));
    it(c.name, () => {
      const cfg = { ...base.cfg, ...(c.cfg ?? {}) } as EngineConfig;
      const rules = { ...base.rules, ...(c.rules ?? {}) };
      const got = computeParcel(c.parcel, rules, cfg, c.scenario) as unknown as Record<string, unknown>;
      for (const [key, want] of Object.entries(c.expected as Record<string, unknown>)) {
        const have = got[key as keyof Result];
        if (typeof want === "number" && (!Number.isInteger(want) || key.endsWith("_m2") || RATIO_KEYS.has(key))) {
          const tol = RATIO_KEYS.has(key) ? 1e-4 : 0.1;
          expect(have, key).not.toBeNull();
          expect(Math.abs((have as number) - want), `${key}: ${have} vs ${want}`).toBeLessThanOrEqual(tol);
        } else {
          expect(have, key).toEqual(want);
        }
      }
    });
  }
});
