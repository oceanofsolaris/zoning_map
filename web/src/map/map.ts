import maplibregl, { type Map as MLMap, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { TerritoryData } from "../data/source";
import { layerUrl } from "../data/source";
import { ALLOWED_COLORS, GHOST, HEADROOM_STOPS, INK, NEUTRAL, SCENARIO_STOPS, UTIL_STOPS, stepsToExpr, zoneColor } from "./colors";

export type View = "headroom" | "utilisation" | "allowed" | "scenario" | "zones";
export const VIEWS: View[] = ["headroom", "utilisation", "allowed", "scenario", "zones"];

const BASEMAP = "https://vectortiles.geo.admin.ch/styles/ch.swisstopo.lightbasemap.vt/style.json";
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Feature-state per parcel: c = class (0 no value/grey, 1 value), v = value for the ramp, nt = 1 if not allowed today, sel = selected
export interface ParcelStyle { c: 0 | 1; v: number; nt: 0 | 1; pj: 0 | 1 }

function hatchImage(): ImageData {
  const s = 8, c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  g.strokeStyle = "rgba(120,40,0,0.85)";
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(0, s); g.lineTo(s, 0);
  g.moveTo(-s / 2, s / 2); g.lineTo(s / 2, -s / 2);
  g.moveTo(s / 2, s + s / 2); g.lineTo(s + s / 2, s / 2);
  g.stroke();
  return g.getImageData(0, 0, s, s);
}

function projectImage(): ImageData {
  const s = 8, c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(29,31,33,0.75)";
  g.beginPath(); g.arc(2, 2, 1.1, 0, Math.PI * 2); g.arc(6, 6, 1.1, 0, Math.PI * 2); g.fill();
  return g.getImageData(0, 0, s, s);
}

function uncoveredImage(): ImageData {
  const s = 10, c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(90,90,90,0.12)";
  g.fillRect(0, 0, s, s);
  g.strokeStyle = "rgba(90,90,90,0.35)";
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(s, s); g.stroke();
  return g.getImageData(0, 0, s, s);
}

export class ParcelMap {
  map: MLMap;
  private selected: number | null = null;
  private ready: Promise<void>;
  onSelect: (id: number | null, lngLat?: [number, number]) => void = () => {};
  onMove: (m: [number, number, number]) => void = () => {};

  constructor(container: HTMLElement, private data: TerritoryData, initial?: [number, number, number]) {
    const t = data.territory;
    this.map = new maplibregl.Map({
      container,
      style: BASEMAP,
      ...(initial
        ? { center: [initial[1], initial[0]] as [number, number], zoom: initial[2] }
        : { bounds: (t.focus_bbox ?? t.bbox) as [number, number, number, number], fitBoundsOptions: { padding: 20 } }),
      maxPitch: 70,
      attributionControl: false,
      hash: false,
    });
    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    this.map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
    this.map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "© swisstopo, Kanton Aargau (AGIS), BFS (GWR)" }), "bottom-right");
    // style.load (not load): does not wait for a rendered frame, so hidden tabs initialise too
    this.ready = new Promise((res) => this.map.once("style.load", () => { this.addLayers(); res(); }));
    this.map.on("moveend", () => {
      const c = this.map.getCenter();
      this.onMove([c.lat, c.lng, this.map.getZoom()]);
    });
  }

  whenReady() { return this.ready; }

  private addLayers(): void {
    const m = this.map, d = this.data;
    m.addImage("hatch", hatchImage(), { pixelRatio: 2 });
    m.addImage("uncovered", uncoveredImage(), { pixelRatio: 2 });
    m.addImage("project", projectImage(), { pixelRatio: 2 });
    // Put our layers below the basemap labels
    const firstSymbol = m.getStyle().layers.find((l) => l.type === "symbol")?.id;

    m.addSource("zones", { type: "geojson", data: layerUrl(d, "zones") });
    m.addSource("parcels", { type: "geojson", data: layerUrl(d, "parcels"), promoteId: "id" });
    m.addSource("buildings", { type: "geojson", data: layerUrl(d, "buildings") });
    m.addSource("envelopes", { type: "geojson", data: layerUrl(d, "envelopes") });
    m.addSource("perimeters", { type: "geojson", data: layerUrl(d, "perimeters") });
    m.addSource("ghost", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

    const zoneColorExpr: unknown[] = ["match", ["get", "category"]];
    zoneColorExpr.push("centre", zoneColor("centre", null), "core", zoneColor("core", null), "oldtown", zoneColor("oldtown", null),
      "renewal", zoneColor("renewal", null), "special", zoneColor("special", null), "work", zoneColor("work", null),
      "public", zoneColor("public", null), "residential",
      ["match", ["slice", ["get", "zone"], -1], "2", zoneColor("residential", "W2"), "3", zoneColor("residential", "W3"), "4", zoneColor("residential", "W4"), zoneColor("residential", "W5")],
      "mixed",
      ["match", ["slice", ["get", "zone"], -1], "2", zoneColor("mixed", "WA2"), "3", zoneColor("mixed", "WA3"), "4", zoneColor("mixed", "WA4"), zoneColor("mixed", "WA5")],
      ["case", ["==", ["get", "building_zone"], true], "#efe9dc", "rgba(0,0,0,0)"]);

    m.addLayer({ id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": zoneColorExpr as never, "fill-opacity": 0.75 },
      layout: { visibility: "none" } }, firstSymbol);
    m.addLayer({ id: "zones-line", type: "line", source: "zones", paint: { "line-color": "#8a7f6a", "line-width": 0.6, "line-opacity": 0.6 },
      layout: { visibility: "none" } }, firstSymbol);

    m.addLayer({
      id: "parcels-fill", type: "fill", source: "parcels",
      paint: {
        "fill-color": ["case", ["==", ["feature-state", "c"], 1], stepsToExpr(HEADROOM_STOPS, ["feature-state", "v"]), NEUTRAL] as never,
        "fill-opacity": ["case", ["==", ["feature-state", "c"], 1], 0.82, 0.35] as never,
      },
    }, firstSymbol);
    m.addLayer({
      id: "parcels-hatch", type: "fill", source: "parcels",
      paint: { "fill-pattern": "hatch", "fill-opacity": ["case", ["==", ["feature-state", "nt"], 1], 1, 0] as never },
    }, firstSymbol);
    m.addLayer({
      id: "parcels-project", type: "fill", source: "parcels",
      paint: { "fill-pattern": "project", "fill-opacity": ["case", ["==", ["feature-state", "pj"], 1], 1, 0] as never },
    }, firstSymbol);
    m.addLayer({
      id: "perimeters-uncovered", type: "fill", source: "perimeters", filter: ["==", ["get", "covered"], false],
      paint: { "fill-pattern": "uncovered" },
    }, firstSymbol);
    m.addLayer({
      id: "parcels-line", type: "line", source: "parcels",
      paint: {
        "line-color": INK,
        "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.1, 16, 0.5, 19, 1.0] as never,
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0.15, 16, 0.55] as never,
      },
    }, firstSymbol);
    m.addLayer({
      id: "perimeters-line", type: "line", source: "perimeters",
      paint: { "line-color": INK, "line-width": 1.4, "line-dasharray": [4, 2, 1, 2], "line-opacity": 0.7 },
    }, firstSymbol);
    m.addLayer({
      id: "parcel-selected", type: "line", source: "parcels", filter: ["==", ["id"], -1],
      paint: { "line-color": GHOST, "line-width": 2.5 },
    });
    m.addLayer({
      id: "ghost-ground", type: "line", source: "ghost",
      paint: { "line-color": GHOST, "line-width": 1.5, "line-dasharray": [3, 2] },
    });
    m.addLayer({
      id: "buildings-3d", type: "fill-extrusion", source: "buildings", minzoom: 14.5,
      paint: {
        "fill-extrusion-color": ["case", ["==", ["get", "counts"], true], "#8d8a83", "#b9b5ac"] as never,
        "fill-extrusion-height": ["get", "h"] as never,
        "fill-extrusion-opacity": 0.92,
        "fill-extrusion-vertical-gradient": true,
      },
    });
    m.addLayer({
      id: "ghost-3d", type: "fill-extrusion", source: "ghost",
      paint: {
        "fill-extrusion-color": GHOST,
        "fill-extrusion-height": ["get", "h"] as never,
        "fill-extrusion-opacity": 0.38,
      },
    });

    m.on("click", "parcels-fill", (e) => {
      const f = e.features?.[0];
      this.onSelect(f ? Number(f.id) : null, [e.lngLat.lng, e.lngLat.lat]);
    });
    m.on("mouseenter", "parcels-fill", () => (m.getCanvas().style.cursor = "pointer"));
    m.on("mouseleave", "parcels-fill", () => (m.getCanvas().style.cursor = ""));
  }

  setView(view: View): void {
    const m = this.map;
    const zones = view === "zones";
    m.setLayoutProperty("zones-fill", "visibility", zones ? "visible" : "none");
    m.setLayoutProperty("zones-line", "visibility", zones ? "visible" : "none");
    m.setLayoutProperty("parcels-fill", "visibility", zones ? "none" : "visible");
    m.setLayoutProperty("parcels-project", "visibility", zones ? "none" : "visible");
    m.setLayoutProperty("parcels-hatch", "visibility", view === "headroom" || view === "allowed" ? "visible" : "none");
    const v = ["feature-state", "v"];
    const ramp =
      view === "utilisation" ? stepsToExpr(UTIL_STOPS, v)
      : view === "scenario" ? stepsToExpr(SCENARIO_STOPS, v)
      : view === "allowed" ? ["case", ["==", ["feature-state", "v"], 1], ALLOWED_COLORS.over, ALLOWED_COLORS.ok]
      : stepsToExpr(HEADROOM_STOPS, v);
    m.setPaintProperty("parcels-fill", "fill-color", ["case", ["==", ["feature-state", "c"], 1], ramp, NEUTRAL] as never);
  }

  setParcelStyles(styles: ParcelStyle[]): void {
    const m = this.map;
    for (let id = 0; id < styles.length; id++) m.setFeatureState({ source: "parcels", id }, styles[id] as never);
  }

  select(id: number | null, ghost: GeoJSON.FeatureCollection | null, fly = true): void {
    this.selected = id;
    this.map.setFilter("parcel-selected", ["==", ["id"], id ?? -1]);
    (this.map.getSource("ghost") as GeoJSONSource).setData(ghost ?? { type: "FeatureCollection", features: [] });
    if (id !== null && ghost && fly) {
      const b = bboxOf(ghost);
      if (b) {
        const c: [number, number] = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
        const target = Math.max(this.map.getZoom(), 18.2);
        this.map.easeTo({ center: c, zoom: target, pitch: 55, bearing: this.map.getBearing() || -20, duration: REDUCED_MOTION ? 0 : 900 });
      }
    }
  }

  flyTo(lng: number, lat: number, zoom = 17.5): void {
    this.map.easeTo({ center: [lng, lat], zoom, duration: REDUCED_MOTION ? 0 : 800 });
  }

  // Envelope polygons of one parcel (read from the loaded source, keyed by parcel id)
  async envelopeFeatures(id: number): Promise<GeoJSON.Feature[]> {
    const src = this.map.getSource("envelopes") as GeoJSONSource;
    const all = (await src.getData()) as GeoJSON.FeatureCollection;
    return all.features.filter((f) => f.properties?.id === id);
  }

  get selectedId() { return this.selected; }
}

function bboxOf(fc: GeoJSON.FeatureCollection): number[] | null {
  let b: number[] | null = null;
  const walk = (c: unknown): void => {
    if (typeof (c as number[])[0] === "number") {
      const [x, y] = c as number[];
      b = b ? [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)] : [x, y, x, y];
    } else (c as unknown[]).forEach(walk);
  };
  fc.features.forEach((f) => f.geometry && "coordinates" in f.geometry && walk(f.geometry.coordinates));
  return b;
}
