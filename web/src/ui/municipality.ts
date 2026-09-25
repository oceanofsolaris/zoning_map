import type { BlockerRow, Result, Scenario, Totals } from "../engine/capacity";
import type { ParcelRecord, Territory } from "../data/source";
import { t } from "../i18n";
import { UTIL_STOPS } from "../map/colors";
import { barChart, histogram, stackedBar } from "./charts";
import { download, esc, fmt0, m2, signed0 } from "./format";

export interface MuniProps {
  territory: Territory; parcels: ParcelRecord[]; base: Result[]; baseTotals: Totals;
  scen: Result[] | null; scenTotals: Totals | null; scenario: Scenario; blockers: BlockerRow[];
  onScenario: (s: Scenario) => void;
  scopes: { id: string; label: string }[]; scope: string; onScope: (scope: string) => void;
  getScenario: () => Scenario;
}

function zoneLabel(territory: Territory, key: string): string {
  if (key === "*") return t("muni.all_zones");
  const [pid, code] = key.split("/");
  const rb = territory.rulebooks[pid];
  const z = rb?.zones.find((q) => q.code === code);
  if (!z) return key;
  // with several rulebooks loaded, codes repeat (W2 in Brugg and in Windisch)
  return Object.keys(territory.rulebooks).length > 1 ? `${z.code} ${rb.municipality.name}` : z.code;
}

function utilColor(v: number): string {
  let c = UTIL_STOPS[0][1];
  for (const [s, col] of UTIL_STOPS) if (v >= s) c = col;
  return c;
}

export function scenarioZones(territory: Territory): { key: string; code: string; label: string; group: string; bonuses: { id: string; label_de: string }[] }[] {
  const out = [];
  for (const [pid, rb] of Object.entries(territory.rulebooks)) {
    const group = territory.perimeters.find((p) => p.id === pid)?.label ?? rb.scope_de;
    for (const z of rb.zones) {
      if (z.residential && !z.discretionary) out.push({ key: `${pid}/${z.code}`, code: z.code, label: z.label_de, group, bonuses: z.bonuses });
    }
  }
  return out;
}

// Static skeleton (sliders keep focus across re-renders); dynamic parts are filled by update().
export function mountMunicipality(el: HTMLElement, props: MuniProps): (p: MuniProps) => void {
  // Only the current Gemeinde: its planning perimeters, their zones and bonuses
  const member = (props.territory.members ?? [props.territory]).find((m) => m.territory_id === props.scope) ?? props.territory;
  const pids = new Set(member.perimeters.map((p) => p.id));
  const zones = scenarioZones(props.territory).filter((z) => pids.has(z.key.split("/")[0]));
  // bonus switches are scoped to the planning perimeter: "<perimeter>/<bonus id>"
  const bonusIds = new Map<string, string>();
  zones.forEach((z) => z.bonuses.forEach((b) => {
    const pid = z.key.split("/")[0];
    bonusIds.set(`${pid}/${b.id}`, pids.size > 1 && member.perimeters.filter((p) => p.covered).length > 1 ? `${b.label_de} (${z.group})` : b.label_de);
  }));
  const ownZoneKeys = new Set(zones.map((z) => z.key));
  const covered = member.perimeters.filter((p) => p.covered).map((p) => p.label).join(", ");
  const missing = member.perimeters.filter((p) => !p.covered).map((p) => p.label).join(", ") || "–";
  const multi = props.scopes.length > 1;
  const groups = [...new Set(zones.map((z) => z.group))];
  const sliderRow = (z: (typeof zones)[number]) => `<tr data-zone="${esc(z.key)}"><th title="${esc(z.label)}">${esc(z.code)}</th>
        <td><input type="range" min="0" max="0.6" step="0.05" value="0" aria-label="Δ AZ ${esc(z.label)} ${esc(z.group)}" data-k="az" /><output class="num">+0.00</output></td>
        <td><div class="seg" role="group" aria-label="Δ Geschosse ${esc(z.label)}">${[0, 1, 2].map((n) => `<button type="button" data-k="vg" data-v="${n}" aria-pressed="${n === 0}">${n ? `+${n}` : "0"}</button>`).join("")}</div></td></tr>`;

  el.innerHTML = `
    <section>${multi
      ? `<label class="scope"><span class="small muted">Gemeinde</span><select id="muni-scope">${props.scopes.map((sc) => `<option value="${esc(sc.id)}"${sc.id === props.scope ? " selected" : ""}>${esc(sc.label)}</option>`).join("")}</select></label>`
      : `<h2>${esc(props.territory.name)}</h2>`}
      <p class="small muted">${t("muni.coverage", { covered: esc(covered), missing: esc(missing) })}</p></section>
    <section><h3>${t("muni.totals")}</h3><div id="muni-totals" class="totals"></div><p class="small muted">${t("muni.capacity_note")} <a href="#" data-open-method>Annahmen</a></p></section>
    <section><h3>${t("muni.hist")}</h3><div id="muni-hist"></div></section>
    <section><h3>${t("muni.binding")}</h3><div id="muni-binding"></div></section>
    <section class="scenario"><h3>${t("muni.scenario")}</h3><p class="small muted">${t("muni.scenario_hint")}</p>
      <table class="sliders"><thead><tr><th>Zone</th><th>Δ AZ</th><th>Δ Geschosse</th></tr></thead><tbody>
      ${groups.map((g) => (groups.length > 1 ? `<tr class="group"><th colspan="3">${esc(g)}</th></tr>` : "") + zones.filter((z) => z.group === g).map(sliderRow).join("")).join("")}
      </tbody></table>
      <fieldset class="bonuses"><legend class="small">${t("muni.bonuses")}</legend>
        ${[...bonusIds].map(([id, label]) => `<label><input type="checkbox" data-bonus="${esc(id)}" /> ${esc(label)}</label>`).join("")}</fieldset>
      <button type="button" class="link-btn" id="scen-reset">${t("muni.reset")}</button>
      <div id="scen-delta" class="delta"></div>
    </section>
    <section><h3>${t("muni.blockers")}</h3><p class="small muted">${t("muni.blockers_note")}</p><div id="muni-blockers"></div></section>
    <section><h3>${t("muni.export")}</h3><p class="exports">
      <button type="button" class="btn" id="exp-csv">${t("muni.csv")}</button>
      <button type="button" class="btn" id="exp-bl-csv">${t("muni.blockers_csv")}</button>
      <button type="button" class="btn" id="exp-bl-svg">${t("muni.blockers_svg")}</button></p></section>`;

  // Remounting reuses the element: drop the previous mount's listeners, or they would act on this Gemeinde's DOM
  const host = el as HTMLElement & { _mount?: AbortController };
  host._mount?.abort();
  const mount = (host._mount = new AbortController());
  const opts = { signal: mount.signal };
  let current = props;
  el.querySelector<HTMLSelectElement>("#muni-scope")?.addEventListener("change", (e) => current.onScope((e.target as HTMLSelectElement).value), opts);
  // Merge this Gemeinde's controls into the global scenario; other Gemeinden keep their settings.
  const read = (): Scenario => {
    const prev = current.getScenario();
    const s: Scenario = {
      zones: Object.fromEntries(Object.entries(prev.zones ?? {}).filter(([k]) => !ownZoneKeys.has(k))),
      bonuses: Object.fromEntries(Object.entries(prev.bonuses ?? {}).filter(([k]) => !bonusIds.has(k))),
    };
    el.querySelectorAll<HTMLTableRowElement>("tr[data-zone]").forEach((tr) => {
      const az = Number(tr.querySelector<HTMLInputElement>("input[data-k=az]")!.value);
      const vg = Number(tr.querySelector<HTMLButtonElement>("button[aria-pressed=true]")?.dataset.v ?? 0);
      if (az || vg) s.zones![tr.dataset.zone!] = { d_az: az, d_vg: vg };
    });
    el.querySelectorAll<HTMLInputElement>("input[data-bonus]").forEach((c) => { if (c.checked) s.bonuses![c.dataset.bonus!] = true; });
    return s;
  };
  const write = (s: Scenario) => {
    el.querySelectorAll<HTMLTableRowElement>("tr[data-zone]").forEach((tr) => {
      const d = s.zones?.[tr.dataset.zone!] ?? {};
      const inp = tr.querySelector<HTMLInputElement>("input[data-k=az]")!;
      inp.value = String(d.d_az ?? 0);
      tr.querySelector("output")!.textContent = `+${(d.d_az ?? 0).toFixed(2)}`;
      tr.querySelectorAll<HTMLButtonElement>("button[data-k=vg]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.v) === (d.d_vg ?? 0))));
    });
    el.querySelectorAll<HTMLInputElement>("input[data-bonus]").forEach((c) => (c.checked = !!s.bonuses?.[c.dataset.bonus!]));
  };
  write(props.scenario);

  el.addEventListener("input", (e) => {
    const inp = e.target as HTMLInputElement;
    if (inp.dataset.k === "az") inp.parentElement!.querySelector("output")!.textContent = `+${Number(inp.value).toFixed(2)}`;
    if (inp.dataset.k === "az" || inp.dataset.bonus) current.onScenario(read());
  }, opts);
  el.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (!b) return;
    if (b.dataset.k === "vg") {
      b.parentElement!.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      current.onScenario(read());
    } else if (b.id === "scen-reset") {
      write({});
      current.onScenario(read());
    } else if (b.id === "exp-csv") exportParcels(current);
    else if (b.id === "exp-bl-csv") exportBlockers(current);
    else if (b.id === "exp-bl-svg") download(`${current.scope}-regelaenderungen.svg`, blockerSvg(current), "image/svg+xml");
  }, opts);

  const update = (p: MuniProps) => {
    current = p;
    const b = p.baseTotals;
    el.querySelector("#muni-totals")!.innerHTML = `
      <dl><div><dt>${t("muni.existing")}</dt><dd class="num">${m2(b.agf_existing_m2)}</dd></div>
      <div><dt>${t("muni.allowed")}</dt><dd class="num">${m2(b.gf_allowed_m2)}</dd></div>
      <div class="hl"><dt>${t("muni.reserve")}</dt><dd class="num">${m2(b.headroom_gf_m2)}</dd></div>
      <div><dt>${t("muni.units")}</dt><dd class="num">${fmt0(b.headroom_units)}</dd></div>
      <div><dt>${t("muni.residents")}</dt><dd class="num">${fmt0(b.headroom_residents)}</dd></div></dl>`;

    const utils = p.base.map((r, i) => (p.parcels[i].covered && r.utilisation !== null && r.gf_allowed_m2! > 0 ? r.utilisation : null)).filter((v): v is number => v !== null);
    const bins = Array.from({ length: 16 }, (_, i) => i * 0.1);
    el.querySelector("#muni-hist")!.innerHTML = histogram(utils, {
      bins, colors: utilColor,
      label: (lo, hi) => (hi === undefined ? `≥ ${lo.toFixed(1)}` : `${lo.toFixed(1)}–${hi.toFixed(1)}`),
    }) + `<p class="small muted">${fmt0(utils.length)} Wohnparzellen; Strich = 1.0 (voll ausgenützt).</p>`;

    const cnt = { az: 0, envelope: 0, discretionary: 0 };
    p.base.forEach((r, i) => {
      if (!p.parcels[i].covered || r.flags.includes("infrastructure")) return;
      if (r.binding_constraint in cnt) cnt[r.binding_constraint as keyof typeof cnt]++;
    });
    el.querySelector("#muni-binding")!.innerHTML = stackedBar([
      { label: "Ausnützungsziffer", value: cnt.az, color: "#2c7fb8" },
      { label: "Gebäudehülle", value: cnt.envelope, color: "#7fcdbb" },
      { label: "Einzelfall / Sonderregeln", value: cnt.discretionary, color: "#b8764b" },
    ]);

    const d = el.querySelector("#scen-delta")!;
    if (p.scen && p.scenTotals) {
      const s = p.scenTotals;
      // Δ allowed floor area per zone, attributed to the zone of each parcel part
      const dz = new Map<string, number>();
      p.scen.forEach((r, i) => {
        r.parts.forEach((q, k) => {
          const dd = (q.gf ?? 0) - (p.base[i].parts[k]?.gf ?? 0);
          if (Math.abs(dd) > 0.01 && q.zone) dz.set(q.zone, (dz.get(q.zone) ?? 0) + dd);
        });
      });
      d.innerHTML = `<h4>${t("muni.delta")}</h4><dl class="deltas">
        <div><dt>Geschossfläche erlaubt</dt><dd class="num">${signed0(s.gf_allowed_m2 - b.gf_allowed_m2)} m²</dd></div>
        <div class="hl"><dt>Reserve</dt><dd class="num">${signed0(s.headroom_gf_m2 - b.headroom_gf_m2)} m²</dd></div>
        <div><dt>≈ Wohnungen</dt><dd class="num">${signed0(s.headroom_units - b.headroom_units)}</dd></div>
        <div><dt>≈ Personen</dt><dd class="num">${signed0(s.headroom_residents - b.headroom_residents)}</dd></div></dl>
        ${dz.size ? `<p class="small muted">Erlaubte Geschossfläche je Zone:</p><table class="small"><tbody>${[...dz].sort((a, c) => c[1] - a[1]).map(([k, v]) => `<tr><th>${esc(zoneLabel(p.territory, k))}</th><td class="num">${signed0(v)} m²</td></tr>`).join("")}</tbody></table>` : ""}`;
    } else d.innerHTML = "";

    el.querySelector("#muni-blockers")!.innerHTML = blockerSvg(p);
  };
  update(props);
  return update;
}

function blockerRows(p: MuniProps) {
  return p.blockers.filter((r) => r.d_headroom_gf_m2 > 0).slice(0, 14).map((r) => ({
    label: `${r.label_de} · ${zoneLabel(p.territory, r.zone)}`,
    value: r.d_headroom_gf_m2,
    sub: `${fmt0(r.d_headroom_gf_m2)} m² · ≈${fmt0(r.d_headroom_units)} Whg.`,
    highlight: r.zone === "*",
  }));
}

function blockerSvg(p: MuniProps): string {
  return barChart(blockerRows(p), t("muni.blockers"), "Zusätzliche Reserve (m² aGF)");
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function exportParcels(p: MuniProps): void {
  const cols = ["egrid", "parcel_no", "perimeter", "addresses", "area_m2", "zones", "gf_existing_agf_m2", "gf_allowed_m2", "gf_allowed_opt_m2",
    "gf_allowed_con_m2", "utilisation", "headroom_gf_m2", "headroom_units", "binding_constraint", "allowed_today", "exceedances", "confidence", "flags",
    "scenario_gf_allowed_m2", "scenario_headroom_gf_m2"];
  const rows = p.parcels.map((q, i) => {
    const r = p.base[i], s = p.scen?.[i];
    const round = (v: number | null | undefined) => (v === null || v === undefined ? "" : Math.round(v * 10) / 10);
    return [q.egrid, q.nr, q.perimeter, q.addresses.join(" / "), round(q.facts.area_m2),
      q.facts.parts.map((z) => z.zone ?? "–").join(" / "), round(r.agf_existing_m2), round(r.gf_allowed_m2), round(r.gf_allowed_opt_m2),
      round(r.gf_allowed_con_m2), r.utilisation === null ? "" : r.utilisation.toFixed(3), round(r.headroom_gf_m2), r.headroom_units ?? "",
      r.binding_constraint, r.allowed_today ?? "", r.exceedances.join(" "), r.confidence, r.flags.join(" "),
      round(s?.gf_allowed_m2), round(s?.headroom_gf_m2)].map(csvCell).join(";");
  });
  const head = `# ${p.territory.name} – Parzellenpotenzial. Unverbindliche Schätzung; Quellen: Kanton Aargau (AGIS), swisstopo, BFS (GWR). Stand ${p.territory.built_at}`;
  download(`${p.scope}-parzellen.csv`, [head, cols.join(";"), ...rows].join("\n"), "text/csv;charset=utf-8");
}

function exportBlockers(p: MuniProps): void {
  const rows = p.blockers.map((r) => [r.lever, zoneLabel(p.territory, r.zone), Math.round(r.d_headroom_gf_m2), r.d_headroom_units, Math.round(r.d_gf_allowed_m2)].map(csvCell).join(";"));
  download(`${p.scope}-regelaenderungen.csv`, ["lever;zone;d_headroom_gf_m2;d_headroom_units;d_gf_allowed_m2", ...rows].join("\n"), "text/csv;charset=utf-8");
}
