import "./styles.css";

// Debug: ?raf=timeout drives rendering with timers so hidden/background tabs (e.g. automated checks) still draw.
if (new URLSearchParams(location.search).get("raf") === "timeout") {
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 16);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
}
import { blockerRanking, computeAll, computeParcel, summarise, type Result, type Scenario } from "./engine/capacity";
import { loadIndex, loadTerritory, type TerritoryData } from "./data/source";
import { applyI18n, t } from "./i18n";
import { cssGradient, HEADROOM_STOPS, SCENARIO_STOPS, UTIL_STOPS, ALLOWED_COLORS, NEUTRAL } from "./map/colors";
import { ParcelMap, VIEWS, type ParcelStyle, type View } from "./map/map";
import { createStore } from "./store";
import { renderInspector } from "./ui/inspector";
import { renderMethodology } from "./ui/methodology";
import { mountMunicipality } from "./ui/municipality";
import { mountSearch } from "./ui/search";
import { readUrl, writeUrl } from "./url";

interface State { view: View; selected: number | null; scenario: Scenario; tab: "parcel" | "muni" }

const isEmpty = (s: Scenario) => !Object.values(s.zones ?? {}).some((d) => d.d_az || d.d_vg) && !Object.values(s.bonuses ?? {}).some(Boolean);

async function main() {
  applyI18n();
  const url = readUrl();
  const index = await loadIndex();
  const entry = index.find((e) => e.territory_id === url.t) ?? index[0];
  const data: TerritoryData = await loadTerritory(entry);
  const { territory, parcels } = data;
  document.getElementById("territory-name")!.textContent = `${territory.name} ${territory.canton}`;
  document.getElementById("attribution")!.textContent = "Quellen: Kanton Aargau (AGIS, ÖREB-Kataster), swisstopo, Bundesamt für Statistik (GWR)";

  const cfg = territory.engine_config;
  const facts = parcels.map((p) => p.facts);
  const base: Result[] = computeAll(facts, territory.rules, cfg);
  const baseTotals = summarise(base);
  const blockers = blockerRanking(facts, territory.rules, cfg);
  let scen: Result[] | null = null;

  const store = createStore<State>({
    view: VIEWS.includes(url.v as View) ? (url.v as View) : "headroom",
    selected: url.p ? parcels.find((p) => p.egrid === url.p)?.id ?? null : null,
    scenario: url.scenario ?? {},
    tab: url.p ? "parcel" : "muni",
  });

  const pmap = new ParcelMap(document.getElementById("map")!, data, url.m);
  await pmap.whenReady();
  document.getElementById("loading")!.hidden = true;

  // ---------- styling
  const styles = (): ParcelStyle[] => {
    const v = store.get().view;
    return parcels.map((p, i) => {
      const r = base[i];
      const nt: 0 | 1 = r.allowed_today === false ? 1 : 0;
      const pj: 0 | 1 = r.flags.includes("im_bau") || r.flags.includes("bewilligt") ? 1 : 0;
      if (!p.covered) return { c: 0, v: 0, nt: 0, pj: 0 };
      const area = p.facts.area_m2 || 1;
      switch (v) {
        case "utilisation": return r.utilisation === null || !r.gf_allowed_m2 ? { c: 0, v: 0, nt, pj } : { c: 1, v: r.utilisation, nt, pj };
        case "allowed": return r.allowed_today === null ? { c: 0, v: 0, nt, pj } : { c: 1, v: r.allowed_today ? 0 : 1, nt, pj };
        case "scenario": {
          const s = scen?.[i];
          if (r.gf_allowed_m2 === null) return { c: 0, v: 0, nt: 0, pj };
          const d = s ? ((s.headroom_gf_m2 ?? 0) - (r.headroom_gf_m2 ?? 0)) / area : 0;
          return { c: 1, v: d, nt: 0, pj };
        }
        default: return r.gf_allowed_m2 === null ? { c: 0, v: 0, nt, pj } : { c: 1, v: (r.headroom_gf_m2 ?? 0) / area, nt, pj };
      }
    });
  };
  const restyle = () => pmap.setParcelStyles(styles());

  // ---------- views + legend
  const viewsEl = document.getElementById("views")!;
  viewsEl.innerHTML = VIEWS.map((v) => `<button type="button" data-view="${v}">${t(`view.${v}`)}</button>`).join("");
  viewsEl.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (b?.dataset.view) store.set({ view: b.dataset.view as View });
  });
  const legend = document.getElementById("legend")!;
  const renderLegend = (v: View) => {
    viewsEl.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === v)));
    const none = `<li><i style="background:${NEUTRAL}"></i>${t("legend.none")}</li><li><i class="sw-uncovered"></i>${t("legend.not_covered")}</li>`;
    const hatch = `<li><i class="sw-hatch"></i>${t("legend.hatch")}</li><li><i class="sw-project"></i>${t("legend.project")}</li>`;
    const ramp = (stops: [number, string][], lo: string, hi: string) =>
      `<div class="ramp" style="background:${cssGradient(stops)}"></div><div class="ramp-labels num"><span>${lo}</span><span>${hi}</span></div>`;
    const body =
      v === "headroom" ? ramp(HEADROOM_STOPS, "0", "≥ 1.6 m²/m²") + `<ul>${hatch}${none}</ul>`
      : v === "utilisation" ? ramp(UTIL_STOPS, "0", "≥ 1.6") + `<ul><li><i class="sw-project"></i>${t("legend.project")}</li>${none}</ul>`
      : v === "allowed" ? `<ul><li><i style="background:${ALLOWED_COLORS.ok}"></i>${t("legend.within")}</li><li><i style="background:${ALLOWED_COLORS.over}"></i>${t("legend.over")}</li>${none}</ul>`
      : v === "scenario" ? ramp(SCENARIO_STOPS, "0", "≥ 0.6 m²/m²") + (isEmpty(store.get().scenario) ? `<p class="small">Noch kein Szenario gewählt – Regler unter «Gemeinde».</p>` : "") + `<ul>${none}</ul>`
      : `<ul class="zone-legend">${[["#f7d95c", "Wohnzonen"], ["#f2a65a", "Wohn- und Arbeitszonen"], ["#b8764b", "Zentrum, Kern, Altstadt"],
          ["#a58ecf", "Arbeitszonen"], ["#9fb3c8", "Öffentliche Bauten"], ["#c8a2c8", "Spezialzonen"]].map(([c, l]) => `<li><i style="background:${c}"></i>${l}</li>`).join("")}</ul>`;
    legend.innerHTML = `<h4>${t(`view.${v}`)}</h4><p class="small">${t(`legend.${v}`)}</p>${body}`;
  };

  // ---------- panels
  const panel = document.getElementById("panel")!;
  const paneParcel = document.getElementById("pane-parcel")!;
  const paneMuni = document.getElementById("pane-muni")!;
  document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) =>
    b.addEventListener("click", () => store.set({ tab: b.dataset.tab as State["tab"] })));
  const renderTabs = (tab: State["tab"]) => {
    document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    paneParcel.hidden = tab !== "parcel";
    paneMuni.hidden = tab !== "muni";
  };

  const muniProps = () => ({
    territory, parcels, base, baseTotals, scen, scenTotals: scen ? summarise(scen) : null,
    scenario: store.get().scenario, blockers, onScenario: (s: Scenario) => store.set({ scenario: s }),
  });
  const updateMuni = mountMunicipality(paneMuni, muniProps());

  const ghostFor = async (id: number): Promise<GeoJSON.FeatureCollection> => {
    const s = store.get();
    const res = !isEmpty(s.scenario) ? computeParcel(parcels[id].facts, territory.rules, cfg, s.scenario) : base[id];
    const feats = await pmap.envelopeFeatures(id);
    return {
      type: "FeatureCollection",
      features: feats.map((f) => {
        const part = res.parts[f.properties!.pidx as number];
        const h = part && part.gf && part.gf > 0 ? part.env_height ?? 0 : 0;
        return { ...f, properties: { ...f.properties, h } };
      }).filter((f) => f.properties.h > 0),
    };
  };

  const renderParcel = async (fly: boolean) => {
    const { selected, scenario } = store.get();
    const p = selected === null ? null : parcels[selected];
    const active = !isEmpty(scenario);
    renderInspector(paneParcel, territory, p, selected === null ? null : base[selected],
      selected !== null && active ? computeParcel(parcels[selected].facts, territory.rules, cfg, scenario) : null, active);
    pmap.select(selected, selected === null ? null : await ghostFor(selected), fly);
  };
  paneParcel.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-fly]");
    if (b) { const [lon, lat] = b.dataset.fly!.split(",").map(Number); pickAt(lon, lat); }
  });

  pmap.onSelect = (id) => store.set({ selected: id, tab: id === null ? store.get().tab : "parcel" });
  pmap.onMove = (m) => { mapPos = m; syncUrl(); };
  let mapPos: [number, number, number] | undefined = url.m;

  const pickAt = (lon: number, lat: number) => {
    pmap.flyTo(lon, lat);
    pmap.map.once("moveend", () => {
      const pt = pmap.map.project([lon, lat]);
      const f = pmap.map.queryRenderedFeatures(pt, { layers: ["parcels-fill"] })[0];
      if (f) store.set({ selected: Number(f.id), tab: "parcel" });
    });
  };
  mountSearch(document.getElementById("search-form") as HTMLFormElement, document.getElementById("search") as HTMLInputElement,
    document.getElementById("search-results") as HTMLUListElement, territory.bbox_lv95 ?? [], pickAt);

  const dlg = document.getElementById("methodology") as HTMLDialogElement;
  renderMethodology(dlg, territory);
  const openMethod = () => dlg.showModal();
  document.getElementById("open-methodology")!.addEventListener("click", openMethod);
  document.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-open-method]")) { e.preventDefault(); openMethod(); }
  });

  const syncUrl = () => {
    const s = store.get();
    writeUrl({ t: territory.territory_id, p: s.selected === null ? undefined : parcels[s.selected].egrid, v: s.view, scenario: s.scenario, m: mapPos });
  };

  // mobile bottom sheet: tap the grip to expand/collapse
  document.getElementById("panel-grip")!.addEventListener("click", () => panel.classList.toggle("expanded"));

  // ---------- reactions
  let raf = 0;
  store.subscribe((s, changed) => {
    if (changed.has("scenario")) {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        scen = isEmpty(s.scenario) ? null : computeAll(facts, territory.rules, cfg, s.scenario);
        updateMuni(muniProps());
        if (s.view === "scenario") restyle();
        else if (!isEmpty(s.scenario)) store.set({ view: "scenario" });
        if (s.selected !== null) renderParcel(false);
        renderLegend(store.get().view);
      });
    }
    if (changed.has("view")) { pmap.setView(s.view); restyle(); renderLegend(s.view); }
    if (changed.has("selected")) renderParcel(true);
    if (changed.has("tab")) renderTabs(s.tab);
    syncUrl();
  });

  // ---------- initial render
  if (!isEmpty(store.get().scenario)) scen = computeAll(facts, territory.rules, cfg, store.get().scenario);
  updateMuni(muniProps());
  pmap.setView(store.get().view);
  restyle();
  renderLegend(store.get().view);
  renderTabs(store.get().tab);
  renderParcel(store.get().selected !== null && !url.m);
  (window as unknown as Record<string, unknown>).__pp = { store, territory, parcels, base, pmap };
}

main().catch((e) => {
  console.error(e);
  const el = document.getElementById("loading");
  if (el) { el.hidden = false; el.textContent = `Fehler beim Laden: ${e.message}. Wurde «make build» ausgeführt?`; }
});
