/** Rule definitions for schemas and extensions. */
import type { StableId } from "../../core/stable-id.ts";
import { qid } from "../render.ts";
import type { KindRules } from "../rules.ts";
import { p, renameRule, str } from "./helpers.ts";

/**
 * Canonical `CREATE SCHEMA` rendering — the single source of truth shared by the
 * schema create rule (bare form) and the co-create ownership fold
 * (`internal.ts::foldCoCreateOwnership`), which appends `AUTHORIZATION` so a
 * freshly-created schema + its owner ALTER collapse into one statement. Keeping
 * both callers on this helper means the fold never reconstructs DDL by string
 * surgery — it renders the canonical form and compares.
 */
export function schemaCreateSql(
  schemaName: string,
  ownerRole?: string,
): string {
  const base = `CREATE SCHEMA ${qid(schemaName)}`;
  return ownerRole === undefined
    ? base
    : `${base} AUTHORIZATION ${qid(ownerRole)}`;
}

export const schemaRules: Record<string, KindRules> = {
  schema: {
    weight: 1,
    defaclObjtype: "n", // ALTER DEFAULT PRIVILEGES … ON SCHEMAS
    rename: renameRule(
      (fact) => `ALTER SCHEMA ${qid((fact.id as { name: string }).name)}`,
    ),
    create: (fact) => [
      { sql: schemaCreateSql((fact.id as { name: string }).name) },
    ],
    drop: (fact) => ({
      sql: `DROP SCHEMA ${qid((fact.id as { name: string }).name)}`,
    }),
    ownerAlterPrefix: (fact) =>
      `ALTER SCHEMA ${qid((fact.id as { name: string }).name)}`,
    attributes: {},
  },

  extension: {
    weight: 2,
    // Whether to emit `SCHEMA <s>` is a PLAN-TIME property, not an extract-time
    // one: the clause is valid iff schema `s` EXISTS when CREATE EXTENSION runs.
    // Emit it when `s` is present on the target (source view — including the
    // reference-only platform schemas the policy keeps, e.g. Supabase's
    // "extensions"), OR when `s` is created by this plan (a managed, non-
    // reference-only desired schema; the `consumes` edge orders CREATE SCHEMA
    // first). Otherwise the extension creates its OWN schema from its control
    // file (pgmq), so the clause would fail against a not-yet-existing schema —
    // emit the bare form; built-in schemas (pg_cron's pg_catalog) are never
    // extracted and fall here too. `relocatable` / `_schemaIsMember` cannot
    // express this — the `deptype='e'` schema→extension edge never exists, so
    // `_schemaIsMember` was always false and the rule always emitted the clause
    // (da8ce04 regression). See docs/architecture/managed-view-architecture.md.
    create: (fact, view, _params, sourceView) => {
      const schemaName = str(p(fact, "schema"));
      const schemaId: StableId = { kind: "schema", name: schemaName };
      const schemaPresent =
        sourceView?.get(schemaId) !== undefined ||
        (view.get(schemaId) !== undefined && !view.isReferenceOnly(schemaId));
      const name = qid((fact.id as { name: string }).name);
      return [
        schemaPresent
          ? {
              sql: `CREATE EXTENSION ${name} SCHEMA ${qid(schemaName)}`,
              consumes: [schemaId],
            }
          : { sql: `CREATE EXTENSION ${name}` },
      ];
    },
    drop: (fact) => ({
      sql: `DROP EXTENSION ${qid((fact.id as { name: string }).name)}`,
    }),
    attributes: {
      schema: {
        // consume the NEW schema so the relocation is ordered after its CREATE;
        // release the OLD schema so it runs before a same-plan DROP SCHEMA of
        // the old home (otherwise the drop can be sequenced first and fail).
        alter: (fact, from, to) => ({
          sql: `ALTER EXTENSION ${qid((fact.id as { name: string }).name)} SET SCHEMA ${qid(str(to))}`,
          consumes: [{ kind: "schema", name: str(to) }],
          releases: [{ kind: "schema", name: str(from) }],
        }),
        // A non-relocatable extension rejects SET SCHEMA, so relocating it must
        // be a drop + recreate in the new schema (its create rule emits the
        // `SCHEMA <s>` clause). The relocatable flag is extracted per extension.
        replaceWhen: (_from, _to, fact) => p(fact, "relocatable") === false,
      },
    },
  },
};
