# Spielraum – notes for coding agents

Spielraum (formerly "Parcel Potential"): per-parcel zoning capacity for Swiss municipalities (prototype: Brugg + Windisch AG). Spec: `docs/SPEC.md`.

- **Read first:** `docs/decisions.md` (why things are the way they are, verified data identifiers),
  `docs/playbook-new-municipality.md` (how to add a municipality; data quirks; QA checks),
  `docs/improvements.md` (agreed backlog).
- **Commands:** `make build-all`, `make test`, `make web` (http://localhost:5173; add `?raf=timeout` when the
  browser tab is hidden). ETL CLI: `cd etl && uv run pp --help` (`build`, `zones`, `qa`, `boundaries`, `rules …`).
- **Engine parity:** `etl/src/pp_etl/engine/capacity.py` and `web/src/engine/capacity.ts` must stay in lockstep.
  Every behaviour change needs a hand-computed golden case in `tests/golden/` (expected values in the
  description) and passes in both (`make test` also checks Python↔TS parity on all built territories).
- **Legal values** live in rulebooks (per planning perimeter) or `etl/config/cantons/<XX>.yaml`, always with
  source + quote; never hard-code them in code. Unclear law → config parameter + methodology page, not a guess.
- **UI language** German, code/comments English. Owner-facing wording: "Reserve", "Möglichkeiten", never
  "unternutzt". Never show anything about who lives in a building.
- **Git:** work on a branch; the owner (Stephan) asks for commits/pushes explicitly.
