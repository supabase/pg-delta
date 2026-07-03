/** Schemas and extensions. */
import type { StableId } from "../core/stable-id.ts";
import {
  aclJsonMemberAware,
  type ExtractContext,
  memberExtensionExpr,
  parseAcl,
  USER_SCHEMA_FILTER,
} from "./scope.ts";

export async function extractSchemasAndExtensions(
  ctx: ExtractContext,
): Promise<void> {
  const { q, pushWithMeta, pushMemberEdge, pushOwnerEdge } = ctx;

  // ── schemas ──────────────────────────────────────────────────────────
  for (const row of await q(`
    SELECT n.nspname AS name, r.rolname AS owner,
           obj_description(n.oid, 'pg_namespace') AS comment,
           ${aclJsonMemberAware("n.nspacl", "n", "n.nspowner", "pg_namespace", "n.oid")} AS acl,
           ${memberExtensionExpr("pg_namespace", "n.oid")} AS ext_member_of
    FROM pg_namespace n
    JOIN pg_roles r ON r.oid = n.nspowner
    WHERE ${USER_SCHEMA_FILTER}
    ORDER BY n.nspname`)) {
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

  // ── extensions (version deliberately excluded from the payload) ─────
  // Whether CREATE EXTENSION emits `SCHEMA <s>` is decided at PLAN time from the
  // schema's presence (extension create rule), not from an extract-time signal:
  // Postgres records no schema→extension ownership edge (deptype 'e' never
  // exists), so there is nothing to extract here for that decision.
  for (const row of await q(`
    SELECT e.extname AS name, n.nspname AS schema,
           e.extrelocatable AS relocatable,
           obj_description(e.oid, 'pg_extension') AS comment
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname <> 'plpgsql'
    ORDER BY e.extname`)) {
    pushWithMeta(
      {
        id: { kind: "extension", name: String(row["name"]) },
        payload: {
          schema: String(row["schema"]),
          relocatable: Boolean(row["relocatable"]),
        },
      },
      row,
    );
  }
}
