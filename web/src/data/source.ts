// Data access. Prototype: static GeoJSON/JSON per territory under public/data/<canton>/<bfs>/.
// v1 swaps this module for PMTiles + GeoParquet (hyparquet) without touching the UI.
import type { EngineConfig, ParcelFacts, RuleSet } from "../engine/capacity";

export interface TerritoryIndexEntry { territory_id: string; name: string; bfs: number; canton: string; path: string; bbox: number[] }
export interface ParcelRecord {
  id: number; egrid: string; nr: string; perimeter: string | null; covered: boolean;
  addresses: string[]; egids: number[]; gklas_main: number | null; year_built: number | null; period_built: number | null;
  dwellings: number | null; gf_existing_alt_m2: number | null; footprint_existing_m2: number | null;
  existing_from_dwellings?: boolean; slope_pct?: number | null;
  projects?: { egid: number; status: string; dwellings: number | null; gf_est_m2: number; footprint_m2: number | null }[];
  facts: ParcelFacts;
}
export interface RuleValue { value: unknown; source?: string; page?: number; section?: string; quote?: string | null; verified?: boolean; note?: string }
export interface RulebookZone {
  code: string; label_de: string; category: string; residential: boolean; discretionary: boolean;
  params: Record<string, RuleValue>; basis?: RuleValue; bonuses: { id: string; label_de: string; az_delta?: number; vg_delta?: number; default_on: boolean; section?: string; source?: string; page?: number; quote?: string }[];
  notes: string[];
}
export interface Rulebook {
  rulebook_id: string; version: string; scope_de: string; compiled_at: string; compiled_by: string;
  sources: { id: string; title: string; url?: string; note?: string }[];
  definitions: Record<string, RuleValue>;
  zones: RulebookZone[];
}
export interface Territory {
  territory_id: string; bfs: number; name: string; canton: string; built_at: string; bbox: number[]; focus_bbox?: number[]; bbox_lv95?: number[]; center: number[];
  perimeters: { id: string; label: string; covered: boolean }[];
  qa_locations: { id: string; label: string; lon: number; lat: number }[];
  engine_config: EngineConfig; pipeline_config: Record<string, unknown>;
  rules: RuleSet; rulebooks: Record<string, Rulebook>; qa: Record<string, any>;
  attribution: { id: string; text: string; licence: string }[];
}
export interface TerritoryData { territory: Territory; parcels: ParcelRecord[]; base: string }

const ROOT = "data";

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json() as Promise<T>;
}

export async function loadIndex(): Promise<TerritoryIndexEntry[]> {
  return (await json<{ territories: TerritoryIndexEntry[] }>(`${ROOT}/index.json`)).territories;
}

export async function loadTerritory(entry: TerritoryIndexEntry): Promise<TerritoryData> {
  const base = `${ROOT}/${entry.path}`;
  const [territory, parcels] = await Promise.all([
    json<Territory>(`${base}/territory.json`),
    json<ParcelRecord[]>(`${base}/parcels.json`),
  ]);
  return { territory, parcels, base };
}

export const layerUrl = (d: TerritoryData, name: string) => `${d.base}/${name}.geojson`;
