# Spike report: generating `GeneratorMetadata` from a PostgREST OpenAPI contract

**TL;DR** — Plumbing works perfectly: a `openApiToGeneratorMetadata(doc)` producer
drops straight into the existing pure generators with **zero generator changes**, and
the resulting `candidate.ts` is **valid, strict-typechecking TypeScript**. But fidelity
is low. Against the rich introspection fixture the OpenAPI-only output is **~46 % of the
reference byte size** (17,001 vs 36,607 bytes) with a **1,069-line unified diff**. Some
surfaces are fully recoverable (enums, constants, column scalar types, RPC *argument*
types, primary keys, base-table FK direction); the load-bearing ones are not (object kind,
function **return** types, computed fields, relationship expansion, composite types,
insert/identity optionality).

**Recommendation: do NOT ship OpenAPI as a standalone source of truth.** It is viable only
as an explicitly-labelled *lossy / best-effort* adapter, or — better — as
"OpenAPI + a few supplementary catalog queries". Details and a decision matrix at the end.

---

## How this was produced

- **Schema:** the existing rich fixtures `test/introspection/fixtures/00-init.sql` +
  `01-memes.sql` (13 tables incl. 2 partitions, 5 views, 1 matview, 1 foreign table,
  enum + 2 composite types, ~80 functions incl. overloads / polymorphic / computed-field /
  SETOF / table-arg, RLS, partitioned table).
- **Stack:** `postgres:15-alpine` + `postgrest/postgrest` (the real image — it pulled
  fine on local Docker Desktop, so the host-PostgREST fallback was **not** needed and no
  OpenAPI input was hand-fabricated). Containers are driven via the `docker` CLI from
  `run.ts` (testcontainers' lifecycle promise did not resume under Bun after its
  health-check wait — see the note in `run.ts`). PostgREST ran with
  `PGRST_DB_SCHEMAS=public`, `PGRST_DB_ANON_ROLE=anon`,
  `PGRST_OPENAPI_MODE=ignore-privileges`. The schema cache was reloaded
  (`NOTIFY pgrst, 'reload schema'`) and the root endpoint polled until the expected
  definitions appeared before capture.
- **Two paths, one generator:**
  - reference: `introspect(pool, {includedSchemas:["public"]})` → `generateTypescript` → `reference.ts`
  - candidate: `openApiToGeneratorMetadata(openapi.json)` → `generateTypescript` → `candidate.ts`
- **Artifacts** (all in this dir): `openapi.json`, `reference.ts`, `candidate.ts`,
  `output.diff`, `stats.json`.
- **Validation:** the synthesized metadata passes `parseGeneratorMetadata()` and both
  `reference.ts` and `candidate.ts` pass `tsc --noEmit --strict`.

### Headline metrics (`stats.json`)

| metric | reference (live DB) | candidate (OpenAPI) |
|---|---|---|
| tables | 13 | **18** (everything collapses here) |
| foreign tables | 1 | 0 |
| views | 5 | 0 |
| materialized views | 1 | 0 |
| columns | 65 | 57 (missing the 2 partitions' 8 cols) |
| relationships | 25 | 5 |
| functions | 72 | 32 |
| types | 658 | 13 (only the ones actually referenced) |
| generated TS bytes | 36,607 | 17,001 |
| unified diff lines | — | 1,069 |

---

## What IS faithfully recoverable

These came out byte-identical (or semantically equivalent) and need no DB access:

- **Enums** — `Enums` block and the `Constants` enum-value arrays match exactly
  (`meme_status`, `user_status`). PostgREST emits the `enum` array + the qualified type
  name in `format`, which is everything the generator needs.
- **Column scalar types** — after a name-mapping layer (PostgREST emits OpenAPI/ SQL
  spellings: `int64`, `int32`, `numeric`, `text`, `uuid`, `timestamp with time zone`,
  `text[]`, …; the generator wants pg_catalog short names: `int8`, `int4`, `timestamptz`,
  `_text`, …). Enum- and table-row-typed columns resolve correctly too.
- **Primary keys** — parsed from the `<pk/>` marker in each property `description`.
- **Base-table FK direction** — parsed from `<fk table='…' column='…'/>`; the referenced
  relation and columns are correct for direct table→table FKs.
- **RPC *argument* types** — recoverable from the RPC POST body schema, which carries each
  arg's `format`. Scalars (`additional_interval: string`), numerics (`user_id: number`),
  and even relation-row args (`user_row: Database["public"]["Tables"]["users"]["Row"]`)
  all render correctly.
- **Row nullability for NOT NULL columns** — see the nuance below; the common case works.

---

## Gap categories (ranked by impact)

### 1. Object-kind classification — *structural, pervasive* 🔴
PostgREST's OpenAPI does not distinguish **table / view / materialized view / foreign
table**: they are all just `definitions`. Everything lands under `Tables`; `Views`,
`materializedViews` and `foreignTables` are empty in the candidate. Concretely:
`a_view`, `todos_view`, `users_view`, `user_todos_summary_view`,
`users_view_with_multiple_refs_to_users`, `todos_matview`, `foreign_table` all move from
their correct collection into `Tables`. This also corrupts cross-references: a column typed
as a view row renders `…["Tables"]["a_view"]["Row"]` instead of `…["Views"]["a_view"]["Row"]`.
**Not fixable from OpenAPI alone.**

### 2. Function **return** types & SETOF metadata — *structural, the biggest single loss* 🔴
PostgREST OpenAPI describes RPC *responses* generically (`200 OK`, no schema). Every
candidate function is `Returns: unknown`, with:
- **No `SetofOptions`** (the `from`/`to`/`isOneToOne`/`isSetofReturn` block the generator
  emits for table-/view-returning functions — used by the client for embedded selects).
- **Overloads collapsed** — PostgREST exposes one `/rpc/<name>` path per name, so
  `test_unnamed_row_setof` (3 overloads → 1) and similar lose their union signatures.
- **Unnamed single-arg / computed-style functions absent** — functions with unnamed table-row
  args (`blurb`, `details_length`, `test_unnamed_row_scalar`, …) aren't RPC-callable and
  don't appear at all (see also #4).
- **No conflict/error reporting** — the `{ error: true } & "…schema cache…"` diagnostics the
  generator produces for unresolvable overloads are gone.

Functions are 32 (candidate) vs 72 (reference). *Argument* types are fine (see above); it's
the **return** side that's unrecoverable.

### 3. Relationship expansion — *structural* 🔴
Reference emits 25 relationships, candidate 5. Missing:
- **View / matview relationship expansion** (e.g. `todos → users_view`, `todos_view → users`,
  multiple refs through `users_view_with_multiple_refs_to_users`). PostgREST only tags FKs on
  base-table columns.
- **Reverse relationships** and any FK not expressible as a single `<fk/>` tag.
- **Real constraint names** — synthesized as `<table>_<col>_fkey`, which is wrong whenever the
  FK lives on a view-like object (`todos_view_user-id_fkey` vs the real `todos_user-id_fkey`).
- **`isOneToOne`** — always `false`; 1:1 detection is impossible.
- Documented PostgREST quirks that would bite a real adapter: **FK tag dropped when the column
  is also UNIQUE** (PostgREST #3418) and **cross-schema FK omits the schema** (#1874). Not
  triggered by this single-schema fixture but real.

### 4. Computed fields (function-based columns) — *structural* 🟠
Functions like `blurb`, `details_length`, `created_ago`, `days_since_event`,
`get_todos_by_matview` appear as **extra `Row` keys** in the reference (e.g.
`events.Row.days_since_event: number | null`). They are **not present anywhere** in the
OpenAPI document (neither as columns nor as `/rpc`), so the candidate omits them entirely.

### 5. Composite types — *structural* 🟠
`CompositeTypes` is empty in the candidate (`[_ in never]: never`) vs two entries in the
reference (`composite_type_with_array_attribute`, `composite_type_with_record_attribute`).
PostgREST doesn't surface standalone composite types as definitions.

### 6. Insert/Update optionality (identity & generated) — *behavioural* 🟠
- `is_identity` / `is_generated` / `identity_generation` are unavailable. The generator uses
  them to mark insert columns optional and to emit `?: never` for `GENERATED ALWAYS`. Result:
  every identity PK becomes **required on Insert** in the candidate (`id: number` vs reference
  `id?: number`) across `users`, `todos`, `category`, `memes`, `interval_test`,
  `table_with_primary_key_other_than_id`, …
- PostgREST does emit `default` for *some* columns (`status`, `user_uuid`) but **not** for
  identity columns, so even the "has a default ⇒ optional on insert" heuristic can't fully
  recover this.

### 7. Partitioned tables — *coverage* 🟠
Partition children (`events_2024`, `events_2025`) are not exposed by PostgREST; only the
parent `events` appears. Accounts exactly for the column delta (65 → 57).

### 8. Row nullability nuance — *mostly OK, one behavioural edge* 🟡
**Empirical correction to the spike premise:** PostgREST's `required` array reflects **NOT
NULL** (the identity PK `id` is `required` *despite* having a default), not "NOT NULL **and**
no default". So `is_nullable := !required` is accurate for `Row` types in the common case. The
residual error is only the Insert-optionality interaction in #6.

### 9. Things absent but harmless for the *TypeScript* generator — 🟢
RLS flags, replica identity, table stats/size, column `check`, `is_unique`, `data_type`,
schema owner — none are read by `generateTypescript`, so fabricating defaults costs nothing
here. (They would matter for other consumers of `GeneratorMetadata`.)

### 10. OID synthesis — *non-issue* 🟢
The generator is name-keyed for almost everything; a monotonic memoized OID factory with a
small synthesized `types` registry was sufficient to make all joins (`table_id`, arg
`type_id`) resolve. No real OIDs needed.

---

## Corrections to the original assumptions

1. **`required` = NOT NULL**, not "NOT NULL and no default" (see #8). Nullability is *less*
   lossy than feared.
2. **RPC argument types are recoverable** from the POST body schema `format` (the plan
   expected "best-effort / weak"). Only *return* types are truly absent.
3. **A type-name mapping layer is mandatory** (`int64→int8`, `timestamp with time zone→
   timestamptz`, `text[]→_text`, …) — PostgREST does not speak pg_catalog short names.
4. **Object kind is the dominant structural gap**, ahead of functions — every view/matview/
   foreign table is misfiled, which also poisons column cross-references.

---

## Recommendation

**Drop OpenAPI as a standalone producer; keep it as an opt-in lossy adapter, and seriously
consider the hybrid.**

| Option | Verdict |
|---|---|
| **Ship OpenAPI-only as the introspection replacement** | ❌ No. Loses object kind, function returns, computed fields, relationship expansion, composite types, identity insert-optionality. Output is valid TS but materially wrong for real client usage. |
| **Ship as an explicitly-labelled "lossy / no-credentials" adapter** | ⚠️ Acceptable only behind a loud opt-in. Good enough for a rough scaffold from a URL; not for production client types. Must document the gaps above. |
| **OpenAPI + a handful of supplementary catalog queries** | ✅ Most promising. OpenAPI already nails enums, scalar column types, PKs, base FKs and RPC arg types. A *small* set of catalog reads (relkind for object classification, `pg_proc` for return types/SETOF/overloads, `pg_attribute.attidentity`/`attgenerated`, `pg_type` for composites, `pg_depend`/`pg_constraint` for full relationships) closes the structural gaps — but that path needs a DB connection, which defeats the "URL only" goal. |
| **Drop entirely** | Reasonable if the only motivation was "types from a URL with no DB"; the lossy output may do more harm than good for users who assume parity. |

If we proceed with an adapter, the production version should: (a) live behind a clearly named
opt-in (e.g. `fromPostgrestOpenApi`), (b) carry the type-name mapping table, (c) emit a
machine-readable "fidelity warnings" list (object-kind unknown, function returns unknown,
computed fields dropped, …) so downstream tools can surface them, and (d) reuse this spike's
diff harness as a regression gate against the live-DB path.

---

*This is throwaway spike code under `experiments/openapi-spike/` — not wired into the package
build or exports, and ships no changeset. Re-run with
`cd packages/postgrest-typegen && bun experiments/openapi-spike/run.ts` (Docker required).*
