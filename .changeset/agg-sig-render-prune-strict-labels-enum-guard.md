---
"@supabase/pg-delta": patch
---

Several correctness and packaging fixes:

- **Ordered-set aggregate metadata**: `COMMENT ON` / `SECURITY LABEL ON` an ordered-set or hypothetical-set aggregate now address it with the `agg(direct ORDER BY ordered)` signature (reusing the aggregate DDL's `aggSig`), instead of the flat argument list that PostgreSQL rejects at apply.
- **`render` prunes stale segments**: re-rendering a plan to the same `--out` base now deletes the previous render's segment files (`<base>.sql` / `<base>_<n>.sql`) that the new render no longer produces, so a runner scanning the directory can no longer replay obsolete (possibly destructive) segments. Only render-owned files matching that naming scheme are touched; foreign files are left in place.
- **`--strict-coverage` blocks unresolved security labels**: a valid `SECURITY LABEL` on an unsupported object (language / database / large object / tablespace) now escalates to a blocking diagnostic under `--strict-coverage`, matching `unmodeled_kind`, instead of silently producing an artifact that omits the label.
- **Enum value-set rebuild guard**: removing or reordering enum values while a non-column dependent (a `DOMAIN` over the enum, a `COMPOSITE` attribute using it, or a `RANGE` over it) survives now fails loudly at plan time. The rebuild only migrates column dependents, so such objects would otherwise leave the final `DROP TYPE` failing at apply. Full migration of non-column dependents remains out of scope.
- **ESM-only packaging**: removed the misleading `require` conditions from every `exports` entry. The package is `type: module` with a NodeNext build and ships no CommonJS output, so a `require` condition pointing at ESM was a false CJS signal (`ERR_REQUIRE_ESM` on Node <22). CommonJS consumers must use dynamic `import()`, or Node >=22 (which can `require()` ESM synchronously). ESM consumers are unaffected.
