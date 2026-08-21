---
"@supabase/pg-topo": patch
---

Fix range subtype default opclass diagnostics for built-in and domain subtypes, schema-qualified array types that shadow built-ins, and external default opclass provider subtype matching. Explicit range opclass dependencies now include subtype constraints, unqualified built-in operator family names resolve through pg_catalog when no local family exists, and pg_catalog hash support routines are recognized without local producers. Operator comments now preserve concrete argument signatures, `NONE` opclass support operator slots stay unary-only, annotated operator class providers satisfy omitted range opclass dependencies, and external range providers no longer invent default multirange types without an explicit multirange provider.

Also require omitted range subtype opclass providers to be `DEFAULT`, preserve explicit public built-in type references when deduping implicit refs, avoid treating set-returning routines as scalar callback providers, ignore implicit built-in type refs in self-reference checks, require non-ordering opclass search operators to resolve to boolean-returning operators when a local same-signature shadow exists, and require options support callbacks across btree, hash, GiST, SP-GiST, GIN, and BRIN operator classes to return `void`.

Recognize the built-in BRIN minmax support routines in slots 2-4, report duplicate access method names even when the conflicting definitions use different access method types, and include external domain providers in implicit array-name collision context.

Tighten additional pg-topo dependency checks for PostgreSQL catalog behavior: binary-coercible operator class matches now apply only to catalog-resolved types, BRIN support routines validate return types, polymorphic `anycompatible*` pseudo-types are recognized as built-ins, unqualified built-in access-method handlers resolve through pg_catalog when no local shadow exists, ORDER BY support operators validate result type against the chosen btree family, and built-in JSONB operator implementation callbacks are recognized without local producers.

Require fixed-return GiST, GIN, and SP-GiST support routines to match PostgreSQL callback return types, preserve wrong-return external shadows of omitted built-in range callbacks so graph validation can report them, and cover `RETURNS TABLE` routines as scalar range callback non-providers.

Infer return-aware operators from external and pg_catalog operator implementation callbacks, track custom index access method dependencies, preserve shadowed ORDER BY operator families created implicitly by opclasses or supplied externally, and recognize PostgreSQL's shipped JSONB GIN support routines without requiring local producers.
