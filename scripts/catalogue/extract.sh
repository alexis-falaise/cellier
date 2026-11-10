#!/bin/bash
# Catalogue seed, step 1: download the small Open Products Facts dump, then run extract.sql.
# Uses the DuckDB CLI when installed, otherwise the `duckdb` Python package (pip install duckdb);
# set PYTHON to pick the interpreter.
# Usage (from anywhere): scripts/catalogue/extract.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
OUT="scripts/catalogue/out"
mkdir -p "$OUT/sources"

OPF_URL="https://static.openproductsfacts.org/data/openproductsfacts-products.jsonl.gz"
OPF_FILE="$OUT/sources/openproductsfacts-products.jsonl.gz"
# Re-download only when the remote file is newer (-z), about 41 MB.
if [ -s "$OPF_FILE" ]; then
  curl -fsSL --retry 3 -z "$OPF_FILE" -o "$OPF_FILE" "$OPF_URL"
else
  curl -fsSL --retry 3 -o "$OPF_FILE" "$OPF_URL"
fi

# Resolve each Hugging Face file once to its direct download address (one resolver request per file;
# the address is short-lived and kept in memory only), so the many range requests of the projected
# scan go to the CDN and not to the rate-limited resolver.
HF="https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main"
vars=""
for f in food beauty petfood; do
  loc="$(curl -fsSI "$HF/$f.parquet" | awk 'tolower($1) == "location:" { print $2 }' | tr -d '\r' | tail -n 1)"
  case "$loc" in
    https://*) vars="${vars}SET VARIABLE ${f}_url = '${loc//\'/}';"$'\n' ;;
    *) echo "could not resolve $f.parquet (Hugging Face rate limit?); retry in 5 minutes" >&2; exit 1 ;;
  esac
done

start=$(date +%s)
if command -v duckdb >/dev/null 2>&1; then
  { printf '%s' "$vars"; cat scripts/catalogue/extract.sql; } | duckdb -bail
else
  { printf '%s' "$vars"; cat scripts/catalogue/extract.sql; } |
    "${PYTHON:-python3}" -c 'import sys, duckdb; duckdb.connect().execute(sys.stdin.read())'
fi
echo "extract: $(( $(date +%s) - start )) s, $(wc -l < "$OUT/candidates.jsonl" | tr -d ' ') candidate rows"
cat "$OUT/extract-report.json"
