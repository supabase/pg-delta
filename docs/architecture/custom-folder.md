# The `_custom/` folder: a preserved escape hatch for unmodeled SQL

- **Status**: Feature design — extends `target-architecture.md`; does **not**
  amend its invariants. Phase 1 (preservation + lint) is being implemented;
  Phase 2 (unmodeled-drift diagnostic, optional target execution) is deferred.
- **Date**: 2026-08-11
- **Baseline**: `main` @ the promoted `@supabase/pg-delta` package.

> **One sentence.** A reserved `_custom/` directory at the root of a declarative
> schema export that `schema export` never writes into, never prunes, and never
> refuses on — giving users a durable home for SQL that pg-delta detects but
> does not model (casts, operators, text-search objects, …) and for idempotent
> DML, so that re-exports preserve it and the shadow can elaborate modeled
> objects that depend on it.

---

## 1. The problem

pg-delta's export tree is ownership-tracked: `.pgdelta-export.json` records the
files an export owns; re-export deletes stale owned files and **refuses** when
the tree contains any `.sql` it does not own
(`src/cli/commands/schema.ts`, `writeExportFiles`). The only escape,
`--prune-unmanaged`, **deletes** hand-authored files. Meanwhile the extractor
deliberately does not model certain kinds — casts, operators, operator
classes/families, text-search configurations/dictionaries/parsers/templates,
statistics objects, non-extension languages, transforms, parameter ACLs
(`src/extract/unmodeled.ts`) — surfacing them only as `unmodeled_kind`
diagnostics. DML is permanently out of scope (`target-architecture.md` §1).

The result is a trap: the SQL a user *must* keep alongside their declarative
schema has nowhere safe to live inside it.

This is not merely inconvenient — it breaks `schema apply` outright when a
**modeled** object depends on an **unmodeled** one. An index
`USING gin (to_tsvector('my_config'::regconfig, col))` over a custom text
search configuration, or a domain whose check expression needs a custom cast,
cannot elaborate in the shadow unless the unmodeled prerequisite is loaded
too. Since `schema apply --dir` recursively loads every `.sql` under the tree
(`collectSqlFiles`), the *only* missing piece is a place inside the tree that
survives regeneration.

## 2. The contract

`_custom/` is a reserved directory name at the **root** of the export tree.

| Surface | Behavior |
|---|---|
| `schema export` — write | Never emits a managed file under `_custom/` (guarded; a collision is a hard error). |
| `schema export` — unmanaged scan | `.sql` files under `_custom/` are neither owned nor unmanaged: they never trigger the refusal and are never listed in the manifest. |
| `schema export` — prune | The `_custom/` subtree is never walked; `--prune-unmanaged` never deletes anything inside it. |
| `schema export` — scaffold | On export, if `_custom/README.md` does not exist, it is created with the contract documentation (template in §6). `README.md` is not `.sql`, so the loader and pruner ignore it. |
| `schema apply` | No change: the recursive glob already loads `_custom/**/*.sql` into the shadow, and the bounded retry-round loader (plus the default pg-topo reorder) absorbs ordering. |
| `schema lint` | New warnings — see §4. |
| `unmodeled_kind` diagnostic | Message gains a hint pointing at `_custom/` (§5). |

Every file in `_custom/` has two jobs, and the file mechanically does only the
first:

1. **Shadow elaboration** — it is loaded into the shadow so re-exports preserve
   it and dependent modeled objects elaborate.
2. **Target delivery** — the user's responsibility. `schema apply` **never
   executes `_custom/` against the target**: the folder feeds the shadow, the
   shadow feeds the fact base, and unmodeled objects produce no facts, so they
   are invisible to the diff by construction. The same change must reach
   production through the user's normal migration channel.

## 3. The migration directive

To make the twin-migration discipline checkable, each custom file records the
migration(s) that delivered it, as head-of-file comment directives (precedent:
pg-topo's `-- pg-topo:` annotations):

```sql
-- pgdelta-migration: ../../supabase/migrations/20260811120000_add_ltree_cast.sql
-- pgdelta-migration: ../../supabase/migrations/20260902093000_alter_ltree_cast.sql

create cast (text as public.ltree) with function public.text2ltree(text) as implicit;
```

- **Placement**: recognized only in the head-of-file comment block (blank lines
  and `--` comments before the first statement).
- **Path resolution**: relative to the directory containing the custom file —
  self-contained, no configuration of a migrations directory.
- **Repeatable**: one directive line per migration; a custom file accumulates
  them over its life.
- **Opt-out**: `-- pgdelta-migration: none` for files with no migration twin
  (e.g. an idempotent seed delivered by a separate seed mechanism). Mixing
  `none` with paths is contradictory and warned.

Parsing the directive is **lexical**: it reads comment lines and never
interprets the SQL body, so it stays inside the "never parse SQL to understand
it" invariant.

## 4. Lint rules (all `warning` severity, non-blocking)

| Code | Fires when |
|---|---|
| `custom_missing_migration_ref` | A `_custom/**/*.sql` file has no `pgdelta-migration` directive at all. |
| `custom_dangling_migration_ref` | A directive path does not resolve to an existing file. |
| `custom_conflicting_migration_ref` | `none` is mixed with path directives in one file. |
| `custom_modeled_kind` | A statement inside `_custom/` is of a kind pg-delta models (CREATE TABLE / VIEW / FUNCTION / …, classified via pg-topo). |

Rationale for `custom_modeled_kind`: a modeled object kept in `_custom/` gets
re-exported into the managed tree on the next `schema export`, producing a
duplicate `CREATE` that the shadow loader can never converge on
(`max_rounds_exceeded`). Lint is the right home for all four rules — they are
bookkeeping hygiene, and export/apply should not fail on hygiene.

What the check deliberately does **not** verify:

- **Content equivalence** between the custom file and the migration — that
  would require comparing SQL semantics, which the architecture forbids, and
  migrations legitimately diverge in form.
- **Whether the migration was applied** to the target — pg-delta does not know
  the migration runner. Phase 2's `unmodeled_drift` diagnostic covers the
  *effect* at the catalog level instead, which is strictly stronger.

## 5. Diagnostic hint

The `unmodeled_kind` diagnostic message gains a pointer so the tool closes its
own loop — it detects the gap and names the escape hatch:

> `unmodeled_kind: 2 cast(s) present but not modeled (…samples…) — keep their
> DDL in _custom/ so re-exports preserve it and the shadow can elaborate
> dependents; deliver it to targets via your migration channel.`

## 6. Scaffolded `_custom/README.md` (template)

```markdown
# `_custom/` — SQL that pg-delta does not manage

Files in this folder are **preserved across `pgdelta schema export` runs**:
the exporter never writes here, never deletes anything here, and never counts
these files as "unmanaged".

Put here the SQL that pg-delta detects but does not model (reported as
`unmodeled_kind`): casts, operators, operator classes/families, text search
objects, statistics objects, transforms — plus idempotent DML your schema
depends on (write seeds as `INSERT … ON CONFLICT DO NOTHING`).

## What these files do — and do not do

- They ARE loaded into the shadow database by `pgdelta schema apply`, so
  modeled objects that depend on them (e.g. an index over a custom operator
  class) elaborate correctly, and re-exports keep working.
- They are NOT executed against your target database. You must deliver the
  same change through your normal migration channel.

## Link each file to its migration

Record the migration(s) that delivered a file as head-of-file comments:

    -- pgdelta-migration: ../../supabase/migrations/20260811120000_add_cast.sql

Use `-- pgdelta-migration: none` if a file deliberately has no migration twin.
`pgdelta schema lint` warns on missing or dangling references.

## Do not put modeled DDL here

Tables, views, functions, policies, … belong in the managed tree — the
exporter regenerates them. A modeled object kept here becomes a duplicate on
the next export and breaks `schema apply`. `pgdelta schema lint` warns when it
sees one.
```

## 7. The delivery model, non-goals, and Phase 2

**Delivery model (settled).** Raw SQL — managed and custom alike — executes
only in the disposable, always-empty shadow. The persistent target never
receives raw files; it only ever receives *generated artifacts* (the plan,
consumed as a migration through the user's normal channel). `_custom/`'s
complete job is therefore to make the shadow load fully so the diff sees
everything it models; delivering custom content to the target is the migration
channel's job like everything else — folded **once** into a generated
migration, with the `-- pgdelta-migration:` directive as the delivery record.

**Non-goals (permanent):**

- **Executing `_custom/` against the target — in any mode.** Two designs were
  considered and rejected:
  - *Re-run every apply with an idempotency contract* (`--run-custom` +
    shadow double-run check). Rejected: managed objects converge via computed
    deltas precisely so files never re-run against a live database; demanding
    `DO $$ … IF NOT EXISTS` boilerplate only from custom files splits the
    tool's semantics and shifts a correctness burden onto users.
  - *Run-once gated on target emptiness* (bootstrap-only execution). Rejected
    as unnecessary once the delivery model above is settled: an empty target
    is bootstrapped by replaying migrations, which already carry the custom
    content. Error-tolerant replay ("skip `already exists`") was also
    rejected — existence-based tolerance turns edited definitions into silent
    no-ops, the worst failure mode for a convergence tool.
- Configurable folder name. Convention over configuration; one reserved name
  keeps the manifest, pruner, and docs simple.

**Phase 2 (deferred, decide separately):**

- `unmodeled_drift` diagnostic: run the existing `detectUnmodeledKinds` probe
  on **both** shadow and target during plan/apply and warn when the sets
  differ ("shadow has cast X, target does not — plan statements depending on
  it will fail"). Catalog-sourced, no SQL parsing. This is the pre-flight
  guard for the delivery model: it fires exactly when a generated migration
  would fail on a target that has not yet received custom content.
- A small library helper (custom files + parsed directives, the parser
  already exists) so frontends can implement fold-into-migration delivery:
  the Supabase CLI appends undelivered custom files to the generated
  catch-up migration and stamps the directive back. Run-once semantics come
  from the migration ledger that already exists; pg-delta executes nothing.
- Profile-aware lint: under a frontend that automates delivery,
  `custom_missing_migration_ref` downgrades or disables (the frontend, not
  the user, maintains the directive).
- A per-target ledger table for pg-delta-native run-once execution remains
  explicitly out of scope unless real demand appears — that is a migration
  runner, and users who need one have one.

## 8. Alternatives considered

- **Model the missing kinds.** The roadmap already defers this ("model them
  when a real schema needs it"). Complementary, not competing: the folder is
  the escape hatch while coverage grows, and remains the DML home afterward.
- **Keep custom SQL outside the tree** (the Supabase CLI declarative-schema
  answer today). Fails the shadow-elaboration requirement (§1): modeled
  objects depending on unmodeled prerequisites cannot load.
- **Ownership-exempt individual files by directive** instead of a reserved
  folder. Requires reading file contents during the unmanaged scan and makes
  preservation semantics per-file and invisible in a directory listing; a
  folder is auditable at a glance.
