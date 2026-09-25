import type { Territory } from "../data/source";
import { t } from "../i18n";
import { esc, fmt2 } from "./format";

const CFG_DOC: Record<string, string> = {
  gf_per_dwelling_m2: "Geschossfläche pro zusätzliche Wohnung (m²)",
  gf_per_resident_m2: "Geschossfläche pro Person (m²; ≈ 46 m² Wohnfläche × 1.2)",
  storey_height_m: "Geschosshöhe (m)",
  attika_factor: "Dach-/Attikageschoss als Anteil eines Vollgeschosses (wo die BNO nichts regelt)",
  envelope_to_agf: "Anteil der Hülle, der als anrechenbare Geschossfläche zählt",
  net_to_gross: "Wohnfläche (GWR) → Geschossfläche",
  existing_to_agf: "Grundfläche × Geschosse → anrechenbare Geschossfläche (kalibriert)",
  tol_gf: "Toleranz Geschossfläche bei «heute zulässig?»",
  tol_height_m: "Toleranz Gesamthöhe (m)",
  setback_mode: "Grenzabstand für die Hauptzahl (optimistisch = kleiner Abstand ringsum)",
  default_grenzabstand_m: "Grenzabstand, falls das Regelwerk keinen nennt (m)",
  scenario_storey_raises_height: "Ein zusätzliches Geschoss im Szenario erhöht auch die Gesamthöhe",
  small_parcel_m2: "Parzellen darunter: Verlässlichkeit tief",
  setback_range_medium_threshold: "Spanne optimistisch/konservativ, ab der die Verlässlichkeit «mittel» ist",
};

export function renderMethodology(dlg: HTMLDialogElement, territory: Territory): void {
  const cfg = territory.engine_config as Record<string, unknown>;
  const cal = territory.qa.calibration ?? {};
  const rbs = Object.entries(territory.rulebooks);
  const qa = territory.qa;
  dlg.innerHTML = `<form method="dialog" class="modal-inner">
    <header><h2>${t("method.title")}</h2><button class="close" aria-label="Schliessen">×</button></header>
    <div class="modal-body">
    <p class="lead">Für jede Parzelle schätzt das Werkzeug, wie viel anrechenbare Geschossfläche (aGF) die geltende Bau- und
    Nutzungsordnung erlaubt, wie viel heute gebaut ist und welche Regel begrenzt. Es ist eine grobe, transparente Schätzung,
    keine Rechtsauskunft und keine Bauprognose.</p>
    <h3>So wird gerechnet</h3>
    <ol>
      <li><b>Zonenteile:</b> Parzellen (amtliche Vermessung) werden mit dem Bauzonenplan verschnitten; jede Zone wird separat gerechnet.</li>
      <li><b>Erlaubt nach Ausnützungsziffer:</b> AZ × Fläche des Zonenteils. In Brugg zählen Dach-, Attika- und Untergeschosse nicht zur AZ (§ 74 BNO); das Attikageschoss wird deshalb proportional zur gebauten Grundfläche dazugerechnet.</li>
      <li><b>Erlaubt nach Gebäudehülle:</b> Parzelle abzüglich Grenzabstand (optimistisch: kleiner Grenzabstand ringsum; konservativ: grosser) × (Vollgeschosse + Attika) × ${fmt2(cfg.envelope_to_agf as number)}. Wo Gebäude beidseits an die Grenze gebaut sind und die geschlossene Bauweise zulässig ist, gilt dort kein Grenzabstand.</li>
      <li><b>Erlaubt</b> = das Kleinere der beiden; das entscheidet, welche Regel «begrenzt».</li>
      <li><b>Gebaut:</b> Gebäudegrundfläche (amtliche Vermessung) × Geschosse (GWR, sonst aus der Höhe von swissBUILDINGS3D) × Kalibrierfaktor. Garagen und Kleinbauten zählen nicht.</li>
      <li><b>Reserve</b> = Erlaubt − Gebaut (nie negativ). Wohnungen = Reserve ÷ ${cfg.gf_per_dwelling_m2} m².</li>
    </ol>
    <h3>Kalibrierung</h3>
    <p>Neubauten ab ${esc(cal.min_year)} sollten ihr erlaubtes Mass ungefähr ausschöpfen. Aus ${esc(cal.n_samples)} solchen Parzellen
    (Median der Rohausnützung ${esc(cal.raw_median_utilisation ?? "–")}) ergibt sich <b>existing_to_agf = ${esc(cal.factor ?? cfg.existing_to_agf)}</b>
    (Ziel-Median ${esc(cal.target_median_utilisation)}).</p>
    <h3>Annahmen (Parameter)</h3>
    <table class="cfg"><tbody>${Object.entries(CFG_DOC).map(([k, d]) => `<tr><th><code>${k}</code></th><td>${esc(d)}</td><td class="num">${esc(cfg[k])}</td></tr>`).join("")}</tbody></table>
    <h3>Regelwerke</h3>
    ${rbs.map(([pid, rb]) => {
      const vals = rb.zones.flatMap((z) => Object.values(z.params).filter((v) => v && v.source));
      const ver = vals.filter((v) => v.verified).length;
      return `<p><b>${esc(rb.scope_de)}</b> (${esc(pid)}, Version ${esc(rb.version)}): ${ver} von ${vals.length} Werten von Menschen geprüft.
        Erfasst ${esc(rb.compiled_by)}.</p><ul>${rb.sources.map((s) => `<li>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>` : esc(s.title)}${s.note ? ` – <span class="muted">${esc(s.note)}</span>` : ""}</li>`).join("")}</ul>`;
    }).join("")}
    <p>Nicht erfasst: ${territory.perimeters.filter((p) => !p.covered).map((p) => esc(p.label)).join(", ") || "–"}.</p>
    <h3>Grenzen und bekannte Lücken</h3>
    <ul>
      <li>Gestaltungspläne, Arealüberbauungen, Hochhausstandorte und Nachverdichtungsgebiete ändern die Grundregeln; sie werden markiert, nicht gerechnet.</li>
      <li>Der Waldabstand (Aargau: 18 m ab statischer Waldgrenze bzw. Wald, § 48 BauG) wird von der bebaubaren Fläche abgezogen; bestehende Gebäude darin sind markiert (Besitzstand). Kommunale Waldabstandslinien und Ausnahmebewilligungen sind nicht berücksichtigt.</li>
      <li>Baulinien und Strassenabstände sind nicht berücksichtigt; der Grenzabstand wird ringsum angesetzt.</li>
      <li>Höhen werden nicht ab massgebendem Terrain gemessen; am Hang ist die Hülle ungenau.</li>
      <li>Stockwerkeigentum ist in offenen Daten nicht sichtbar, verhindert in der Praxis aber oft Erneuerungen.</li>
      <li>Kapazität ist kein Angebot: Die Reserve ist ein theoretisches Maximum nach heutigen Regeln.</li>
      <li>Keine Angaben zu Eigentümerinnen und Eigentümern oder Bewohnerinnen und Bewohnern.</li>
    </ul>
    <h3>Datenqualität</h3>
    <ul>
      <li>GWR-Wohngebäude mit Gebäudegrundriss: ${esc(Math.round((qa.gwr_residential_matched_to_footprint ?? 0) * 1000) / 10)} %</li>
      <li>Gebäudegrundrisse mit Höhe aus swissBUILDINGS3D: ${esc(Math.round((qa.footprints_with_height ?? 0) * 1000) / 10)} %</li>
      <li>Stand der Berechnung: ${esc(territory.built_at)}</li>
    </ul>
    <h3>Quellen</h3>
    <ul>${territory.attribution.map((a) => `<li>${esc(a.text)} <span class="muted">(${esc(a.licence)})</span></li>`).join("")}</ul>
    <p class="disclaimer">${t("footer.disclaimer")}</p>
    </div></form>`;
}
