#!/usr/bin/env bash
# Loads scripts/catalogue/out/seed.csv into public.catalog_products (one transaction, idempotent).
#
# The connection string is read ONLY from the SUPABASE_DB_URL environment variable: the session pooler
# string of the postgres role (port 5432, not the transaction pooler on 6543). It is never printed.
#
# Usage, from anywhere:
#   scripts/catalogue/load.sh             # load and commit, then post-checks
#   scripts/catalogue/load.sh --dry-run   # same work, rolled back at the end
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

dry_run=false
case "${1:-}" in
  "") ;;
  --dry-run) dry_run=true ;;
  *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;;
esac

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "SUPABASE_DB_URL is not set (session pooler connection string, port 5432)." >&2
  exit 2
fi
case "$SUPABASE_DB_URL" in
  *:6543/*|*:6543) echo "SUPABASE_DB_URL points at the transaction pooler (6543); use the session pooler (5432)." >&2; exit 2 ;;
esac
command -v psql >/dev/null 2>&1 || { echo "psql not found (PostgreSQL client 16 or later)." >&2; exit 2; }

SEED="scripts/catalogue/out/seed.csv"
[ -s "$SEED" ] || { echo "$SEED is missing: run extract.sh and build-seed.ts first." >&2; exit 2; }
expected_header="gtin,name,brand,quantity_label,net_quantity,net_unit,pack_count,category_key,category_rule,category_tags,image_url,source,store_tags,popularity,price_cents,price_observed_on,price_chain,source_modified_at"
[ "$(head -n 1 "$SEED")" = "$expected_header" ] || { echo "$SEED header does not match the expected columns." >&2; exit 2; }
# Row count from the build report (wc -l would also count line breaks inside quoted fields).
grep -m1 '"rows"' scripts/catalogue/out/seed-report.json 2>/dev/null | tr -d ' ,' || true

# Passed as the dbname argument (libpq expands it); psql never prints it.
PGAPPNAME=cellier-catalogue-seed psql --no-psqlrc --quiet -X \
  -v ON_ERROR_STOP=1 -v dry_run="$dry_run" \
  -d "$SUPABASE_DB_URL" -f scripts/catalogue/load.sql
