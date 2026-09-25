const nf0 = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export const fmt0 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : nf0.format(v));
export const fmt1 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : nf1.format(v));
export const fmt2 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : nf2.format(v));
export const m2 = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${fmt0(v)} m²`);
export const pct = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : `${nf0.format(v * 100)} %`);
export const signed0 = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "±") + nf0.format(Math.abs(v));

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function h(html: string): DocumentFragment {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content;
}

export function download(name: string, content: string, type: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
