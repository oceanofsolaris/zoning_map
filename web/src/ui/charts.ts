// Hand-written SVG charts (no chart library): small, themeable via CSS variables.
import { esc, fmt0 } from "./format";

export function histogram(values: number[], opts: { bins: number[]; label: (lo: number, hi: number) => string; colors: (mid: number) => string }): string {
  const { bins } = opts;
  const counts = new Array(bins.length).fill(0);
  for (const v of values) {
    let i = bins.findIndex((b, k) => v >= b && (k === bins.length - 1 || v < bins[k + 1]));
    if (i < 0) i = v < bins[0] ? 0 : bins.length - 1;
    counts[i]++;
  }
  const W = 340, H = 120, pad = 18, bw = (W - 8) / bins.length;
  const max = Math.max(1, ...counts);
  const bars = counts.map((c, i) => {
    const hgt = ((H - pad - 14) * c) / max;
    const x = 4 + i * bw, y = H - pad - hgt;
    const lo = bins[i], hi = bins[i + 1];
    return `<g><title>${esc(opts.label(lo, hi))}: ${fmt0(c)} Parzellen</title>
      <rect x="${x + 1}" y="${y}" width="${bw - 2}" height="${hgt}" fill="${opts.colors(hi === undefined ? lo : (lo + hi) / 2)}" /></g>`;
  }).join("");
  const ticks = [0, 0.5, 1, 1.5].map((v) => {
    const i = bins.findIndex((b) => Math.abs(b - v) < 1e-9);
    return i < 0 ? "" : `<text x="${4 + i * bw}" y="${H - 4}" class="tick">${v.toLocaleString("de-CH")}</text>`;
  }).join("");
  const oneIdx = bins.findIndex((b) => Math.abs(b - 1) < 1e-9);
  const oneLine = oneIdx < 0 ? "" : `<line x1="${4 + oneIdx * bw}" x2="${4 + oneIdx * bw}" y1="6" y2="${H - pad}" class="ref" />`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Histogramm der Ausnützung">${bars}${oneLine}${ticks}</svg>`;
}

export function stackedBar(parts: { label: string; value: number; color: string }[]): string {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  let x = 0;
  const segs = parts.map((p) => {
    const w = (p.value / total) * 100;
    const s = `<rect x="${x}%" y="0" width="${w}%" height="14" fill="${p.color}"><title>${esc(p.label)}: ${fmt0(p.value)} (${Math.round(w)} %)</title></rect>`;
    x += w;
    return s;
  }).join("");
  const legend = parts.map((p) => `<li><i style="background:${p.color}"></i>${esc(p.label)} <span class="num">${Math.round((p.value / total) * 100)} %</span></li>`).join("");
  return `<svg class="chart stacked" viewBox="0 0 100 14" preserveAspectRatio="none" role="img">${segs}</svg><ul class="chart-legend">${legend}</ul>`;
}

export interface BarRow { label: string; value: number; sub?: string; highlight?: boolean }

export function barChart(rows: BarRow[], title: string, unit: string): string {
  const W = 380, rowH = 22, left = 140, right = 118;
  const H = rows.length * rowH + 30;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const body = rows.map((r, i) => {
    const y = 24 + i * rowH;
    const w = ((W - left - right) * Math.max(0, r.value)) / max;
    return `<g>
      <text x="${left - 6}" y="${y + 14}" text-anchor="end" class="bar-label">${esc(r.label)}</text>
      <rect x="${left}" y="${y + 3}" width="${w}" height="${rowH - 8}" class="${r.highlight ? "bar hi" : "bar"}" />
      <text x="${left + w + 4}" y="${y + 14}" class="bar-value">${esc(r.sub ?? fmt0(r.value))}</text></g>`;
  }).join("");
  return `<svg class="chart bars" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
    <style>.bar{fill:#2c7fb8}.bar.hi{fill:#253494}.bar-label,.bar-value,.cap{font:11px 'IBM Plex Sans',system-ui,sans-serif;fill:#1d1f21;font-variant-numeric:tabular-nums}.cap{fill:#6b675f}</style>
    <text x="0" y="12" class="cap">${esc(unit)}</text>${body}</svg>`;
}
