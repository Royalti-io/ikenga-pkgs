# local-store-etl

Fixture-only ETL sidecar for the Ikenga local store migration (Wave 2 / WP-03).

## What it does

Loads synthetic test data into `pa.db` (the local SQLite store) to exercise
and verify the full insert → idempotent-re-run → NDJSON round-trip pipeline
(WP-06).

**Wave 4** will extend this sidecar with a `live` mode that extracts production
data from Supabase using the `SUPABASE_SERVICE_ROLE_KEY` vault key.

## Structure

```
src/
  main.ts      CLI entry-point; ikenga stdio JSON-RPC loop
  etl.ts       SQLite writer (INSERT OR REPLACE; uses bun:sqlite)
  fixture.ts   Deterministic synthetic dataset covering all 7 domain tables
  types.ts     Shared types (RpcRequest/Response, RunParams, TableResult …)
```

## Invocation (via iyke)

```http
POST /pkg/com.ikenga.local-store-etl/etl
Content-Type: application/json

{
  "id": 1,
  "method": "run",
  "params": {
    "mode": "fixture",
    "db_path": "/path/to/pa.db",
    "dry_run": false
  }
}
```

## Verification (WP-03 DoD)

```bash
# 1. Load fixture
iyke call com.ikenga.local-store-etl/etl '{"mode":"fixture","db_path":"<db>"}' 

# 2. Check counts match fixture data
sqlite3 <db> "SELECT 'tasks', count(*) FROM tasks"

# 3. Re-run — must be a no-op (rows_inserted = 0 for all tables)
iyke call com.ikenga.local-store-etl/etl '{"mode":"fixture","db_path":"<db>"}'

# 4. NDJSON round-trip (WP-06)
#    db_export_ndjson → fresh db → db_import_ndjson → re-export must be
#    byte-identical.
```

## Building

```bash
pnpm install
bash build.sh
```

## Wave 4 stub

To add live extraction, add `extractLive(url, serviceRoleKey): Promise<FixtureDataset>`
to `fixture.ts` (or a new `live.ts`) and wire it into `handleRun` in `main.ts`
when `mode === "live"`.
