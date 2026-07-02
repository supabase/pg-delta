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
    // Whether to emit `SCHEMA <s>` is NOT simply `relocatable`: an extension
    // honours (and needs) the clause whenever it is installed INTO a schema that
    // exists independently — every relocatable extension, AND a non-relocatable
    // one whose schema it did not create itself (e.g. pg_net into Supabase's
    // "extensions"). Only an extension that creates its OWN schema (that schema
    // is its member, `_schemaIsMember`) must omit the clause, since the named
    // schema would not pre-exist. Gate on `_schemaIsMember === false` (known
    // independent) and keep `relocatable` as the backward-compatible fallback for
    // facts without the metadata. See docs/architecture/managed-view-architecture.md.
    create: (fact) => [
      p(fact, "relocatable") === true || p(fact, "_schemaIsMember") === false
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
