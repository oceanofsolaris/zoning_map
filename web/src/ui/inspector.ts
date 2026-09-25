import type { Result } from "../engine/capacity";
import type { ParcelRecord, RuleValue, Rulebook, Territory } from "../data/source";
import { t } from "../i18n";
import { FLAGS_SHOWN_ELSEWHERE, renderConstraints } from "./constraints";
import { esc, fmt0, fmt1, fmt2, m2, pct, signed0 } from "./format";

const PARAM_ROWS: [string, string, (v: unknown) => string][] = [
  ["vollgeschosse_max", "Vollgeschosse", (v) => String(v)],
  ["az_max", "Ausnützungsziffer (AZ)", (v) => fmt2(v as number)],
  ["gruenflaechenziffer_min", "Grünflächenziffer", (v) => fmt2(v as number)],
  ["gesamthoehe_max_m", "Gesamthöhe", (v) => `${fmt1(v as number)} m`],
  ["grenzabstand_klein_m", "Grenzabstand klein", (v) => `${fmt1(v as number)} m`],
  ["grenzabstand_gross_m", "Grenzabstand gross", (v) => `${fmt1(v as number)} m`],
  ["empfindlichkeitsstufe", "Empfindlichkeitsstufe", (v) => String(v)],
];

const GKLAS: Record<number, string> = {
  1110: "Einfamilienhaus", 1121: "Zweifamilienhaus", 1122: "Mehrfamilienhaus", 1130: "Wohngebäude für Gemeinschaften",
  1211: "Hotel", 1212: "Kurzfristige Beherbergung", 1220: "Bürogebäude", 1230: "Gross- und Einzelhandel", 1241: "Verkehr/Kommunikation",
  1242: "Garage", 1251: "Industriegebäude", 1252: "Behälter, Silo, Lager", 1261: "Kultur/Freizeit", 1262: "Museum/Bibliothek",
  1263: "Schule/Hochschule", 1264: "Spital/Heim", 1265: "Sporthalle", 1271: "Landwirtschaft", 1272: "Kirche/Kultus",
  1273: "Denkmal", 1274: "Sonstiger Hochbau",
};

function sourceLink(rb: Rulebook, v: RuleValue | undefined): string {
  if (!v || !v.source) return `<span class="muted">${esc(v?.note ?? "–")}</span>`;
  const src = rb.sources.find((s) => s.id === v.source);
  const href = src?.url ? `${src.url}${v.page ? `#page=${v.page}` : ""}` : null;
  const label = `${v.section ?? ""}${v.page ? `, S. ${v.page}` : ""}`;
  const mark = v.verified ? `<span class="ok" title="von Menschen geprüft">✓</span>` : `<span class="unverified" title="noch nicht geprüft">?</span>`;
  const quote = v.quote ? ` title="${esc(v.quote)}"` : "";
  return href ? `<a href="${esc(href)}" target="_blank" rel="noopener"${quote}>${esc(label)}</a> ${mark}` : `${esc(label)} ${mark}`;
}

function zoneOf(territory: Territory, key: string | null) {
  if (!key) return null;
  const [pid, code] = key.split("/");
  const rb = territory.rulebooks[pid];
  const zone = rb?.zones.find((z) => z.code === code);
  return rb && zone ? { rb, zone } : null;
}

export function renderInspector(el: HTMLElement, territory: Territory, p: ParcelRecord | null, base: Result | null,
                                scen: Result | null, scenarioActive: boolean): void {
  if (!p || !base) {
    el.innerHTML = `<div class="empty"><p>${t("parcel.empty")}</p>${qaLinks(territory)}</div>`;
    return;
  }
  const title = p.addresses.length ? esc(p.addresses.slice(0, 2).join(", ")) + (p.addresses.length > 2 ? " …" : "") : `${t("parcel.nr")} ${esc(p.nr)}`;
  const cfg = territory.engine_config;
  const parts = p.facts.parts;
  const total = parts.reduce((a, q) => a + q.area_m2, 0) || 1;
  const zoneList = parts.map((q) => {
    const z = zoneOf(territory, q.zone);
    return `<li>${esc(z?.zone.label_de ?? q.label ?? "Kein Bauland / nicht erfasst")} <span class="num muted">${pct(q.area_m2 / total)}</span></li>`;
  }).join("");

  let html = `<header class="insp-head"><h2>${title}</h2>
    <p class="muted small">${t("parcel.nr")} ${esc(p.nr)} · ${esc(p.egrid)} · ${t("parcel.area")} ${m2(p.facts.area_m2)}</p>
    <ul class="zones">${zoneList}</ul></header>`;

  if (!p.covered) {
    el.innerHTML = html + `<p class="notice">${t("parcel.not_covered")}</p>`;
    return;
  }

  const allowed = base.gf_allowed_m2;
  const existing = base.agf_existing_m2;
  if (allowed !== null) {
    const lo = Math.min(base.gf_allowed_opt_m2 ?? allowed, base.gf_allowed_con_m2 ?? allowed);
    const hi = Math.max(base.gf_allowed_opt_m2 ?? allowed, base.gf_allowed_con_m2 ?? allowed);
    const max = Math.max(allowed, existing, hi, scen?.gf_allowed_m2 ?? 0) * 1.05 || 1;
    const w = (v: number) => `${Math.min(100, (v / max) * 100).toFixed(2)}%`;
    const scenRow = scenarioActive && scen && scen.gf_allowed_m2 !== null
      ? `<div class="bar-row"><span>Mit Szenario</span><div class="track"><div class="fill scen" style="width:${w(scen.gf_allowed_m2)}"></div></div><span class="num">${m2(scen.gf_allowed_m2)}</span></div>`
      : "";
    html += `<section class="figures">
      <div class="big"><span class="label">${t("parcel.reserve")}</span><span class="value num">${m2(base.headroom_gf_m2)}</span>
        <span class="sub">${t("parcel.units", { n: fmt0(base.headroom_units), m: cfg.gf_per_dwelling_m2 })}</span></div>
      <div class="bar-row"><span>${t("parcel.existing")}</span><div class="track"><div class="fill existing" style="width:${w(existing)}"></div></div><span class="num">${m2(existing)}</span></div>
      <div class="bar-row"><span>${t("parcel.allowed")}</span><div class="track">
        <div class="range" style="left:${w(lo)};width:calc(${w(hi)} - ${w(lo)})" title="${t("parcel.range")}"></div>
        <div class="fill allowed" style="width:${w(allowed)}"></div></div><span class="num">${m2(allowed)}</span></div>
      ${scenRow}
      <p class="small muted">aGF = anrechenbare Geschossfläche. Spanne ${m2(lo)}–${m2(hi)}: ${t("parcel.range")}.
        ${scenarioActive && scen?.headroom_gf_m2 != null ? `Szenario: <strong class="num">${signed0((scen.headroom_gf_m2 ?? 0) - (base.headroom_gf_m2 ?? 0))} m²</strong> Reserve.` : ""}</p>
    </section>`;
  }
  html += `<p class="binding binding-${base.binding_constraint}">${t(`binding.${base.binding_constraint}`)}</p>`;

  const at = base.allowed_today;
  const atKey = at === null ? "null" : String(at);
  const ex = base.exceedances.map((e) => t(`exceed.${e}`)).join(", ");
  html += `<p class="badge badge-${atKey}">${t(`allowed.${atKey}`)}${ex ? ` <span class="small">(${esc(ex)})</span>` : ""}</p>`;

  // rule table per zone
  for (const q of parts) {
    const z = zoneOf(territory, q.zone);
    if (!z) continue;
    const { rb, zone } = z;
    html += `<section class="rules"><h3>${t("parcel.rules")}: ${esc(zone.label_de)}</h3>`;
    if (zone.basis) html += `<p class="small">${esc(zone.notes.join(" "))} ${sourceLink(rb, zone.basis)}</p>`;
    if (Object.keys(zone.params).length) {
      html += `<table><tbody>${PARAM_ROWS.map(([k, label, f]) => {
        const v = zone.params[k];
        if (!v) return "";
        const val = v.value === null || v.value === undefined ? "–" : f(v.value);
        return `<tr><th>${label}</th><td class="num">${esc(val)}</td><td class="src">${sourceLink(rb, v)}</td></tr>`;
      }).join("")}</tbody></table>`;
      if (zone.notes.length && !zone.basis) html += `<p class="small muted">${esc(zone.notes.join(" "))}</p>`;
    }
    html += `</section>`;
  }

  // parcel-specific constraints beyond the zone rules (forest distance, Gestaltungsplan, …)
  const member = territory.members?.find((m) => m.territory_id === p.territory_id) ?? territory;
  const domPart = [...parts].sort((a, b) => b.area_m2 - a.area_m2)[0];
  const rb = domPart?.zone ? territory.rulebooks[domPart.zone.split("/")[0]] ?? null : null;
  html += renderConstraints(p.constraints, { member, rulebook: rb });

  // existing building facts
  const bits = [
    p.gklas_main ? GKLAS[p.gklas_main] ?? `GKLAS ${p.gklas_main}` : null,
    p.year_built ? `Baujahr ${p.year_built}` : null,
    p.facts.existing.storeys_max ? `${fmt0(p.facts.existing.storeys_max)} ${p.facts.existing.storeys_max === 1 ? "Geschoss" : "Geschosse"}` : null,
    p.facts.existing.height_max_m ? `Höhe ${fmt1(p.facts.existing.height_max_m)} m` : null,
    p.dwellings ? `${fmt0(p.dwellings)} ${p.dwellings === 1 ? "Wohnung" : "Wohnungen"}` : null,
  ].filter(Boolean);
  html += `<section><h3>${t("parcel.building")}</h3><p class="small">${bits.length ? esc(bits.join(" · ")) : "Keine Hauptbaute"}</p>`;
  if (p.existing_from_dwellings) html += `<p class="small muted">Geschossfläche aus den Wohnungsflächen des GWR geschätzt (Grundfläche × Geschosse wäre hier unplausibel, z. B. bei Terrassenhäusern).</p>`;
  html += `</section>`;
  if (p.projects?.length) {
    html += `<section><h3>${t("project.title")}</h3><ul class="flags">${p.projects.map((q) =>
      `<li>${esc(t(`project.${q.status}`))}: ${q.dwellings ? `${fmt0(q.dwellings)} Wohnungen, ` : ""}≈ ${m2(q.gf_est_m2)} Geschossfläche</li>`).join("")}</ul>
      <p class="small muted">Bewilligte Projekte und solche im Bau zählen hier als gebaut.</p></section>`;
  }

  // flags & confidence
  // notes about the estimate itself (constraints are listed above)
  const flags = [...base.flags, ...(p.facts.area_m2 < cfg.small_parcel_m2 ? ["small_parcel"] : [])].filter((f) => !FLAGS_SHOWN_ELSEWHERE.has(f));
  html += `<section><h3>${t("parcel.flags")}</h3>
    <p class="small">${t("parcel.confidence")}: <strong class="conf conf-${base.confidence}">${t(`conf.${base.confidence}`)}</strong></p>
    <ul class="flags">${flags.map((f) => `<li>${esc(t(`flag.${f}`))}</li>`).join("")}</ul></section>`;

  // Official sources for this parcel (templates per canton: {egrid}, {e}, {n})
  const links = (member.links ?? []).map((l) => {
    const url = l.url.replaceAll("{egrid}", encodeURIComponent(p.egrid))
      .replaceAll("{e}", String(Math.round(p.lv95?.[0] ?? 0))).replaceAll("{n}", String(Math.round(p.lv95?.[1] ?? 0)))
      .replaceAll("{lat}", String(p.wgs84?.[1] ?? 0)).replaceAll("{lng}", String(p.wgs84?.[0] ?? 0));
    return `<li><a href="${esc(url)}" target="_blank" rel="noopener">${esc(l.label)}</a>${l.hint ? ` <span class="small muted">– ${esc(l.hint)}</span>` : ""}</li>`;
  });
  if (links.length) html += `<section><h3>Amtliche Quellen</h3><ul class="links">${links.join("")}</ul></section>`;

  const subject = encodeURIComponent(`Fehler Parzelle ${p.nr} (${p.egrid})`);
  // Build the link from the parcel itself: location.href is updated only after rendering.
  const link = `${location.origin}${location.pathname}#t=${p.territory_id ?? territory.territory_id}&p=${p.egrid}`;
  const body = encodeURIComponent(`Parzelle ${p.nr}, EGRID ${p.egrid}\nLink: ${link}\n\nWas stimmt nicht?\n`);
  html += `<p class="report"><a href="https://github.com/oceanofsolaris/upzone_me/issues/new?title=${subject}&body=${body}" target="_blank" rel="noopener">${t("parcel.report")}</a>
    · <span class="small muted">${t("parcel.envelope")}</span></p>`;
  el.innerHTML = html;
}

function qaLinks(territory: Territory): string {
  if (!territory.qa_locations?.length) return "";
  return `<p class="small muted">Beispiele:</p><ul class="qa">${territory.qa_locations.map((q) =>
    `<li><button class="link-btn" data-fly="${q.lon},${q.lat}">${esc(q.label)}</button></li>`).join("")}</ul>`;
}
