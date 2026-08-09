/**
 * Applier capability (docs/architecture/managed-view-architecture.md move 6).
 *
 * The managed view is a function of (facts, policy, applier capability): an
 * operation the applier cannot execute is projected out of the view, never
 * silently emitted to fail at apply time. Capability is a property of WHO
 * applies, not of the objects — so it is not derivable from the catalog; it is
 * probed from the applier connection and threaded into plan()/prove() as an
 * option. Absent, the view is unrestricted (the default — superuser/CI path).
 *
 * v1 restriction: FDW ACLs. `GRANT`/`REVOKE ON FOREIGN DATA WRAPPER` requires
 * superuser, so a non-superuser applier cannot replay them. This derives, for
 * ANY non-superuser, the exclusion the Supabase policy hard-codes as Rule 9 —
 * additively (Rule 9 stays until the derivation is proven at parity).
 */
import type { Pool } from "pg";
import type { FactBase } from "../core/fact.ts";
import { encodeId } from "../core/stable-id.ts";

export interface ApplierCapability {
  /** the role the migration is applied as (current_user) */
  role: string;
  /** superuser bypasses most permission checks (incl. FDW GRANT/REVOKE) */
  isSuperuser: boolean;
  /** roles the applier is a member of (can SET ROLE / own objects as). A plain
   *  array (not a Set) so the capability persists losslessly in the Plan
   *  artifact's JSON (follow-up 2 productization). */
  memberOf: readonly string[];
}

/** Probe the applier's capability from a live connection. */
export async function probeApplierCapability(
  pool: Pool,
): Promise<ApplierCapability> {
  const res = await pool.query(`
    SELECT current_user AS role,
           (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) AS is_superuser,
           ARRAY(
             SELECT r.rolname::text FROM pg_catalog.pg_roles r
             WHERE pg_catalog.pg_has_role(current_user, r.oid, 'MEMBER')
               AND r.rolname NOT LIKE 'pg\\_%'
           ) AS member_of
  `);
  const row = res.rows[0] as {
    role: string;
    is_superuser: boolean;
    member_of: string[] | null;
  };
  return {
    role: String(row.role),
    isSuperuser: Boolean(row.is_superuser),
    memberOf: row.member_of ?? [],
  };
}

/**
 * Fact-id keys to project out for a given capability — the facts whose
 * corresponding action the applier cannot execute. A superuser is unrestricted.
 * Currently: FDW ACL facts (GRANT/REVOKE on a FOREIGN DATA WRAPPER is
 * superuser-only).
 */
export function capabilityExcludedRoots(
  fb: FactBase,
  cap: ApplierCapability,
): Set<string> {
  const roots = new Set<string>();
  if (cap.isSuperuser) return roots;
  for (const fact of fb.facts()) {
    if (fact.id.kind === "acl" && fact.id.target.kind === "fdw") {
      roots.add(encodeId(fact.id));
    }
  }
  return roots;
}

/**
 * Whether the applier can run `ALTER <obj> OWNER TO roleName` — PostgreSQL
 * requires the applier to be a superuser or a member of the target role (the
 * owner residue, move 6 / follow-up 1).
 *
 * Unlike an FDW ACL (a leaf fact that projects out cleanly), an owner cannot be
 * silently skipped: leaving an object applier-owned ripples into its
 * acldefault-normalized ACL (which is owner-relative), so the state can't
 * converge. So an owner action the applier can't run is a FAIL-FAST at plan
 * time (the planner throws a clear, actionable error) rather than a silent
 * projection — surfaced before any statement is applied.
 */
export function canSetOwner(cap: ApplierCapability, roleName: string): boolean {
  return cap.isSuperuser || cap.memberOf.includes(roleName);
}
