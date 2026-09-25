// Data access. Prototype: static GeoJSON/JSON per territory under public/data/<canton>/<bfs>/.
// v1 swaps this module for PMTiles + GeoParquet (hyparquet) without touching the UI.
import type { EngineConfig, ParcelFacts, RuleSet } from "../engine/capacity";

export interface TerritoryIndexEntry { territory_id: string; name: string; bfs: number; canton: string; path: string; bbox: number[] }
export interface ParcelRecord {
  id: number; egrid: string; territory_id?: string; lv95?: [number, number]; wgs84?: [number, number]; nr: string; perimeter: string | null; covered: boolean;
  addresses: string[]; egids: number[]; gklas_main: number | null; year_built: number | null; period_built: number | null;
  dwellings: number | null; gf_existing_alt_m2: number | null; footprint_existing_m2: number | null;
  existing_from_dwellings?: boolean; slope_pct?: number | null;
  constraints?: { id: string; share?: number; labels?: string[]; length_m?: number }[];
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
  rulebook_id: string; version: string; scope_de: string; municipality: { bfs: number; name: string; canton: string }; compiled_at: string; compiled_by: string;
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
  links?: { id: string; label: string; hint?: string; url: string }[];
  /** Set on a merged dataset: the individual territories it combines. */
  members?: Territory[];
}
export interface TerritoryData {
  territory: Territory;           // merged view when several territories are loaded
  parcels: ParcelRecord[];        // global ids 0..n-1
  layer: (name: string) => Promise<GeoJSON.FeatureCollection>;
}

const ROOT = "data";

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json() as Promise<T>;
}

export async function loadIndex(): Promise<TerritoryIndexEntry[]> {
  return (await json<{ territories: TerritoryIndexEntry[] }>(`${ROOT}/index.json`)).territories;
}

async function loadOne(entry: TerritoryIndexEntry) {
  const base = `${ROOT}/${entry.path}`;
  const [territory, parcels] = await Promise.all([
    json<Territory>(`${base}/territory.json`),
    json<ParcelRecord[]>(`${base}/parcels.json`),
  ]);
  return { territory, parcels, base };
}

const unionBbox = (bs: (number[] | undefined)[]) => {
  const v = bs.filter((b): b is number[] => !!b);
  return [Math.min(...v.map((b) => b[0])), Math.min(...v.map((b) => b[1])), Math.max(...v.map((b) => b[2])), Math.max(...v.map((b) => b[3]))];
};

/** Load one or more territories and merge them into a single dataset with global parcel ids. */
export async function loadTerritories(entries: TerritoryIndexEntry[]): Promise<TerritoryData> {
  const loaded = await Promise.all(entries.map(loadOne));
  const offsets: number[] = [];
  let n = 0;
  const parcels: ParcelRecord[] = [];
  for (const l of loaded) {
    offsets.push(n);
    for (const p of l.parcels) parcels.push({ ...p, id: p.id + n, territory_id: l.territory.territory_id });
    n += l.parcels.length;
  }
  const members = loaded.map((l) => l.territory);
  const rules: Territory["rules"] = {};
  for (const m of members) {
    for (const [k, r] of Object.entries(m.rules)) {
      if (rules[k]) throw new Error(`Zone key ${k} defined by two territories; planning perimeter ids must be unique`);
      rules[k] = r;
    }
  }
  const first = members[0];
  const bbox = unionBbox(members.map((m) => m.bbox));
  const attribution = [...new Map(members.flatMap((m) => m.attribution).map((a) => [a.id, a])).values()];
  const territory: Territory = {
    ...first,
    territory_id: members.map((m) => m.territory_id).join(","),
    name: members.map((m) => m.name).join(" · "),
    bbox, focus_bbox: unionBbox(members.map((m) => m.focus_bbox ?? m.bbox)),
    bbox_lv95: unionBbox(members.map((m) => m.bbox_lv95)),
    center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
    built_at: members.map((m) => m.built_at).sort().at(-1)!,
    perimeters: members.flatMap((m) => m.perimeters),
    qa_locations: members.flatMap((m) => m.qa_locations ?? []),
    rules,
    rulebooks: Object.assign({}, ...members.map((m) => m.rulebooks)),
    attribution,
    members,
  };
  // Layers: fetch per territory and concatenate; parcel ids in parcels/envelopes are shifted to global ids.
  const cache = new Map<string, Promise<GeoJSON.FeatureCollection>>();
  const layer = (name: string) => {
    if (!cache.has(name)) {
      cache.set(name, Promise.all(loaded.map(async (l, i) => {
        const r = await fetch(`${l.base}/${name}.geojson`);
        if (!r.ok) return [] as GeoJSON.Feature[];
        const fc = (await r.json()) as GeoJSON.FeatureCollection;
        if (name === "parcels" || name === "envelopes") {
          for (const f of fc.features) f.properties = { ...f.properties, id: (f.properties!.id as number) + offsets[i] };
        }
        if (name === "perimeters" || name === "boundary") {
          for (const f of fc.features) f.properties = { ...f.properties, territory_id: l.territory.territory_id };
        }
        return fc.features;
      })).then((parts) => ({ type: "FeatureCollection", features: parts.flat() }) as GeoJSON.FeatureCollection));
    }
    return cache.get(name)!;
  };
  return { territory, parcels, layer };
}
