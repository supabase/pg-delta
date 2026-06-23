---
"@supabase/pg-delta-next": patch
---

Stop emitting redundant `REVOKE ALL` / `GRANT` pairs that only re-materialize a freshly-created object's built-in default privileges. A new cosmetic compaction pass elides ACL statements on co-created objects when the grant reproduces a PostgreSQL default — the owner's implicit grant, or PUBLIC's default `USAGE`/`EXECUTE` on types, domains, languages, functions, procedures and aggregates. `CREATE TYPE … AS ENUM` now plans as just the `CREATE TYPE` (+ `ALTER … OWNER TO`) instead of six statements. The elision is proof-stable (the applied state is identical, asserted with compaction on and off) and never suppresses a non-default or third-party grant. Pass `--no-compact` to keep the fully spelled-out output.
