---
"@supabase/pg-delta": patch
---

fix(pg-delta): `pgdelta --version` (and `-v`/`version`) now prints the package version instead of "Unknown command", and `pgdelta schema --help` (and `-h`/`help`) prints the schema subcommand usage to stdout and exits 0 instead of erroring with "Unknown schema subcommand".
