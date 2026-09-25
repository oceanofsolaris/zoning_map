// Catalog of parcel-specific constraints shown under "Regeln" in the inspector.
// Add a constraint type here (and have the pipeline emit {id, share?, labels?, length_m?}) to show it.
import type { Rulebook, Territory } from "../data/source";
import { esc, fmt0, fmt1, pct } from "./format";

export interface ConstraintDetail {
  id: string; share?: number; labels?: string[]; length_m?: number;
  slope_pct?: number; slope_build_pct?: number; drop_build_m?: number; steep_share?: number | null;
}
/** modelled: shapes the envelope/capacity; flag: shown but not calculated; info: context only */
export type Effect = "modelled" | "flag" | "info";
interface Ctx { member: Territory; rulebook: Rulebook | null }
interface Entry {
  title: string;
  effect: Effect;
  text: (c: ConstraintDetail, ctx: Ctx) => string;
  basis?: (ctx: Ctx) => { label: string; url?: string; quote?: string } | null;
}

const BAUG_AG = "https://gesetzessammlungen.ag.ch/data/713.100/de";
const share = (c: ConstraintDetail) => (c.share !== undefined ? `${pct(c.share)} der Parzelle` : "Ein Teil der Parzelle");
const named = (c: ConstraintDetail) => (c.labels?.length ? ` «${c.labels.map(esc).join("», «")}»` : "");
const fromRulebookText = (id: string) => (ctx: Ctx) => {
  const f = (ctx.rulebook as unknown as { flags_from_text?: { id: string; section: string; quote: string }[] })?.flags_from_text?.find((x) => x.id === id);
  return f ? { label: `${f.section} BNO`, quote: f.quote } : null;
};

export const CONSTRAINTS: Record<string, Entry> = {
  waldabstand: {
    title: "Waldabstand", effect: "modelled",
    text: (c, { member }) => `${share(c)} liegen näher als ${fmt0(member.qa.forest_distance_m ?? 18)} m am Wald. Dort sind keine Gebäude zulässig; die Fläche fehlt in der Hülle.`,
    basis: () => ({ label: "§ 48 Abs. 1 lit. c BauG AG", url: BAUG_AG }),
  },
  bestand_im_waldabstand: {
    title: "Bestehendes Gebäude im Waldabstand", effect: "flag",
    text: () => "Das Gebäude geniesst Besitzstand. Ein Ersatzneubau an gleicher Stelle braucht eine Ausnahmebewilligung (oder eine Anpassung der Waldgrenze mit Rodung und Ersatzaufforstung).",
    basis: () => ({ label: "§ 48 BauG AG; Besitzstand nach BauG AG", url: BAUG_AG }),
  },
  gewaesserraum: {
    title: "Gewässerraum", effect: "modelled",
    text: (c) => `${share(c)} liegen im Gewässerraum. Neue Gebäude sind dort nicht zulässig; die Fläche fehlt in der Hülle.`,
    basis: () => ({ label: "Art. 41c GSchV", url: "https://www.fedlex.admin.ch/eli/cc/1998/2863_2863_2863/de#art_41_c" }),
  },
  brandmauer: {
    title: "Anbau an Nachbargebäude", effect: "modelled",
    text: (c) => `Auf ${fmt0(c.length_m)} m Grenze stehen beidseitig Gebäude (Brandmauer). Dort rechnet die Hülle ohne Grenzabstand.`,
    basis: ({ rulebook }) => {
      const d = rulebook?.definitions?.geschlossene_bauweise_zulaessig;
      return d ? { label: `${d.section} BNO`, quote: d.quote ?? undefined } : null;
    },
  },
  hanglage: {
    title: "Hanglage", effect: "flag",
    text: (c) => {
      const s = c.slope_build_pct ?? c.slope_pct ?? 0;
      const cls = s < 15 ? "leicht geneigt" : s < 25 ? "mässig steil" : s < 35 ? "steil" : "sehr steil";
      const parts = [`Mittlere Neigung ${fmt0(c.slope_pct)} %`];
      if (c.slope_build_pct !== undefined) parts.push(`im bebaubaren Bereich ${fmt0(c.slope_build_pct)} % (${cls}), dort ${fmt1(c.drop_build_m)} m Höhenunterschied`);
      if (c.steep_share) parts.push(`${pct(c.steep_share)} der Parzelle steiler als 30 %`);
      return `${parts.join("; ")}. Höhen werden hier nicht ab massgebendem Terrain gemessen; am Hang sind Stützmauern, Terrassierung oder Untergeschosse wahrscheinlich – die Hülle ist entsprechend ungenau.`;
    },
    basis: () => ({ label: "swissALTI3D (2 m)", url: "https://www.swisstopo.admin.ch/de/hoehenmodell-swissalti3d" }),
  },
  infrastructure: {
    title: "Verkehrs- oder Gewässerfläche", effect: "modelled",
    text: (c) => `${share(c)} sind Strasse, Bahn oder Gewässer (amtliche Vermessung). Die Parzelle wird nicht als Bauland gerechnet.`,
  },
  gestaltungsplan: {
    title: "Gestaltungsplan", effect: "flag",
    text: (c) => `Die Parzelle liegt im Gestaltungsplan${named(c)}. Seine Bestimmungen gehen den Zonenregeln vor; das Werkzeug rechnet nur mit den Zonenregeln.`,
  },
  gestaltungsplan_pflicht: {
    title: "Gestaltungsplanpflicht", effect: "flag",
    text: () => "Grössere Neubauten brauchen hier zuerst einen Gestaltungsplan. Die Masse können davon abweichen.",
  },
  hochhausstandort: {
    title: "Hochhausstandort", effect: "flag",
    text: (c) => `Bezeichneter Standort für höhere Bauten${named(c)}. Nicht gerechnet.`,
    basis: fromRulebookText("hochhausstandort"),
  },
  nachverdichtung: {
    title: "Nachverdichtungsgebiet", effect: "flag",
    text: () => "Die Behörde kann hier mehr Dichte bewilligen, wenn Qualitätsanforderungen erfüllt sind. Nicht gerechnet.",
    basis: fromRulebookText("nachverdichtung"),
  },
  keine_arealueberbauung: {
    title: "Arealüberbauung ausgeschlossen", effect: "flag",
    text: () => "Der Arealüberbauungs-Bonus (zusätzliches Geschoss) ist hier nicht möglich.",
  },
  heritage: {
    title: "Geschützte Bausubstanz", effect: "flag",
    text: (c) => `Auf der Parzelle stehen kommunal geschützte Bauten${named(c)}. Abbruch und Ersatz sind stark eingeschränkt.`,
  },
  ortsbildschutz: {
    title: "Ortsbild- oder Quartiererhaltung", effect: "flag",
    text: (c) => `Überlagernde Schutzzone${named(c)}. Die Behörde kann von den Zonenmassen abweichen, um das Ortsbild zu erhalten.`,
  },
  hazard: {
    title: "Hochwassergefahr", effect: "flag",
    text: (c) => `${share(c)} liegen in einer Hochwassergefahrenzone${named(c)}. Bauen ist mit Auflagen möglich.`,
  },
  aufwertung_strassenraum: {
    title: "Aufwertung Siedlungs- und Strassenraum", effect: "info",
    text: () => "Stark belasteter Strassenabschnitt: Ziel sind städtebaulich integrierter Lärmschutz und Konzepte/Gestaltungspläne. Kein Dichtebonus.",
  },
  sdr_overlap: {
    title: "Baurecht (SDR)", effect: "flag",
    text: (c) => `${share(c)} sind mit einem Baurecht belastet. Die Fläche gehört der Parzelle, genutzt wird sie über das Baurecht.`,
  },
};

const EFFECT_LABEL: Record<Effect, string> = {
  modelled: "in der Hülle berücksichtigt",
  flag: "nur markiert, nicht gerechnet",
  info: "Hinweis",
};

export function renderConstraints(details: ConstraintDetail[] | undefined, ctx: Ctx): string {
  const items = (details ?? []).filter((c) => CONSTRAINTS[c.id]);
  if (!items.length) return "";
  const order: Effect[] = ["modelled", "flag", "info"];
  items.sort((a, b) => order.indexOf(CONSTRAINTS[a.id].effect) - order.indexOf(CONSTRAINTS[b.id].effect));
  return `<section class="constraints"><h3>Weitere Einschränkungen auf dieser Parzelle</h3><ul>${items.map((c) => {
    const e = CONSTRAINTS[c.id];
    const b = e.basis?.(ctx);
    const basis = b ? `<span class="basis">${b.url ? `<a href="${esc(b.url)}" target="_blank" rel="noopener"${b.quote ? ` title="${esc(b.quote)}"` : ""}>${esc(b.label)}</a>` : `<span${b.quote ? ` title="${esc(b.quote)}"` : ""}>${esc(b.label)}</span>`}</span>` : "";
    return `<li class="effect-${e.effect}"><div class="c-head"><strong>${esc(e.title)}</strong><span class="tag">${EFFECT_LABEL[e.effect]}</span></div>
      <p>${e.text(c, ctx)} ${basis}</p></li>`;
  }).join("")}</ul></section>`;
}

/** Flags already explained as constraints (or in the project section); the "Hinweise" list skips them. */
export const FLAGS_SHOWN_ELSEWHERE = new Set([...Object.keys(CONSTRAINTS), "slope", "im_bau", "bewilligt", "projektiert"]);
