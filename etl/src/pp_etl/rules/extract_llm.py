"""LLM-assisted rulebook extraction (spec §9).

Input: a BNO PDF (text layer; scanned PDFs need OCR first, e.g. `ocrmypdf -l deu`).
Output: a rulebook YAML *draft*: every value carries page, section and a verbatim
quote, and `verified: false`. A human must review it with `pp rules verify`.

The model comes from PP_LLM_MODEL (default claude-sonnet-5); credentials are
resolved by the Anthropic SDK (ANTHROPIC_API_KEY or an `ant auth login` profile).
Never hard-code keys. For v1 this runs once per municipality (~200 in Aargau).
"""

from __future__ import annotations

import datetime as dt
import os
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field
from pypdf import PdfReader

DEFAULT_MODEL = "claude-sonnet-5"

PARAMS = ["vollgeschosse_max", "az_max", "ueberbauungsziffer_max", "gruenflaechenziffer_min", "gesamthoehe_max_m",
          "fassadenhoehe_max_m", "grenzabstand_klein_m", "grenzabstand_gross_m", "gebaeudelaenge_max_m", "empfindlichkeitsstufe"]


class Value(BaseModel):
    value: float | str | None = Field(description="Number (metres, ratio or count), roman ES level as string, or null if the BNO sets no value")
    page: int | None = Field(description="1-based PDF page of the quote")
    section: str | None = Field(description='Paragraph reference, e.g. "§ 13 Abs. 1"')
    quote: str | None = Field(description="Verbatim text (e.g. the table row) that states the value")
    note: str | None = Field(default=None, description='Remarks, e.g. "* = Stadtrat entscheidet im Einzelfall"')


class Zone(BaseModel):
    code: str = Field(description="Zone abbreviation used in the BNO, e.g. W2, WA3, K")
    label_de: str
    category: Literal["residential", "mixed", "centre", "core", "oldtown", "renewal", "special", "work", "public"]
    residential: bool = Field(description="Housing is a permitted main use")
    discretionary: bool = Field(description="Density measures are set case by case or by a separate regulation")
    params: dict[str, Value] = Field(description=f"Keys from: {', '.join(PARAMS)}")
    notes: list[str] = []


class Bonus(BaseModel):
    id: str
    label_de: str
    zones: list[str]
    az_delta: float | None = None
    vg_delta: int | None = None
    page: int | None = None
    section: str | None = None
    quote: str | None = None


class Extraction(BaseModel):
    zones: list[Zone]
    bonuses: list[Bonus] = []
    az_counts_attika_dg: Value | None = Field(default=None, description="Do attic/Attika storeys count towards the AZ? value true/false")
    geschlossene_bauweise_zulaessig: Value | None = None


SYSTEM = """You extract building-zone parameters from a Swiss municipal building and zoning ordinance
(Bau- und Nutzungsordnung, BNO). Accuracy and traceability matter more than completeness:
- Only report values that the text states. Use null when a value is absent, "*" (set case by case) or "-".
- Every non-null value needs the 1-based page number (from the <<<PAGE n>>> markers), the paragraph, and a verbatim quote.
- Keep German terms. Do not convert units; heights and distances are in metres."""


def pdf_text(path: str | Path) -> str:
    reader = PdfReader(str(path))
    return "\n".join(f"<<<PAGE {i + 1}>>>\n{p.extract_text() or ''}" for i, p in enumerate(reader.pages))


def extract(pdf: str, out: str, source_id: str = "bno", model: str | None = None) -> Path:
    import anthropic

    model = model or os.environ.get("PP_LLM_MODEL", DEFAULT_MODEL)
    text = pdf_text(pdf)
    client = anthropic.Anthropic()
    resp = client.messages.parse(
        model=model,
        max_tokens=16000,
        system=SYSTEM,
        messages=[{"role": "user", "content": f"<bno>\n{text}\n</bno>\n\nExtract all building zones (Bauzonen) with their parameters."}],
        output_format=Extraction,
    )
    ex: Extraction = resp.parsed_output

    def val(v: Value) -> dict:
        d = {"value": v.value, "source": source_id, "page": v.page, "section": v.section, "quote": v.quote, "verified": False}
        if v.note:
            d["note"] = v.note
        return d

    rb = {
        "rulebook_id": "TODO", "territory": "TODO", "perimeter": "TODO",
        "municipality": {"bfs": 0, "name": "TODO", "canton": "AG"},
        "version": "0.0.1", "compiled_at": dt.date.today().isoformat(),
        "compiled_by": f"LLM draft ({model}); requires human verification",
        "zone_match_field": "typ_kommunal_code",
        "sources": [{"id": source_id, "title": Path(pdf).name, "local_path": str(pdf)}],
        "definitions": {k: val(v) for k, v in (("az_counts_attika_dg", ex.az_counts_attika_dg),
                                                ("geschlossene_bauweise_zulaessig", ex.geschlossene_bauweise_zulaessig)) if v},
        "zones": [{
            "code": z.code, "label_de": z.label_de, "match": {"typ_kommunal_code": ["TODO"]}, "category": z.category,
            "residential": z.residential, "discretionary": z.discretionary,
            "params": {k: val(v) for k, v in z.params.items() if k in PARAMS},
            "bonuses": [{"id": b.id, "label_de": b.label_de, "az_delta": b.az_delta or 0.0, "vg_delta": b.vg_delta or 0,
                         "discretionary": True, "default_on": False, "source": source_id, "page": b.page,
                         "section": b.section, "quote": b.quote, "verified": False}
                        for b in ex.bonuses if z.code in b.zones],
            "notes": z.notes,
        } for z in ex.zones],
    }
    p = Path(out)
    p.write_text("# LLM draft – fill `match` codes from the zoning dataset, then run `pp rules verify`.\n"
                 + yaml.safe_dump(rb, allow_unicode=True, sort_keys=False, width=140))
    return p
