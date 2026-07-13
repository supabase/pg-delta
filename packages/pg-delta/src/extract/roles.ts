/** Cluster-level role state: roles, role memberships, and default privileges. */
import type { ExtractContext } from "./scope.ts";

export async function extractRolesAndGrants(
  ctx: ExtractContext,
): Promise<void> {
  const { q, facts } = ctx;

  // ── roles (cluster-level) ────────────────────────────────────────────
  for (const row of await q(`
    SELECT r.rolname AS name, r.rolsuper, r.rolinherit, r.rolcreaterole,
           r.rolcreatedb, r.rolcanlogin, r.rolreplication, r.rolbypassrls,
           COALESCE((SELECT array_agg(cfg ORDER BY cfg)
                     FROM pg_db_role_setting s, unnest(s.setconfig) cfg
                     WHERE s.setrole = r.oid AND s.setdatabase = 0),
                    '{}')::text[] AS config
    FROM pg_roles r
    WHERE r.rolname NOT LIKE 'pg\\_%'
    ORDER BY r.rolname`)) {
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

  // ── role memberships (cluster-level; multi-grantor rows deduped) ─────
  for (const row of await q(`
    SELECT r1.rolname AS role, r2.rolname AS member,
           bool_or(m.admin_option) AS admin
    FROM pg_auth_members m
    JOIN pg_roles r1 ON r1.oid = m.roleid
    JOIN pg_roles r2 ON r2.oid = m.member
    WHERE r1.rolname NOT LIKE 'pg\\_%' AND r2.rolname NOT LIKE 'pg\\_%'
    GROUP BY 1, 2
    ORDER BY 1, 2`)) {
    facts.push({
      id: {
        kind: "membership",
        role: String(row["role"]),
        member: String(row["member"]),
      },
      payload: { admin: Boolean(row["admin"]) },
    });
  }

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
  //     EXCEPT when the absent grantee IS the grantor (its own defaclrole). A row
  //     built purely from grants to OTHER roles never materializes the grantor's
  //     self-entry (e.g. `{r2=r/r}`, no `r=…`), whereas an explicit `GRANT … TO
  //     <owner>` does (`{r=arwdDxtm/r,r2=r/r}`). These two rows are BEHAVIORALLY
  //     IDENTICAL: at object-creation time Postgres re-adds the owner's
  //     acldefault entry to the new object's ACL regardless of whether the stored
  //     default-ACL row carried a self-entry (verified: a table created by the
  //     owner gets `{owner=arwdDxtm/owner,…}` and `has_table_privilege(owner,…)`
  //     is true either way). So a "revoked" owner self-entry is a behavioral
  //     no-op, and emitting a marker for it would make owner-present-at-default
  //     and owner-absent rows extract DIFFERENTLY — breaking round-trip when a
  //     replayed DB (rebuilt from grants-to-others) drops the self-entry.
  //     Canonicalize by never emitting the grantor's own revoked-default marker.
  //     (A grantor self-entry that DIFFERS from acldefault — a partial
  //     self-reduction — is still present in the row and handled by the first
  //     branch above, so it is not lost.)
  // The built-in default is derived from acldefault() (kind/version-robust);
  // `defaclobjtype` uses 'S' for sequences where acldefault() wants 's'.
  const defaclCode = `CASE d.defaclobjtype WHEN 'S' THEN 's' ELSE d.defaclobjtype END`;
  for (const row of await q(`
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
      -- grantees that HAVE a built-in default but are ABSENT (revoked) — except
      -- the grantor's own self-entry, whose absence is a behavioral no-op
      -- (Postgres re-adds the owner's acldefault entry at object-creation time),
      -- so canonicalize by never emitting a marker for it.
      SELECT CASE WHEN dd.grantee_oid = 0 THEN 'PUBLIC'
                  ELSE (SELECT rolname FROM pg_roles WHERE oid = dd.grantee_oid) END,
             ARRAY[]::text[], NULL::text[], dd.privileges
      FROM def dd
      WHERE NOT EXISTS (SELECT 1 FROM stored s WHERE s.grantee_oid = dd.grantee_oid)
        AND dd.grantee_oid <> d.defaclrole
    ) acl
    ORDER BY 1, 2, 3, 4`)) {
    const revokedDefault = (row["revoked_default"] as string[] | null) ?? null;
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
}
