---
"@supabase/pg-delta": minor
---

Export `hasBlockingDiagnostics` / `STRICT_COVERAGE_CODES`, `dataLossActions`, and database-identity helpers (`SourceDatabaseIdentity`, `observeDatabaseIdentity`, `databaseIdentityStamp`, …) from the package root and `@supabase/pg-delta/frontends`. CLI policy helpers (`printDiagnostics`, `exitIfBlocking`, `assertDataLossAllowed`) stay in `pgdelta`.
