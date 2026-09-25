"""`pp` command line: fetch, build, rules validation/verification."""

from __future__ import annotations

import json
import logging

import typer

app = typer.Typer(no_args_is_help=True, help="Parcel Potential pipeline")
rules_app = typer.Typer(no_args_is_help=True, help="Rulebooks: validate, verify, extract")
app.add_typer(rules_app, name="rules")


def _logging(verbose: bool) -> None:
    logging.basicConfig(level=logging.DEBUG if verbose else logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    for noisy in ("httpx", "pyogrio", "fiona"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


@app.command()
def build(territory: str = typer.Argument("AG-4095-brugg"), verbose: bool = False) -> None:
    """Run the whole pipeline for a territory (fetches missing raw data first)."""
    _logging(verbose)
    from .build.pipeline import run

    b = run(territory)
    qa = {k: v for k, v in b.qa.items() if k not in ("blocker_ranking",)}
    qa["calibration"] = {k: v for k, v in qa["calibration"].items() if k != "samples"}
    typer.echo(json.dumps(qa, indent=1, ensure_ascii=False, default=str))


@app.command()
def fetch(territory: str = typer.Argument("AG-4095-brugg"), refresh: bool = False, verbose: bool = False) -> None:
    """Download all raw data for a territory into data/raw (idempotent)."""
    _logging(verbose)
    from .fetch import fetch_all

    fetch_all(territory, refresh=refresh)


@app.command()
def boundaries(name: str) -> None:
    """List swissBOUNDARIES3D versions of a municipality (area changes mark mergers)."""
    from .inspect import boundary_versions

    typer.echo(boundary_versions(name).to_string(index=False))


@app.command()
def zones(territory: str) -> None:
    """Zoning codes per planning perimeter and the rulebook zone each maps to (empty = unmapped)."""
    import pandas as pd

    from .inspect import zone_codes

    pd.set_option("display.width", 200)
    df = zone_codes(territory)
    typer.echo(df.to_string(index=False))
    missing = df[df.building_zone & (df.rulebook_zone == "") & df.perimeter.isin(df[df.rulebook_zone != ""].perimeter)]
    if len(missing):
        typer.echo(f"\nUNMAPPED building-zone codes in covered perimeters: {missing[['perimeter', 'code', 'label']].values.tolist()}")


@app.command()
def qa(territory: str) -> None:
    """Plausibility checks on a built territory (rules of thumb; always inspect WARN rows)."""
    from .inspect import qa as run_qa

    for r in run_qa(territory):
        typer.echo(f"{r['status']:4}  {r['check']}: {r['value']}" + (f"\n      → {r['hint']}" if r["status"] != "ok" else ""))


@app.command("oereb-docs")
def oereb_docs(territory: str, perimeter: str = typer.Option(None, help="planning perimeter id"),
               egrid: str = typer.Option(None, help="use this parcel instead of picking one")) -> None:
    """List the legal documents (BNO, plans, laws) linked in a parcel's ÖREB extract."""
    from .inspect import oereb_documents

    for title, url in oereb_documents(territory, perimeter, egrid):
        typer.echo(f"{title} | {url}")


@rules_app.command("validate")
def rules_validate(path: str = typer.Argument(None)) -> None:
    """Validate rulebooks against the JSON schema (all when no path given)."""
    from .paths import RULEBOOK_DIR
    from .rules.models import load_rulebook, validate, verification_status

    paths = [path] if path else [str(p) for p in sorted(RULEBOOK_DIR.glob("*/*.yaml"))]
    for p in paths:
        rb = load_rulebook(p)
        validate(rb)
        s = verification_status(rb)
        typer.echo(f"ok  {rb['rulebook_id']}: {s['verified']}/{s['total']} values verified")


@rules_app.command("verify")
def rules_verify(path: str, reviewer: str = typer.Option(..., "--by", help="Your name, stored as verified_by"),
                 only_unverified: bool = True) -> None:
    """Interactive review: show each value next to its source text; accept, edit or reject."""
    from .rules.verify_cli import verify

    verify(path, reviewer, only_unverified)


@rules_app.command("extract")
def rules_extract(pdf: str, out: str, source_id: str = "bno", model: str = typer.Option(None, envvar="PP_LLM_MODEL")) -> None:
    """LLM-assisted draft extraction of a rulebook from a BNO PDF (needs ANTHROPIC_API_KEY)."""
    from .rules.extract_llm import extract

    extract(pdf, out, source_id, model)


if __name__ == "__main__":
    app()
