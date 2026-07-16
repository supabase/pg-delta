/** Foreign-data objects: FDWs, servers, user mappings, and foreign tables. */
import type { StableId } from "../core/stable-id.ts";
import {
  aclJson,
  type ExtractContext,
  notExtensionMember,
  parseAcl,
  USER_SCHEMA_FILTER,
} from "./scope.ts";
import { redactOptionStrings } from "./sensitive-options.ts";

export async function extractForeign(ctx: ExtractContext): Promise<void> {
  const { q, facts, pushWithMeta, pushOwnerEdge } = ctx;
  // Redact sensitive option values unless the caller explicitly opted out.
  const opts = (raw: string[]): string[] =>
    ctx.redactSecrets ? redactOptionStrings(raw) : raw;
  // ── foreign data wrappers / servers / user mappings / foreign tables ─
  for (const row of await q(`
    SELECT f.fdwname AS name, r.rolname AS owner,
           CASE WHEN f.fdwhandler <> 0 THEN f.fdwhandler::regproc::text END AS handler,
           CASE WHEN f.fdwvalidator <> 0 THEN f.fdwvalidator::regproc::text END AS validator,
           COALESCE(ARRAY(SELECT opt FROM unnest(f.fdwoptions) opt ORDER BY opt), '{}')::text[] AS options,
           obj_description(f.oid, 'pg_foreign_data_wrapper') AS comment,
           ${aclJson("f.fdwacl", "F", "f.fdwowner")} AS acl
    FROM pg_foreign_data_wrapper f
    JOIN pg_roles r ON r.oid = f.fdwowner
    WHERE ${notExtensionMember("pg_foreign_data_wrapper", "f.oid")}
    ORDER BY f.fdwname`)) {
    const fdwId: StableId = { kind: "fdw", name: String(row["name"]) };
    pushWithMeta(
      {
        id: fdwId,
        payload: {
          handler: row["handler"] == null ? null : (row["handler"] as string),
          validator:
            row["validator"] == null ? null : (row["validator"] as string),
          options: opts((row["options"] as string[]).map(String)),
        },
      },
      row,
      parseAcl(row["acl"]),
    );
    pushOwnerEdge(fdwId, row["owner"]);
  }
  for (const row of await q(`
    SELECT s.srvname AS name, f.fdwname AS fdw, r.rolname AS owner,
           s.srvtype AS type, s.srvversion AS version,
           (SELECT e.extname FROM pg_depend d
            JOIN pg_extension e ON e.oid = d.refobjid
            WHERE d.classid = 'pg_foreign_data_wrapper'::regclass
              AND d.objid = f.oid
              AND d.refclassid = 'pg_extension'::regclass
              AND d.deptype = 'e'
            LIMIT 1) AS fdw_extension,
           COALESCE(ARRAY(SELECT opt FROM unnest(s.srvoptions) opt ORDER BY opt), '{}')::text[] AS options,
           obj_description(s.oid, 'pg_foreign_server') AS comment,
           ${aclJson("s.srvacl", "S", "s.srvowner")} AS acl
    FROM pg_foreign_server s
    JOIN pg_foreign_data_wrapper f ON f.oid = s.srvfdw
    JOIN pg_roles r ON r.oid = s.srvowner
    WHERE ${notExtensionMember("pg_foreign_server", "s.oid")}
    ORDER BY s.srvname`)) {
    const srvId: StableId = { kind: "server", name: String(row["name"]) };
    pushWithMeta(
      {
        id: srvId,
        // an extension-provided FDW has no fact of its own — parent the
        // server to the extension instead so the reference resolves
        parent:
          row["fdw_extension"] != null
            ? { kind: "extension", name: row["fdw_extension"] as string }
            : { kind: "fdw", name: String(row["fdw"]) },
        payload: {
          fdw: String(row["fdw"]),
          type: row["type"] == null ? null : (row["type"] as string),
          version: row["version"] == null ? null : (row["version"] as string),
          options: opts((row["options"] as string[]).map(String)),
        },
      },
      row,
      parseAcl(row["acl"]),
    );
    pushOwnerEdge(srvId, row["owner"]);
  }
  for (const row of await q(`
    SELECT s.srvname AS server, COALESCE(r.rolname, 'PUBLIC') AS role,
           COALESCE(ARRAY(SELECT opt FROM unnest(u.umoptions) opt ORDER BY opt), '{}')::text[] AS options
    FROM pg_user_mapping u
    JOIN pg_foreign_server s ON s.oid = u.umserver
    LEFT JOIN pg_roles r ON r.oid = u.umuser
    WHERE ${notExtensionMember("pg_foreign_server", "s.oid")}
    ORDER BY s.srvname, 2`)) {
    facts.push({
      id: {
        kind: "userMapping",
        server: String(row["server"]),
        role: String(row["role"]),
      },
      parent: { kind: "server", name: String(row["server"]) },
      payload: {
        options: opts((row["options"] as string[]).map(String)),
      },
    });
  }
  for (const row of await q(`
    SELECT n.nspname AS schema, c.relname AS name, r.rolname AS owner,
           s.srvname AS server,
           COALESCE(ARRAY(SELECT opt FROM unnest(ft.ftoptions) opt ORDER BY opt), '{}')::text[] AS options,
           obj_description(c.oid, 'pg_class') AS comment,
           ${aclJson("c.relacl", "r", "c.relowner")} AS acl
    FROM pg_foreign_table ft
    JOIN pg_class c ON c.oid = ft.ftrelid
    JOIN pg_foreign_server s ON s.oid = ft.ftserver
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles r ON r.oid = c.relowner
    WHERE ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_class", "c.oid")}
    ORDER BY n.nspname, c.relname`)) {
    const ftId: StableId = {
      kind: "foreignTable",
      schema: String(row["schema"]),
      name: String(row["name"]),
    };
    pushWithMeta(
      {
        id: ftId,
        parent: { kind: "server", name: String(row["server"]) },
        payload: {
          server: String(row["server"]),
          options: opts((row["options"] as string[]).map(String)),
        },
      },
      row,
      parseAcl(row["acl"]),
    );
    pushOwnerEdge(ftId, row["owner"]);
  }
}
