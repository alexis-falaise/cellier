#!/usr/bin/env bash
# Loads scripts/catalogue/out/prices.csv into the price columns of public.catalog_products (one transaction, idempotent).
#
# The connection string is read ONLY from the SUPABASE_DB_URL environment variable: the session pooler
# string of the postgres role (port 5432, not the transaction pooler on 6543). It is never printed.
#
# Usage, from anywhere:
#   scripts/catalogue/load-prices.sh             # load and commit, then post-checks
#   scripts/catalogue/load-prices.sh --dry-run   # same work, rolled back at the end
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


PRICES="scripts/catalogue/out/prices.csv"
[ -s "$PRICES" ] || { echo "$PRICES is missing: run refresh-prices.ts first." >&2; exit 2; }
[ "$(head -n 1 "$PRICES")" = "gtin,price_cents,price_observed_on,price_chain,sample_size" ] || { echo "$PRICES header does not match the expected columns." >&2; exit 2; }

# Passed as the dbname argument (libpq expands it); psql never prints it.
PGAPPNAME=cellier-catalogue-prices psql --no-psqlrc --quiet -X \
  -v ON_ERROR_STOP=1 -v dry_run="$dry_run" \
  -d "$SUPABASE_DB_URL" -f scripts/catalogue/load-prices.sql
