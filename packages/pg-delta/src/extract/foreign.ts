/** Foreign-data objects: FDWs, servers, user mappings, and foreign tables. */
import { USER_MAPPING_UNREADABLE } from "../core/diagnostic.ts";
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
  const { q, facts, pushWithMeta, pushOwnerEdge, factDiagnostics } = ctx;
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
  // pg_user_mapping is superuser/owner-only (it can carry FDW credentials in
  // umoptions) — a non-superuser role gets `permission denied for table
  // pg_user_mapping` on ANY query referencing it, even one matching zero rows
  // (Postgres checks table-level SELECT privilege before evaluating). Probe
  // once and fall back to the world-readable `pg_user_mappings` view.
  //
  // The view NULLs `umoptions` for a row the caller isn't authorized on, but
  // NULL is also the value of a mapping that genuinely HAS no options — those
  // two cases are indistinguishable from `umoptions` alone. Naively coalescing
  // NULL to '{}' would fabricate a "no options" fact for a row the view is
  // actually HIDING, which could then mislead diff/plan into wrong DDL. So
  // `options_known` recomputes the view's own authorization predicate to tell
  // "genuinely empty" from "hidden" apart: a genuinely empty, visible mapping
  // still produces a fact; a hidden one is SKIPPED with a diagnostic instead.
  // The predicate mirrors `pg_get_viewdef('pg_user_mappings')` exactly
  // (identical on PG14 and PG17): non-NULL umoptions is proof of visibility by
  // itself; a mapping FOR a specific role is visible to that role only if it
  // is ALSO the server owner (or a member of it) or holds USAGE on the
  // server — a user does NOT automatically see their own mapping's options
  // (verified empirically: a bare NOSUPERUSER role with no grants sees NULL
  // even querying its own mapping); a PUBLIC mapping is visible to anyone who
  // is a member of the server's owner role. (The view's third disjunct,
  // `current_user` being a superuser, is omitted here — this fallback only
  // ever runs for a role `has_table_privilege` already found non-superuser.)
  // If a PG version's view is MORE permissive than this predicate, its
  // non-NULL `umoptions` still classifies correctly on its own; the only
  // failure direction is over-skipping, never fabricating.
  //
  // A warning alone is not enough (Codex P1 on PR #338): if the OTHER side of
  // a diff CAN see this mapping, the missing fact reads as an intentional
  // add/remove and `plan()` would emit a wrong CREATE/DROP USER MAPPING. So
  // each skipped row's diagnostic carries `subject` = its would-be stable id
  // and is pushed onto `factDiagnostics` (rides on the FactBase, not just
  // `ExtractResult.diagnostics`) — `plan()`'s gate escalates to fatal exactly
  // when a delta actually touches one of these subjects.
  const userMappingReadable = Boolean(
    (
      await q(
        `SELECT has_table_privilege('pg_catalog.pg_user_mapping', 'SELECT') AS ok`,
      )
    )[0]?.["ok"],
  );
  const userMappingRows = userMappingReadable
    ? await q(`
    SELECT s.srvname AS server, COALESCE(r.rolname, 'PUBLIC') AS role,
           COALESCE(ARRAY(SELECT opt FROM unnest(u.umoptions) opt ORDER BY opt), '{}')::text[] AS options
    FROM pg_user_mapping u
    JOIN pg_foreign_server s ON s.oid = u.umserver
    LEFT JOIN pg_roles r ON r.oid = u.umuser
    WHERE ${notExtensionMember("pg_foreign_server", "s.oid")}
    ORDER BY s.srvname, 2`)
    : await q(`
    SELECT v.srvname AS server,
           CASE WHEN v.umuser = 0 THEN 'PUBLIC' ELSE v.usename END AS role,
           COALESCE(ARRAY(SELECT opt FROM unnest(v.umoptions) opt ORDER BY opt), '{}')::text[] AS options,
           (v.umoptions IS NOT NULL
            OR (v.umuser <> 0 AND v.usename = current_user
                AND (pg_has_role(s.srvowner, 'USAGE') OR has_server_privilege(s.oid, 'USAGE')))
            OR (v.umuser = 0 AND pg_has_role(s.srvowner, 'USAGE'))) AS options_known
    FROM pg_user_mappings v
    JOIN pg_foreign_server s ON s.oid = v.srvid
    WHERE ${notExtensionMember("pg_foreign_server", "v.srvid")}
    ORDER BY v.srvname, 2`);
  for (const row of userMappingRows) {
    const server = String(row["server"]);
    const role = String(row["role"]);
    const userMappingId: StableId = { kind: "userMapping", server, role };
    if (!userMappingReadable && row["options_known"] === false) {
      factDiagnostics.push({
        code: USER_MAPPING_UNREADABLE,
        severity: "warning",
        subject: userMappingId,
        message:
          `User-mapping options for ${server}/${role} are hidden from the current role by ` +
          "pg_user_mappings (it isn't the mapping's server owner, the mapped user, or a " +
          "member of the PUBLIC mapping's server owner) — the mapping's state is unknown, " +
          "so it was SKIPPED rather than recorded with fabricated empty options.",
      });
      continue;
    }
    facts.push({
      id: userMappingId,
      parent: { kind: "server", name: server },
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
