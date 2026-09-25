# Parcel Potential – top-level commands (spec §9). TERRITORY defaults to Brugg.
TERRITORY ?= AG-4095-brugg
UV := cd etl && uv run

.PHONY: data build build-all rules-validate rules-verify rules-extract test test-py test-web web web-build clean-web

data:            ## download all raw data for the territory (idempotent, cached in data/raw)
	$(UV) pp fetch $(TERRITORY)

build:           ## fetch (if needed) → join → geometry facts → metrics → export (GeoParquet + web data)
	$(UV) pp build $(TERRITORY)

build-all:       ## build every territory in etl/territories
	@for f in etl/territories/*/*.yaml; do id=$$(grep '^territory_id:' $$f | awk '{print $$2}'); echo "== $$id"; (cd etl && uv run pp build $$id > /dev/null) || exit 1; done

rules-validate:  ## validate all rulebooks against the JSON schema
	$(UV) pp rules validate

rules-verify:    ## interactive human verification, e.g. make rules-verify RULEBOOK=AG/4095-brugg.yaml BY=Stephan
	$(UV) pp rules verify $(RULEBOOK) --by "$(BY)"

rules-extract:   ## LLM draft from a BNO PDF: make rules-extract PDF=... OUT=...
	$(UV) --extra llm pp rules extract $(PDF) $(OUT)

test: test-py test-web

test-py:
	$(UV) --group dev pytest -q

test-web:
	cd web && npx vitest run

web:             ## dev server on http://localhost:5173
	cd web && npx vite

web-build:       ## static build into web/dist (copies public/data)
	cd web && npx tsc --noEmit && npx vite build
