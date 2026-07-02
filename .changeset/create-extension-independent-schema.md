---
"@supabase/pg-delta-next": patch
---

fix(pg-delta-next): CREATE EXTENSION into an independent schema emits SCHEMA

The `SCHEMA <s>` clause was gated on `pg_extension.extrelocatable`, so a
non-relocatable extension installed into a pre-existing schema (e.g. `pg_net` into
Supabase's `extensions` schema) got a bare `CREATE EXTENSION` and installed into
the wrong schema, leaving a non-applyable `ALTER EXTENSION … SET SCHEMA` residue.
Extraction now records whether the extension OWNS its schema (its script created
it — pg_depend deptype `e`); the CREATE emits `SCHEMA <s>` whenever the schema is
independent (any relocatable extension, or a non-relocatable one not installed into
its own schema) and omits it only when the extension creates its own schema.
