"""Interactive verification of rulebook values (spec §9).

For each value: show it with its provenance and the text of the cited PDF page
around the quote. The reviewer accepts (a), edits (e), rejects (r = set value to
null, keep a note), skips (s) or quits (q). Accepted values get `verified: true`,
`verified_by` and `verified_at`. Progress is saved after every decision.
"""

from __future__ import annotations

import datetime as dt
import difflib
from pathlib import Path

import typer
import yaml

from ..paths import REPO_DIR
from .extract_llm import pdf_text
from .models import iter_values, load_rulebook


def _page_texts(rb: dict) -> dict[str, list[str]]:
    out = {}
    for s in rb.get("sources", []):
        lp = s.get("local_path")
        if lp and (REPO_DIR / lp).exists():
            txt = pdf_text(REPO_DIR / lp)
            out[s["id"]] = txt.split("<<<PAGE ")[1:]
    return out


def _context(pages: list[str], page: int | None, quote: str | None, width: int = 500) -> str:
    if not page or page > len(pages):
        return "(no page text available)"
    text = pages[page - 1].split(">>>", 1)[-1]
    if not quote:
        return text[:width]
    probe = quote.split("[")[0].strip()[:40]
    i = text.find(probe)
    if i < 0:
        m = difflib.SequenceMatcher(None, text, probe).find_longest_match(0, len(text), 0, len(probe))
        i = m.a
    lo = max(0, i - width // 2)
    snippet = text[lo:lo + width]
    return snippet.replace(probe, typer.style(probe, fg="yellow", bold=True))


def _save(path: Path, rb: dict) -> None:
    header = "".join(line + "\n" for line in path.read_text().splitlines() if line.startswith("#"))
    body = {k: v for k, v in rb.items() if not k.startswith("_")}
    path.write_text(header + yaml.safe_dump(body, allow_unicode=True, sort_keys=False, width=140))


def verify(path: str, reviewer: str, only_unverified: bool = True) -> None:
    rb = load_rulebook(path)
    p = Path(rb["_path"])
    pages = _page_texts(rb)
    items = [(k, v) for k, v in iter_values(rb) if not (only_unverified and v.get("verified"))]
    typer.echo(f"{len(items)} values to review in {p.name}")
    for n, (key, v) in enumerate(items, 1):
        typer.echo("\n" + "─" * 72)
        typer.echo(typer.style(f"[{n}/{len(items)}] {key}", bold=True))
        typer.echo(f"  value:   {v.get('value')!r}")
        typer.echo(f"  source:  {v.get('source')}  page {v.get('page')}  {v.get('section') or ''}")
        typer.echo(f"  quote:   {v.get('quote')}")
        if v.get("note"):
            typer.echo(f"  note:    {v['note']}")
        typer.echo("  context: " + _context(pages.get(v.get("source"), []), v.get("page"), v.get("quote")).replace("\n", "\n           "))
        choice = typer.prompt("  [a]ccept / [e]dit / [r]eject / [s]kip / [q]uit", default="s").strip().lower()
        if choice == "q":
            break
        if choice == "s":
            continue
        if choice == "e":
            raw = typer.prompt("  new value (YAML)", default=yaml.safe_dump(v.get("value")).strip())
            v["value"] = yaml.safe_load(raw)
            v["note"] = (v.get("note", "") + f" Edited by {reviewer}.").strip()
        if choice == "r":
            v["note"] = (v.get("note", "") + f" Rejected by {reviewer}: was {v.get('value')!r}.").strip()
            v["value"] = None
        v["verified"] = choice in ("a", "e")
        v["verified_by"] = reviewer
        v["verified_at"] = dt.date.today().isoformat()
        _save(p, rb)
    typer.echo("saved.")
