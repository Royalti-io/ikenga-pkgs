---
"@ikenga/pkg-tasks": minor
---

Remove the supabase-js dependency from the Tasks pkg. The status-update write
now goes through the host's `host.dbExec` verb (local pa.db) like the reads
already do via `host.dbQuery`, so the pkg no longer declares the `supabase`
capability, `supabase.tables` permission, or supabase network/CSP access.
