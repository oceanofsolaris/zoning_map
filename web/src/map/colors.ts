// Colour system. Headroom: sequential yellow–green–blue (colour-blind safe).
// Utilisation: diverging blue–(neutral)–orange around 1.0. Zones: Swiss zoning-plan conventions.
// The ghost envelope uses red, the Swiss plan convention for "new construction".

export const INK = "#1d1f21";
export const NEUTRAL = "#d9d5cc";
export const GHOST = "#d7263d";

export const HEADROOM_STOPS: [number, string][] = [
  [0, "#f4f1e6"], [0.1, "#e3eeb4"], [0.3, "#a9d9a3"], [0.6, "#5fb8b0"], [1.0, "#2c7fb8"], [1.6, "#253494"],
];
export const UTIL_STOPS: [number, string][] = [
  [0, "#2166ac"], [0.3, "#67a9cf"], [0.6, "#d1e5f0"], [0.9, "#f7f7f7"], [1.05, "#fddbc7"], [1.2, "#e08214"], [1.6, "#8c510a"],
];
export const SCENARIO_STOPS: [number, string][] = [
  [0, "#f4f1e6"], [0.05, "#fde0dd"], [0.15, "#fa9fb5"], [0.3, "#dd3497"], [0.6, "#7a0177"],
];
export const ALLOWED_COLORS = { ok: "#cfe3d4", over: "#e9a23b", na: NEUTRAL };

export const ZONE_COLORS: Record<string, string> = {
  residential: "#f7d95c",
  mixed: "#f2a65a",
  centre: "#b8764b",
  core: "#a0643f",
  oldtown: "#7d4a2f",
  renewal: "#e8c58a",
  special: "#c8a2c8",
  work: "#a58ecf",
  public: "#9fb3c8",
  green: "#b6d7a8",
  other: "#e6e3dc",
};

// Residential zone colours by storey count, from light yellow (2) to orange (5)
export function zoneColor(category: string | null, zoneKey: string | null): string {
  if (category === "residential" || category === "mixed") {
    const n = Number((zoneKey ?? "").match(/(\d)$/)?.[1] ?? 2);
    const res = ["#fbeaa0", "#f7d95c", "#f4bf3a", "#ee9a2c", "#e0782a"];
    const mix = ["#f6c7a3", "#f2a65a", "#ea8a4a", "#dd6f3a", "#c9582f"];
    return (category === "residential" ? res : mix)[Math.min(4, Math.max(0, n - 1))];
  }
  return ZONE_COLORS[category ?? "other"] ?? ZONE_COLORS.other;
}

export function stepsToExpr(stops: [number, string][], input: unknown): unknown[] {
  return ["interpolate", ["linear"], input, ...stops.flat()];
}

export function cssGradient(stops: [number, string][]): string {
  const max = stops[stops.length - 1][0];
  return `linear-gradient(90deg, ${stops.map(([v, c]) => `${c} ${(v / max) * 100}%`).join(", ")})`;
}
