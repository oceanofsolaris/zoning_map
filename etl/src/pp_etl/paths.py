"""Repository-relative paths. Everything else derives from these."""

from pathlib import Path

ETL_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = ETL_DIR.parent
DATA_DIR = REPO_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
MANIFEST_PATH = DATA_DIR / "manifest.json"
CONFIG_DIR = ETL_DIR / "config"
RULEBOOK_DIR = ETL_DIR / "rulebooks"
TERRITORY_DIR = ETL_DIR / "territories"
GOLDEN_DIR = REPO_DIR / "tests" / "golden"
WEB_DATA_DIR = REPO_DIR / "web" / "public" / "data"
