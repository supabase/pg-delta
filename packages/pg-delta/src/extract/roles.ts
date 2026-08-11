/** Cluster-level role state: roles, role memberships, and default privileges. */
import type { CatalogFamily } from "./scope.ts";

// ── roles (cluster-level) ────────────────────────────────────────────
const ROLES_SQL = `
    SELECT r.rolname AS name, r.rolsuper, r.rolinherit, r.rolcreaterole,
           r.rolcreatedb, r.rolcanlogin, r.rolreplication, r.rolbypassrls,
           COALESCE((SELECT array_agg(cfg ORDER BY cfg)
                     FROM pg_db_role_setting s, unnest(s.setconfig) cfg
                     WHERE s.setrole = r.oid AND s.setdatabase = 0),
                    '{}')::text[] AS config
    FROM pg_roles r
    WHERE r.rolname NOT LIKE 'pg\\_%'
    ORDER BY r.rolname`;

// ── role memberships (cluster-level; multi-grantor rows deduped) ─────
const MEMBERSHIPS_SQL = `
    SELECT r1.rolname AS role, r2.rolname AS member,
           bool_or(m.admin_option) AS admin
    FROM pg_auth_members m
    JOIN pg_roles r1 ON r1.oid = m.roleid
    JOIN pg_roles r2 ON r2.oid = m.member
    WHERE r1.rolname NOT LIKE 'pg\\_%' AND r2.rolname NOT LIKE 'pg\\_%'
    GROUP BY 1, 2
    ORDER BY 1, 2`;

// ── default privileges ───────────────────────────────────────────────
// `pg_default_acl` stores the RESULTING default ACL, so a revoked built-in
// default (e.g. `ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM
// PUBLIC`) shows up only as the ABSENCE of that grantee's row — there is no
// explicit "no privileges" entry. Mirror `aclJson` (scope.ts): when the
// object kind grants PUBLIC (functions EXECUTE, types USAGE) or the owner a
// built-in default, and the stored acl has dropped it, synthesize an empty
// grantee row carrying `revoked_default` (the built-in privileges that were
// removed) so the diff can plan the REVOKE — and, in reverse, restore the
// default with a GRANT. The "has a PUBLIC/owner default" test is derived from
// acldefault() itself, so it stays correct across kinds and PG versions.
// `defaclobjtype` uses 'S' for sequences where acldefault() wants 's'.
// Model each fact as a DEVIATION from the built-in default, not the raw stored
// ACL. `pg_default_acl` materializes the whole effective default, so a grantee
// that sits at its built-in default (e.g. the owner keeping its create-time
// grant) appears in the row even though it is not a customization — extracting
// it would make a customized row assert grants a fresh database already has,
// and DROPPING that fact would wrongly REVOKE the built-in default. So:
//   • a grantee whose stored privileges EQUAL its built-in default → no fact;
//   • a grantee that DIFFERS (custom grant, partial change, grant option) →
//     a fact carrying its actual privileges;
//   • a grantee that HAS a built-in default but is ABSENT from the stored acl
//     (the default was revoked, e.g. `REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`)
//     → an empty marker carrying `revoked_default` so the diff can plan the
//     REVOKE and, in reverse, restore the default with a GRANT —
//     with a conditional carve-out for the grantor's OWN self-entry, whose
//     absence is a behavioral no-op in some shapes but a real revoke in others.
//     The key distinction is PER-SCHEMA vs GLOBAL:
//       • PER-SCHEMA (defaclnamespace <> 0): at object-creation time Postgres
//         ALWAYS re-adds the owner's acldefault entry to the new object's ACL
//         regardless of whether the stored row carried a self-entry (a table
//         created by the owner gets `{owner=arwdDxtm/owner,…}` either way). A
//         row built from grants to OTHER roles never materializes the owner
//         self-entry (`{r2=r/r}`), so a "revoked" owner self-entry here is a
//         no-op — never emit a marker for it, or owner-present and owner-absent
//         rows would extract DIFFERENTLY and break round-trip.
//       • GLOBAL (defaclnamespace = 0): a grant to another role DOES
//         materialize the owner self-entry (`{owner=arwdDxtm/owner,r2=r/owner}`),
//         and Postgres uses the stored acl VERBATIM at creation. So if the
//         owner is revoked while OTHER grantees remain (`{r2=r/owner}`), a table
//         made by the owner really lacks the owner's own privileges — a genuine
//         customization → EMIT the marker. The one exception is a BARE global
//         self-revoke with nothing else granted: the stored row is EMPTY, the
//         created table's relacl degenerates to NULL and the owner keeps its
//         privileges → no-op → no marker. (Verified on postgres:17.)
//     (A grantor self-entry that DIFFERS from acldefault — a partial
//     self-reduction — is still present in the row and handled by the first
//     branch above, so it is not lost.)
// The built-in default is derived from acldefault() (kind/version-robust);
// `defaclobjtype` uses 'S' for sequences where acldefault() wants 's'.
const defaclCode = `CASE d.defaclobjtype WHEN 'S' THEN 's' ELSE d.defaclobjtype END`;
const DEFAULT_PRIVILEGES_SQL = `
    SELECT dr.rolname AS role, n.nspname AS schema, d.defaclobjtype AS objtype,
           acl.grantee_name AS grantee, acl.privileges, acl.grantable,
           acl.revoked_default
    FROM pg_default_acl d
    JOIN pg_roles dr ON dr.oid = d.defaclrole
    LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace,
    LATERAL (
      WITH stored AS (
        SELECT e.grantee AS grantee_oid,
               COALESCE(g.rolname, 'PUBLIC') AS grantee_name,
               array_agg(e.privilege_type ORDER BY e.privilege_type) AS privileges,
               array_agg(e.privilege_type ORDER BY e.privilege_type)
                 FILTER (WHERE e.is_grantable) AS grantable
        FROM aclexplode(d.defaclacl) e
        LEFT JOIN pg_roles g ON g.oid = e.grantee
        GROUP BY 1, 2
      ),
      def AS (
        SELECT x.grantee AS grantee_oid,
               array_agg(x.privilege_type ORDER BY x.privilege_type) AS privileges
        FROM aclexplode(acldefault(${defaclCode}, d.defaclrole)) x
        GROUP BY 1
      )
      -- present grantees whose privileges DEVIATE from the built-in default
      SELECT s.grantee_name, s.privileges, s.grantable, NULL::text[] AS revoked_default
      FROM stored s
      LEFT JOIN def dd ON dd.grantee_oid = s.grantee_oid
      WHERE s.privileges IS DISTINCT FROM dd.privileges
         OR s.grantable IS NOT NULL
      UNION ALL
      -- grantees that HAVE a built-in default but are ABSENT (revoked). The
      -- grantor's OWN self-entry is a special case: its absence is a behavioral
      -- no-op in two shapes (canonicalize by never emitting a marker), but a
      -- REAL revoke in a third (emit the marker):
      --   • PER-SCHEMA row (defaclnamespace <> 0): Postgres ALWAYS re-adds the
      --     owner's acldefault entry at object-creation time → no-op.
      --   • BARE GLOBAL row with an EMPTY stored acl (the owner-revoke is the
      --     only customization): the created table's relacl degenerates to NULL
      --     and the owner keeps its privileges → no-op.
      --   • GLOBAL row that still carries OTHER grantees: Postgres uses the
      --     stored acl VERBATIM at creation, so an object made by the owner
      --     really lacks the owner's own privileges → a genuine customization
      --     that must round-trip → emit the marker.
      SELECT CASE WHEN dd.grantee_oid = 0 THEN 'PUBLIC'
                  ELSE (SELECT rolname FROM pg_roles WHERE oid = dd.grantee_oid) END,
             ARRAY[]::text[], NULL::text[], dd.privileges
      FROM def dd
      WHERE NOT EXISTS (SELECT 1 FROM stored s WHERE s.grantee_oid = dd.grantee_oid)
        AND (
          -- a non-owner absentee is always a real revoke
          dd.grantee_oid <> d.defaclrole
          -- the owner's OWN absence is a real revoke ONLY on a GLOBAL row that
          -- still carries other grantees (per-schema → owner re-merged at CREATE;
          -- bare empty global row → owner keeps privileges — both no-ops)
          OR (d.defaclnamespace = 0 AND EXISTS (SELECT 1 FROM stored s2))
        )
    ) acl
    ORDER BY 1, 2, 3, 4`;

export const rolesAndGrantsFamily: CatalogFamily = {
  name: "roles",
  statements: () => [ROLES_SQL, MEMBERSHIPS_SQL, DEFAULT_PRIVILEGES_SQL],
  apply: (ctx, rowSets) => {
    const { facts } = ctx;

    for (const row of rowSets[0]!) {
      facts.push({
        id: { kind: "role", name: String(row["name"]) },
        payload: {
          superuser: Boolean(row["rolsuper"]),
          inherit: Boolean(row["rolinherit"]),
          createRole: Boolean(row["rolcreaterole"]),
          createDb: Boolean(row["rolcreatedb"]),
          login: Boolean(row["rolcanlogin"]),
          replication: Boolean(row["rolreplication"]),
          bypassRls: Boolean(row["rolbypassrls"]),
          config: (row["config"] as string[]).map(String),
        },
      });
    }

    for (const row of rowSets[1]!) {
      facts.push({
        id: {
          kind: "membership",
          role: String(row["role"]),
          member: String(row["member"]),
        },
        payload: { admin: Boolean(row["admin"]) },
      });
    }

    for (const row of rowSets[2]!) {
      const revokedDefault =
        (row["revoked_default"] as string[] | null) ?? null;
      facts.push({
        id: {
          kind: "defaultPrivilege",
          role: String(row["role"]),
          schema: row["schema"] == null ? null : (row["schema"] as string),
          objtype: String(row["objtype"]),
          grantee: String(row["grantee"]),
        },
        payload: {
          privileges: (row["privileges"] as string[]).map(String),
          grantable: ((row["grantable"] as string[] | null) ?? []).map(String),
          // non-semantic metadata (excluded from hash/diff): the built-in default
          // privileges this empty marker revoked, so the drop can restore them.
          ...(revokedDefault != null
            ? { _revokedDefault: revokedDefault.map(String) }
            : {}),
        },
      });
    }
  },
};
