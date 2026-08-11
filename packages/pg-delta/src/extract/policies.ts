/** Row-level security policies. */
import {
  type CatalogFamily,
  notExtensionMember,
  USER_SCHEMA_FILTER,
} from "./scope.ts";

// ── row-level security policies ──────────────────────────────────────
const POLICIES_SQL = `
    SELECT n.nspname AS schema, c.relname AS table, pol.polname AS name,
           pol.polcmd AS cmd, pol.polpermissive AS permissive,
           pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
           pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr,
           CASE WHEN pol.polroles = '{0}'::oid[] THEN ARRAY['PUBLIC']::text[]
                ELSE ARRAY(SELECT rolname::text FROM pg_roles WHERE oid = ANY(pol.polroles) ORDER BY rolname)
           END AS roles,
           obj_description(pol.oid, 'pg_policy') AS comment
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_class", "c.oid")}
    ORDER BY n.nspname, c.relname, pol.polname`;

export const policiesFamily: CatalogFamily = {
  name: "policies",
  statements: () => [POLICIES_SQL],
  apply: (ctx, rowSets) => {
    const { pushWithMeta } = ctx;
    for (const row of rowSets[0]!) {
      pushWithMeta(
        {
          id: {
            kind: "policy",
            schema: String(row["schema"]),
            table: String(row["table"]),
            name: String(row["name"]),
          },
          parent: {
            kind: "table",
            schema: String(row["schema"]),
            name: String(row["table"]),
          },
          payload: {
            cmd: String(row["cmd"]),
            permissive: Boolean(row["permissive"]),
            usingExpr:
              row["using_expr"] == null ? null : (row["using_expr"] as string),
            checkExpr:
              row["check_expr"] == null ? null : (row["check_expr"] as string),
            roles: (row["roles"] as string[]).map(String),
          },
        },
        row,
      );
    }
  },
};
