/** Schemas and extensions. */
import type { StableId } from "../core/stable-id.ts";
import {
  aclJson,
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
           ${aclJson("n.nspacl", "n", "n.nspowner")} AS acl,
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
  for (const row of await q(`
    SELECT e.extname AS name, n.nspname AS schema,
           e.extrelocatable AS relocatable,
           -- Does the extension OWN its schema (its install script created it,
           -- deptype 'e'), or was it installed INTO an independently-existing
           -- schema? A non-relocatable extension can still be installed into a
           -- pre-existing schema via CREATE EXTENSION … SCHEMA (e.g. pg_net into
           -- Supabase's "extensions"); only an extension that creates its own
           -- schema must omit the SCHEMA clause. Carried as non-semantic metadata
           -- so the CREATE rule can choose, without adding a diffed field.
           EXISTS (
             SELECT 1 FROM pg_depend d
             WHERE d.classid = 'pg_namespace'::regclass AND d.objid = e.extnamespace
               AND d.refclassid = 'pg_extension'::regclass AND d.refobjid = e.oid
               AND d.deptype = 'e'
           ) AS schema_is_member,
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
          _schemaIsMember: Boolean(row["schema_is_member"]),
        },
      },
      row,
    );
  }
}
