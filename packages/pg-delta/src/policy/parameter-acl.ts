/**
 * Platform `pg_parameter_acl` grants are cluster-wide (PG 15+) and are not
 * user schema. The supabase extract wrapper drops the exact bootstrap triples
 * from `unmodeled_kind`; any other grant stays a coverage gap.
 */
import type { Pool } from "pg";
import type { Diagnostic } from "../core/diagnostic.ts";
import { unmodeledKindDiagnostic } from "../extract/unmodeled.ts";

interface ParameterAclGrant {
  readonly name: string;
  readonly grantee: string;
  readonly privilege: string;
}

const PLATFORM_PARAMETER_ACLS = new Set([
  "log_min_messages\u0000supabase_admin\u0000ALTER SYSTEM",
  "log_min_messages\u0000supabase_admin\u0000SET",
  "log_min_messages\u0000supabase_realtime_admin\u0000SET",
]);

function grantKey(grant: ParameterAclGrant): string {
  return `${grant.name}\u0000${grant.grantee}\u0000${grant.privilege}`;
}

export function userOwnedParameterAclNames(
  grants: readonly ParameterAclGrant[],
): string[] {
  return [
    ...new Set(
      grants
        .filter((grant) => !PLATFORM_PARAMETER_ACLS.has(grantKey(grant)))
        .map((grant) => grant.name),
    ),
  ].sort();
}

function isParameterAclDiagnostic(diagnostic: Diagnostic): boolean {
  return (
    diagnostic.code === "unmodeled_kind" &&
    diagnostic.context?.["kind"] === "parameter ACL"
  );
}

/** Drop platform-only parameter ACL coverage; keep user-owned GUC names. */
export function filterPlatformParameterAclDiagnostics(
  diagnostics: readonly Diagnostic[],
  userOwnedNames: readonly string[],
): Diagnostic[] {
  const names = [...new Set(userOwnedNames)].sort();
  const out: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    if (!isParameterAclDiagnostic(diagnostic)) {
      out.push(diagnostic);
      continue;
    }
    if (names.length === 0) continue;
    out.push(unmodeledKindDiagnostic("parameter ACL", names.length, names));
  }
  return out;
}

async function fetchParameterAclGrants(
  pool: Pool,
): Promise<ParameterAclGrant[]> {
  try {
    const { rows } = await pool.query<ParameterAclGrant>(
      `SELECT DISTINCT pa.parname AS name,
              COALESCE(grantee.rolname, 'PUBLIC') AS grantee,
              acl.privilege_type AS privilege
         FROM pg_catalog.pg_parameter_acl pa
         CROSS JOIN LATERAL pg_catalog.aclexplode(pa.paracl) acl
         LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
        ORDER BY pa.parname, grantee, privilege`,
    );
    return rows;
  } catch (error) {
    // PG 14 has no pg_parameter_acl (undefined_table).
    if ((error as { code?: string }).code === "42P01") return [];
    throw error;
  }
}

export async function filterSupabasePlatformParameterAclDiagnostics(
  pool: Pool,
  diagnostics: readonly Diagnostic[],
): Promise<Diagnostic[]> {
  if (!diagnostics.some(isParameterAclDiagnostic)) return [...diagnostics];
  return filterPlatformParameterAclDiagnostics(
    diagnostics,
    userOwnedParameterAclNames(await fetchParameterAclGrants(pool)),
  );
}
