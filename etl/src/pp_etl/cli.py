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
