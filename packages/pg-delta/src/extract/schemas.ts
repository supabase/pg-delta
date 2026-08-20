/** Schemas and extensions. */
import type { Payload } from "../core/hash.ts";
import type { StableId } from "../core/stable-id.ts";
import {
  aclJsonMemberAware,
  type CatalogFamily,
  memberExtensionExpr,
  parseAcl,
  USER_SCHEMA_FILTER,
} from "./scope.ts";

/**
 * The extension fact payload. Single source of truth for its shape, shared
 * with the planner unit tests so a hand-built fact can never drift from what
 * extraction actually produces. `relocatable` (pg_extension.extrelocatable)
 * is a control-file property of the INSTALLED VERSION — carried for the
 * schema rule's plan-time `replaceWhen` read (a non-relocatable extension
 * relocates by drop + recreate, never SET SCHEMA).
 */
export function extensionPayload(
  schema: string,
  relocatable: boolean,
): Payload {
  return { schema, relocatable };
}

// ── schemas ──────────────────────────────────────────────────────────────
const SCHEMAS_SQL = `
    SELECT n.nspname AS name, r.rolname AS owner,
           obj_description(n.oid, 'pg_namespace') AS comment,
           ${aclJsonMemberAware("n.nspacl", "n", "n.nspowner", "pg_namespace", "n.oid")} AS acl,
           ${memberExtensionExpr("pg_namespace", "n.oid")} AS ext_member_of
    FROM pg_namespace n
    JOIN pg_roles r ON r.oid = n.nspowner
    WHERE ${USER_SCHEMA_FILTER}
    ORDER BY n.nspname`;

// ── extensions (version deliberately excluded from the payload) ─────
// Whether CREATE EXTENSION emits `SCHEMA <s>` is decided at PLAN time from the
// schema's presence (extension create rule), not from an extract-time signal:
// Postgres records no schema→extension ownership edge (deptype 'e' never
// exists), so there is nothing to extract here for that decision.
const EXTENSIONS_SQL = `
    SELECT e.extname AS name, n.nspname AS schema,
           e.extrelocatable AS relocatable,
           obj_description(e.oid, 'pg_extension') AS comment
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname <> 'plpgsql'
    ORDER BY e.extname`;

export const schemasAndExtensionsFamily: CatalogFamily = {
  name: "schemas",
  statements: () => [SCHEMAS_SQL, EXTENSIONS_SQL],
  apply: (ctx, rowSets) => {
    const { pushWithMeta, pushMemberEdge, pushOwnerEdge } = ctx;

    for (const row of rowSets[0]!) {
      const id: StableId = { kind: "schema", name: String(row["name"]) };
      pushWithMeta(
        {
          id,
          payload: {},
        },
        row,
        parseAcl(row["acl"]),
      );
      pushMemberEdge(id, row);
      pushOwnerEdge(id, row["owner"]);
    }

    for (const row of rowSets[1]!) {
      pushWithMeta(
        {
          id: { kind: "extension", name: String(row["name"]) },
          payload: extensionPayload(
            String(row["schema"]),
            Boolean(row["relocatable"]),
          ),
        },
        row,
      );
    }
  },
};
