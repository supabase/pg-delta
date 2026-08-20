# supabase_vault presence-only contract

- **Status**: Implemented (CLI-1434). Sibling of [extension-intent.md](./extension-intent.md).
- **Relates to**: CLI-1434, CLI-1385 Phase 6 (vault / pg_net / vector / postgis).
- **pg_net** is out of scope here (CLI-1433, unresolved CLI-side templating).

> **One sentence.** pg-delta diffs `supabase_vault` as an ordinary extension
> (CREATE / DROP) and never reads secret content. When vault is *in use* on
> the side that has it, the plan carries a `vault_presence` warning so the
> operator knows values and keys must be re-created via the platform API.

The supabase profile filters `supabase_vault` and the `vault` schema as
platform-managed (`SUPABASE_SYSTEM_EXTENSIONS` / `SUPABASE_SYSTEM_SCHEMAS`).
This contract is for the **`raw` profile** and the **shadow-load path**.

## State matrix

| # | Source vault | Target vault | Vault in use on source | Behavior |
|---|---|---|---|---|
| 1 | no | no | — | Normal diff. Nothing to do. |
| 2 | yes | no | no | Plan emits `CREATE EXTENSION supabase_vault` (generic path). |
| 3 | yes | no | yes | Same CREATE **plus** a `warning` diagnostic `vault_presence`. Secrets/keys are not migrated and must be re-created via the Vault section of the dashboard or the management API. The plan still proceeds; warnings block only under `--strict-coverage`. |
| 4 | no | yes (in use) | — | Plan emits `DROP EXTENSION supabase_vault`. `vault.secrets` is a table member, so the DROP is `dataLoss: "destructive"` and surfaces as a `data_loss` hazard. A `vault_presence` warning names `vault.secrets`. |
| 5 | yes | yes | yes | Vault content is opaque; nothing diffs. |

"Source" / "target" here are the RFC sides: source is the vault-having
declarative state when creating, target is the live database. In `plan(source,
desired)` library terms, case 2/3 is `plan(no-vault, has-vault)` and case 4 is
`plan(has-vault, no-vault)`.

## "Vault in use"

Catalog-structural only — **the engine never reads `vault.secrets`** (or
pgsodium keys). Vault is in use when the fact base that *has* the extension
contains a **kept** (non-reference-only, non-member) fact with a `depends` edge
onto a `supabase_vault` member, a member's non-satellite descendant, **or the
extension itself**: extract folds `pg_proc` / `pg_type` member endpoints to
`extension:supabase_vault` (`COALESCE(extm.id, …)`), so a column typed with a
vault type or a function depending on a vault proc lands on the extension id.
A user view over `vault.decrypted_secrets` still targets the view member
(`pg_class` is not folded).

A `LANGUAGE sql` function that selects from a vault view often records **no**
`pg_depend` when `check_function_bodies` is off (the Supabase image default),
so it is not a reliable signal.

If no such edge exists, case 3 degrades to case 2. That is acceptable: the
diagnostic is best-effort. A database that stores secrets but has no
schema-level dependent will not warn on CREATE; DROP is still destructive
because `vault.secrets` is a table member.

## Shadow precheck

`vaultHandler` (`src/policy/extensions/vault.ts`) is a filter-only handler
(no `intentKinds`, `capture()` returns nothing). Its `shadowPrecheck`:

- `matchesStatement` — masked `vault.create_secret(` / `vault.update_secret(`
  and `CREATE EXTENSION supabase_vault` (quoted dump forms included:
  `findMatchingStatements` keeps identifier text so
  `CREATE EXTENSION IF NOT EXISTS "supabase_vault"` still matches)
- `capable()` — `pg_available_extensions` contains `supabase_vault`; otherwise
  an actionable reason: use a Supabase image or remove vault statements

Wired into **`rawProfile` only**. Custom profiles may name `"supabase_vault"`
in their `handlers` array. Not added to the supabase profile.

## Related: PostGIS relocation

`postgis` is non-relocatable. A source/desired schema disagreement used to
plan `DROP EXTENSION postgis` (cascading over every geometry/geography column
and `spatial_ref_sys`). The planner now refuses that replace with an
actionable error; a genuine `DROP EXTENSION postgis` is unchanged. See
`NEVER_REPLACE_FOR_RELOCATION` in `src/plan/rules/schemas.ts`.

**Known limitation (not implemented):** user-inserted rows in
`spatial_ref_sys` are data, not schema. pg-delta does not migrate them.
