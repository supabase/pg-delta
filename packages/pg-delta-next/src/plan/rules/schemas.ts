/** Rule definitions for schemas and extensions. */
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
    // The SCHEMA clause is derived from the extension's `relocatable` fact
    // (pg_extension.extrelocatable), not a serialize param: a relocatable
    // extension honours `SCHEMA <s>` and must be ordered after that schema; a
    // non-relocatable extension creates its own schema, so it emits a bare
    // CREATE EXTENSION and requires no schema. See docs/architecture/managed-view-architecture.md.
    create: (fact) => [
      p(fact, "relocatable") === true
        ? {
            sql: `CREATE EXTENSION ${qid((fact.id as { name: string }).name)} SCHEMA ${qid(str(p(fact, "schema")))}`,
            consumes: [{ kind: "schema", name: str(p(fact, "schema")) }],
          }
        : {
            sql: `CREATE EXTENSION ${qid((fact.id as { name: string }).name)}`,
          },
    ],
    drop: (fact) => ({
      sql: `DROP EXTENSION ${qid((fact.id as { name: string }).name)}`,
    }),
    attributes: {
      schema: {
        alter: (fact, _from, to) => ({
          sql: `ALTER EXTENSION ${qid((fact.id as { name: string }).name)} SET SCHEMA ${qid(str(to))}`,
          consumes: [{ kind: "schema", name: str(to) }],
        }),
      },
    },
  },
};
