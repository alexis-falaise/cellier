# 07 — Backend runbook

Supabase project `cellier` (ref `oiorgvhxqgsmheucmtim`, West EU, free plan). API URL
`https://oiorgvhxqgsmheucmtim.supabase.co`. Front end on Vercel: `https://cellier-one.vercel.app`.

This page says what is deployed, how to redeploy it, which secrets exist (names only), and how to check health.
Secret values are never written in this repository.

## 1. What is applied

### 1.1 Migrations

`supabase/migrations/` is the source of truth. Remote state (`list_migrations`, or
`select version, name from supabase_migrations.schema_migrations order by version`):

| Remote name | Repository file(s) |
|---|---|
| `extensions_and_helpers` | `20261110120000_extensions_and_helpers.sql` |
| `tenancy_and_sync_tables` | `…120100_tenancy_and_sync_tables.sql` |
| `reference_data` | `…120200_reference_data.sql` |
| `inventory_tables` | `…120300_inventory_tables.sql` |
| `notification_tables` | `…120400_notification_tables.sql` |
| `sync_triggers` | `…120500_sync_triggers.sql` |
| `rls_and_grants` | `…120600_rls_and_grants.sql` |
| `apply_mutations` | `…120700_apply_mutations.sql` |
| `pull_changes` | `…120800_pull_changes.sql` |
| (not recorded) | `…120900_household_rpcs.sql`, `…121000_notifications_and_cron.sql`, `…121100_catalogue_service.sql`, `…121200_internal_secret_check.sql`: run by hand in the SQL Editor on 2026-11-10, so they are in the database but absent from `supabase_migrations.schema_migrations` |

Remote version numbers are the apply timestamps, not the file prefixes; the content is identical to the files.
Verified 2026-11-10: all public RPCs of 01 §4 plus `verify_internal_secret` exist, the three running-low triggers
exist, the four cron jobs are scheduled, `private.catalog_lookup_log` and `private.catalog_misses` exist.
A new change is always a new file with a later prefix, applied once; never edit an applied file.

### 1.2 Vault secrets (database)

| Name | Content | Created by |
|---|---|---|
| `cellier_functions_url` | `https://oiorgvhxqgsmheucmtim.supabase.co/functions/v1` | SQL, once |
| `cellier_internal_secret` | 32 random bytes in hex, generated inside the database | SQL, once |

Creation (SQL Editor, once; returns only ids, the value is generated in the database and never shown):

```sql
select vault.create_secret('https://oiorgvhxqgsmheucmtim.supabase.co/functions/v1', 'cellier_functions_url');
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cellier_internal_secret');
```

Until both exist, `cellier-notify` logs a warning every minute and sends nothing.

The internal secret never leaves the database except in the `x-cellier-secret` header that `pg_net` sends to
`send-push`, which checks it with `public.verify_internal_secret` (service role only). No copy is stored as an Edge
Function secret. To rotate it:

```sql
select vault.update_secret(id, encode(extensions.gen_random_bytes(32), 'hex'))
from vault.secrets where name = 'cellier_internal_secret';
```

Never `select` `decrypted_secret` in a shared console or paste it anywhere.

### 1.3 Edge Functions

| Function | `verify_jwt` | Caller | Source |
|---|---|---|---|
| `send-push` | false | `pg_net` from cron `cellier-notify`, header `x-cellier-secret` | `supabase/functions/send-push/` |
| `catalog-lookup` | true | signed-in clients (`supabase.functions.invoke`) | `supabase/functions/catalog-lookup/` |

`supabase/config.toml` carries the same `verify_jwt` values.

Edge Function secrets (Dashboard → Edge Functions → Secrets), names only:

| Name | Used by | Value |
|---|---|---|
| `VAPID_PRIVATE_JWK` | send-push | P-256 private key as a JWK JSON string (`kty`, `crv`, `x`, `y`, `d`) |
| `VAPID_SUBJECT` | send-push | `mailto:` address of the operator |
| `CELLIER_APP_URL` | both | `https://cellier-one.vercel.app` |
| `CATALOGUE_CONTACT` | catalog-lookup | contact e-mail placed in the Open Food Facts User-Agent |
| `CELLIER_ALLOWED_ORIGINS` (optional) | catalog-lookup | comma-separated extra CORS origins (Vercel previews) |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform.

The VAPID public key (base64url, uncompressed point) goes to Vercel as `VITE_VAPID_PUBLIC_KEY`. It must match the
private JWK; changing the pair invalidates every existing push subscription (04 §1.6).

Generating the pair locally (Node 20+, nothing installed, nothing written to disk; the private JWK is printed
once to the terminal — paste it straight into the dashboard secret and clear the terminal):

```sh
node -e 'const {generateKeyPairSync}=require("crypto");const {privateKey,publicKey}=generateKeyPairSync("ec",{namedCurve:"P-256"});const j=privateKey.export({format:"jwk"});const pub=Buffer.concat([Buffer.from([4]),Buffer.from(j.x,"base64url"),Buffer.from(j.y,"base64url")]).toString("base64url");console.log("VAPID_PRIVATE_JWK="+JSON.stringify({kty:j.kty,crv:j.crv,x:j.x,y:j.y,d:j.d}));console.log("VITE_VAPID_PUBLIC_KEY="+pub)'
```

The deployed `send-push` copy was uploaded through the Supabase connector with shortened comments; the code is the
same as the repository. Redeploying from the repository with the CLI (§2) is always safe.

### 1.4 Cron jobs (pg_cron, UTC)

| Job | Schedule | Command |
|---|---|---|
| `cellier-notify` | `* * * * *` | `select private.kick_notification_sender();` |
| `cellier-digest` | `0 * * * *` | `select private.enqueue_daily_digests();` (acts at 18:xx Paris) |
| `cellier-prune` | `17 3 * * *` | `select private.prune();` |
| `cellier-catalog-prune` | `41 3 * * *` | `select private.catalog_prune();` |

## 2. Redeploy

Tools: the Supabase CLI logged in to the owner's account, linked once with `supabase link --project-ref
oiorgvhxqgsmheucmtim`.

- Edge Functions: `supabase functions deploy send-push --no-verify-jwt` and
  `supabase functions deploy catalog-lookup` (or `supabase functions deploy` for both; `config.toml` sets
  `verify_jwt`). Deploying replaces the live version at once.
- Migrations: `supabase db push` applies the files not yet recorded remotely. Because the remote history uses
  apply timestamps as versions (§1.1), first run `supabase migration list`; if the CLI shows the repository files as
  not applied, mark them with `supabase migration repair --status applied <prefix>` for each file already in §1.1
  before pushing a new one. Never re-run an applied file.
- Types for the front end: `supabase gen types typescript --project-id oiorgvhxqgsmheucmtim >
  src/shared/api/database.types.ts` after every schema change.

## 3. Health checks

Run in the SQL editor (read-only):

```sql
-- Cron runs in the last hour, failures first.
select j.jobname, d.status, count(*), max(d.start_time) as last_run
from cron.job_run_details d join cron.job j on j.jobid = d.jobid
where d.start_time > now() - interval '1 hour'
group by 1, 2 order by d.status desc, 1;

-- Notification outbox by status (last 24 h) and anything stuck.
select status, count(*), max(last_error) from private.notification_outbox
where created_at > now() - interval '1 day' group by status;

-- Last pg_net answers from send-push (status_code 200 expected; 401 = secret mismatch).
select id, status_code, left(content::text, 200), created from net._http_response order by id desc limit 10;

-- Catalogue lookups by outcome (last 24 h).
select outcome, count(*) from private.catalog_lookup_log where created_at > now() - interval '1 day' group by 1;

-- Database size against the 500 MB free-plan limit.
select pg_size_pretty(pg_database_size(current_database())),
       pg_size_pretty(pg_total_relation_size('public.catalog_products'));
```

Also: Dashboard → Advisors (security and performance) after every migration; expected findings are "RLS enabled,
no policy" on `private.*` tables and "unused index" while the database is young. Edge Function logs: Dashboard →
Edge Functions → <function> → Logs (one JSON line per run or lookup).

Symptoms:

- No pushes, outbox rows stay `pending`: check `cellier-notify` runs, then `net._http_response`. 401 means the
  function could not verify the secret (Vault row missing or renamed); 5xx means the function failed (logs).
- Rows go `failed` with VAPID errors: the JWK secret is missing or malformed, or `VAPID_SUBJECT` is not `mailto:`.
- `catalog-lookup` answers 503 often: Open Food Facts is slow or the global budget (10 upstream calls per minute)
  is used; nothing to fix unless it persists.

## 4. Catalogue seed (plan, not run)

Source: Open Food Facts Parquet on Hugging Face (`openfoodfacts/product-database`, `food.parquet` about 8 GB read
remotely by DuckDB with column projection, `beauty.parquet` 68 MB), Open Products Facts JSONL (41 MB) and Open Pet
Food Facts JSONL (19 MB). Licence ODbL; attribution per 05 §12.

Filter (05 §10.2 step 3–4): `countries_tags` contains `en:france`, not obsolete, valid 8–14 digit code, a name in
some language; then score (scans, Leclerc/Carrefour signals, category weight) and keep the best 130,000 (hard cap
150,000), non-food at most 30,000.

Expected result: about 130,000 rows, about 82–95 MB with indexes (estimate 630–730 bytes per row; hard cap 150 MB
for the table, database kept under about 300 MB).

Steps:

1. Write the pipeline scripts of 05 §10 (`scripts/catalogue/…`): fetch, category rules, DuckDB extract, build seed,
   size report, load, post-checks. Not written yet.
2. Run steps 1–6 on the owner's machine (not in a cloud session: the remote Parquet read and the downloads exceed
   200 MB) with `SUPABASE_DB_URL` = session pooler string, kept in the local shell only.
3. Check the dry-run reports (row count, `autre` share, projected size).
4. Only with the orchestrator's go-ahead: run `load-first.sql` (drops and recreates the trigram index around the
   first load), then post-checks, then record the measured bytes per row here.
5. Later: monthly GitHub Actions workflow (05 §10.4) with the `SUPABASE_DB_URL` repository secret.
