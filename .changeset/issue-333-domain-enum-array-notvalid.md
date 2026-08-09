---
"@supabase/pg-delta": patch
---

Three planning fixes from issue #333: (1) a domain whose `baseType`/`collation` change is a drop+recreate — the planner now fails loud at plan time (instead of emitting a plan Postgres rejects at apply) when a surviving table column still depends on the domain, mirroring the existing in-use range-type guard. (2) An enum value-set rebuild (removal/reorder) migrated every dependent column with a scalar `col::text::<enum>` cast regardless of the column's own declared type; an `enum[]` column now casts correctly (`TYPE <enum>[] USING col::text[]::<enum>[]`) instead of erroring or silently narrowing to scalar. (3) A constraint's `validated` attribute going from `true` to `false` (VALIDATED → NOT VALID) threw `constraint cannot be de-validated in place` instead of planning a fix; it now replaces the constraint (`DROP CONSTRAINT` + `ADD CONSTRAINT … NOT VALID`), matching how `create()` already renders a fresh NOT VALID constraint.
