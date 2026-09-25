// Shareable URL state in the hash: t (territory), p (EGRID), v (view), s (scenario), b (bonuses), m (map).
import type { Scenario } from "./engine/capacity";

export interface UrlState { t?: string; p?: string; g?: string; v?: string; scenario?: Scenario; m?: [number, number, number] }

export function readUrl(): UrlState {
  const h = new URLSearchParams(location.hash.slice(1));
  const out: UrlState = {};
  if (h.get("t")) out.t = h.get("t")!;
  if (h.get("p")) out.p = h.get("p")!;
  if (h.get("v")) out.v = h.get("v")!;
  if (h.get("g")) out.g = h.get("g")!;
  const s = h.get("s"), b = h.get("b");
  if (s || b) {
    out.scenario = { zones: {}, bonuses: {} };
    for (const item of (s ?? "").split(";").filter(Boolean)) {
      const [zone, az, vg] = item.split(":");
      out.scenario.zones![zone] = { d_az: Number(az) || 0, d_vg: Number(vg) || 0 };
    }
    for (const id of (b ?? "").split(",").filter(Boolean)) out.scenario.bonuses![id] = true;
  }
  const m = h.get("m")?.split(",").map(Number);
  if (m && m.length === 3 && m.every(Number.isFinite)) out.m = m as [number, number, number];
  return out;
}

export function writeUrl(st: UrlState): void {
  const h = new URLSearchParams();
  if (st.t) h.set("t", st.t);
  if (st.p) h.set("p", st.p);
  if (st.g) h.set("g", st.g);
  if (st.v && st.v !== "headroom") h.set("v", st.v);
  const z = Object.entries(st.scenario?.zones ?? {}).filter(([, d]) => d.d_az || d.d_vg);
  if (z.length) h.set("s", z.map(([k, d]) => `${k}:${+(d.d_az ?? 0).toFixed(2)}:${d.d_vg ?? 0}`).join(";"));
  const b = Object.entries(st.scenario?.bonuses ?? {}).filter(([, on]) => on).map(([k]) => k);
  if (b.length) h.set("b", b.join(","));
  if (st.m) h.set("m", st.m.map((v, i) => v.toFixed(i === 2 ? 2 : 5)).join(","));
  history.replaceState(null, "", `#${h.toString().replaceAll("%2F", "/").replaceAll("%3A", ":").replaceAll("%3B", ";").replaceAll("%2C", ",")}`);
}
