/**
 * The reserved `_custom/` directory of a declarative export tree
 * (docs/architecture/custom-folder.md).
 *
 * `schema export` owns its output tree: it prunes the files a previous export
 * owned and REFUSES when it finds a `.sql` it does not own, because
 * `schema apply --dir` loads the whole tree recursively and a stray file is a
 * real hazard. That leaves nowhere inside the tree for the SQL a user *must*
 * keep next to their schema: the kinds the engine detects but does not model
 * (casts, operators, text-search objects, …, reported as `unmodeled_kind`) and
 * idempotent DML. Without such a place, a MODELED object that depends on an
 * UNMODELED one — an index over a custom text search configuration, say — can
 * never be elaborated in the shadow again.
 *
 * `_custom/` is that place, and the reservation is enforced on the WRITE side
 * only:
 *   - the pruner never scans it (nothing inside is ever deleted, with or
 *     without `--prune-unmanaged`) and it is never reported `unmanaged`, so a
 *     re-export never refuses on it;
 *   - the exporter must never write into it (a collision is a hard error) and
 *     never records it in the manifest's owned `files`;
 *   - `README.md` is scaffolded once, so the contract is discoverable in the
 *     directory itself. It is not a `.sql` file, so the loader and the pruner
 *     both ignore it.
 *
 * The READ side needs no change at all: `collectSqlFiles` already globs
 * `_custom/**\/*.sql` into the shadow, which is the whole point — the folder
 * feeds the shadow, never the target (unmodeled objects produce no facts, so
 * they cannot enter a plan; the operator delivers them through their own
 * migration channel).
 *
 * Only the ROOT-level `_custom` is reserved: one auditable location, no
 * configuration (docs/architecture/custom-folder.md §7).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The reserved directory name, at the root of an export tree. */
export const CUSTOM_DIR_NAME = "_custom";

/** The scaffolded contract documentation inside the reserved folder. */
export const CUSTOM_README_NAME = "README.md";

/**
 * True when `relPath` — a path RELATIVE to the export root, with either
 * separator — is the reserved directory or lives inside it. Matches the first
 * segment exactly, so `_customer/x.sql` (prefix sibling) and
 * `schemas/app/_custom/x.sql` (nested) are ordinary managed paths.
 */
export function isCustomPath(relPath: string): boolean {
  if (relPath === "") return false;
  const [first] = relPath.split(/[\\/]/);
  return first === CUSTOM_DIR_NAME;
}

/** Verbatim template of the scaffolded `_custom/README.md`
 *  (docs/architecture/custom-folder.md §6). */
export const CUSTOM_README_TEMPLATE = `# \`_custom/\` — SQL that pg-delta does not manage

Files in this folder are **preserved across \`pgdelta schema export\` runs**:
the exporter never writes here, never deletes anything here, and never counts
these files as "unmanaged".

Put here the SQL that pg-delta detects but does not model (reported as
\`unmodeled_kind\`): casts, operators, operator classes/families, text search
objects, statistics objects, transforms — plus idempotent DML your schema
depends on (write seeds as \`INSERT … ON CONFLICT DO NOTHING\`).

## What these files do — and do not do

- They ARE loaded into the shadow database by \`pgdelta schema apply\`, so
  modeled objects that depend on them (e.g. an index over a custom operator
  class) elaborate correctly, and re-exports keep working.
- They are NOT executed against your target database. You must deliver the
  same change through your normal migration channel.

## Link each file to its migration

Record the migration(s) that delivered a file as head-of-file comments:

    -- pgdelta-migration: ../../supabase/migrations/20260811120000_add_cast.sql

Use \`-- pgdelta-migration: none\` if a file deliberately has no migration twin.
\`pgdelta schema lint\` warns on missing or dangling references.

## Do not put modeled DDL here

Tables, views, functions, policies, … belong in the managed tree — the
exporter regenerates them. A modeled object kept here becomes a duplicate on
the next export and breaks \`schema apply\`. \`pgdelta schema lint\` warns when it
sees one.
`;

/**
 * Create `<outRoot>/_custom/README.md` when it does not exist yet, returning
 * whether it was written. The folder itself is created too, so a fresh export
 * advertises the escape hatch before anyone needs it. An existing README is
 * NEVER overwritten — operators annotate it.
 */
export function scaffoldCustomReadme(outRoot: string): boolean {
  const dir = join(outRoot, CUSTOM_DIR_NAME);
  const readme = join(dir, CUSTOM_README_NAME);
  mkdirSync(dir, { recursive: true });
  if (existsSync(readme)) return false;
  writeFileSync(readme, CUSTOM_README_TEMPLATE, "utf8");
  return true;
}
