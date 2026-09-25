// Address search via geo.admin.ch SearchServer (CORS-enabled), restricted to the territory bbox.
import { esc } from "./format";

interface Hit { label: string; lat: number; lon: number }

export function mountSearch(form: HTMLFormElement, input: HTMLInputElement, list: HTMLUListElement, bbox: number[],
                            onPick: (lon: number, lat: number) => void): void {
  let timer = 0, hits: Hit[] = [], active = -1;
  const render = () => {
    list.hidden = !hits.length;
    list.innerHTML = hits.map((h, i) => `<li role="option" aria-selected="${i === active}" data-i="${i}">${h.label}</li>`).join("");
  };
  const pick = (i: number) => {
    const h = hits[i];
    if (!h) return;
    input.value = h.label.replace(/<[^>]+>/g, "");
    hits = []; render();
    onPick(h.lon, h.lat);
  };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) { hits = []; render(); return; }
    timer = window.setTimeout(async () => {
      const url = `https://api3.geo.admin.ch/rest/services/api/SearchServer?type=locations&origins=address,parcel&sr=2056&limit=8`
        + `&bbox=${bbox.join(",")}&searchText=${encodeURIComponent(q)}`;
      try {
        const r = await fetch(url);
        const d = await r.json();
        hits = (d.results ?? []).map((x: { attrs: { label: string; lat: number; lon: number } }) => ({
          label: esc(x.attrs.label.replace(/<\/?b>/g, "")).replace(/(\d{4} [^<]+)$/, "<b>$1</b>"), lat: x.attrs.lat, lon: x.attrs.lon,
        }));
        active = hits.length ? 0 : -1;
      } catch { hits = []; }
      render();
    }, 220);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { active = Math.min(hits.length - 1, active + 1); render(); e.preventDefault(); }
    if (e.key === "ArrowUp") { active = Math.max(0, active - 1); render(); e.preventDefault(); }
    if (e.key === "Escape") { hits = []; render(); }
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); pick(active); });
  list.addEventListener("mousedown", (e) => {
    const li = (e.target as HTMLElement).closest("li");
    if (li) { e.preventDefault(); pick(Number(li.dataset.i)); }
  });
  input.addEventListener("blur", () => setTimeout(() => { hits = []; render(); }, 150));
}
