/**
 * Shared extraction scope (stage 2): the constants, SQL fragments, satellite
 * pruning, and the per-extraction mutable context that the per-family query
 * builders compose. Splitting the family builders into their own modules keeps
 * each catalog family local; this module is the one place the shared pieces
 * live (target-architecture §3.1–3.2).
 * ACL identity/equality invariants: docs/architecture/identity-and-acl.md.
 */
import type { PoolClient } from "pg";
import type { Diagnostic } from "../core/diagnostic.ts";
import type { DependencyEdge, Fact } from "../core/fact.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";

/** Postgres SQLSTATE for a statement cancelled by `statement_timeout`. */
const QUERY_CANCELED = "57014";

/**
 * Whether a role name is a built-in (reserved) Postgres role. These `pg_`-prefixed
 * roles (`pg_database_owner`, `pg_read_all_data`, …) are never extracted as
 * managed facts — role extraction filters them out with `rolname NOT LIKE 'pg\_%'`
 * (see extractRolesAndGrants in ./roles.ts). This predicate is the TS mirror of
 * that SQL filter, used to suppress owner edges pointing at a built-in role: such
 * an edge would always be dangling (its target role fact is never emitted) and is
 * pruned by buildFactBase anyway, so emitting it only produces spurious
 * `dangling_edge` warnings.
 */
function isBuiltinRoleName(name: string): boolean {
  return name.startsWith("pg_");
}

/**
 * A short, human-readable identifier for an extraction query: its first FROM
 * relation plus a head of the text. Used to name the query that blew the
 * statement-timeout budget so the failure is actionable, not opaque.
 */
function queryLabel(sql: string): string {
  const flat = sql.replace(/\s+/g, " ").trim();
  const from = /\bFROM\s+(?:pg_catalog\.)?(\w+)/i.exec(flat);
  const head = flat.slice(0, 60);
  return from ? `${from[1]} (${head}…)` : head;
}

/**
 * Thrown when an extraction query exceeds the caller-supplied
 * `statementTimeoutMs` budget. Turns a runaway catalog query on a pathological
 * schema into actionable output — it names the offending query and the budget —
 * instead of an opaque `canceling statement due to statement timeout` or an
 * indefinite hang (milestone A — performance).
 */
export class ExtractionTimeoutError extends Error {
  readonly code = "extraction_timeout";
  readonly queryLabel: string;
  readonly timeoutMs: number;
  readonly diagnostic: Diagnostic;
  constructor(label: string, timeoutMs: number) {
    super(
      `extraction query ${label} exceeded the ${timeoutMs}ms statement_timeout budget`,
    );
    this.name = "ExtractionTimeoutError";
    this.queryLabel = label;
    this.timeoutMs = timeoutMs;
    this.diagnostic = {
      code: this.code,
      severity: "error",
      message: this.message,
      context: { queryLabel: label, timeoutMs },
    };
  }
}

/**
 * Consistency invariant (hardening Item 4a; review #1): a metadata satellite
 * (comment / acl / securityLabel) must never outlive its target. Most are
 * pushed via `pushWithMeta` alongside their object, so a filtered object never
 * emits them — but standalone satellite extraction (security labels) can emit
 * one whose target was filtered (e.g. an extension-member object). Such a
 * satellite would make `buildFactBase` throw on a missing parent, or — if it
 * survived — yield an orphan GRANT/COMMENT at plan time (CLI-1471). Drop them
 * here with an `info` diagnostic so the exclusion is visible, never silent.
 */
export function pruneOrphanedSatellites(facts: Fact[]): {
  facts: Fact[];
  diagnostics: Diagnostic[];
} {
  const present = new Set(facts.map((f) => encodeId(f.id)));
  const kept: Fact[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const fact of facts) {
    if ("target" in fact.id) {
      const targetKey = encodeId(fact.id.target);
      if (!present.has(targetKey)) {
        diagnostics.push({
          code: "orphaned_satellite",
          severity: "info",
          subject: fact.id,
          message: `dropped ${fact.id.kind} whose target ${targetKey} was not extracted (filtered)`,
        });
        continue;
      }
    }
    kept.push(fact);
  }
  return { facts: kept, diagnostics };
}

/** Schemas never treated as user state. */
export const SYSTEM_SCHEMAS = `('pg_catalog', 'information_schema')`;
export const USER_SCHEMA_FILTER = `
  n.nspname NOT IN ${SYSTEM_SCHEMAS}
  AND n.nspname NOT LIKE 'pg\\_toast%'
  AND n.nspname NOT LIKE 'pg\\_temp%'`;

/** Anti-join fragment: exclude objects owned by extensions, for the sub-entity
 *  and rare member-root families that are NOT yet flipped to `memberOfExtension`
 *  provenance edges (the flipped families use memberExtensionExpr/pushMemberEdge
 *  instead; see COVERAGE.md "extension member handling" + tier-4-deferrals.md). */
export function notExtensionMember(classid: string, oidExpr: string): string {
  return `NOT EXISTS (
    SELECT 1 FROM pg_depend ext_d
    WHERE ext_d.classid = '${classid}'::regclass
      AND ext_d.objid = ${oidExpr}
      AND ext_d.deptype = 'e')`;
}

export interface Row {
  [key: string]: unknown;
}

/** Provenance flip (4b): a scalar subquery selecting the name of the
 *  extension that OWNS this object (pg_depend deptype 'e'), or NULL. plpgsql
 *  is excluded to match the extensions extractor, which omits it — an edge to
 *  it would dangle. A flipped family SELECTs this AS ext_member_of and the
 *  loop calls pushMemberEdge so the member is observed AND tagged, instead of
 *  anti-joined away with notExtensionMember. */
export const memberExtensionExpr = (classid: string, oidExpr: string): string =>
  `(
    SELECT ext.extname
    FROM pg_depend ext_d
    JOIN pg_extension ext ON ext.oid = ext_d.refobjid
    WHERE ext_d.classid = '${classid}'::regclass
      AND ext_d.objid = ${oidExpr}
      AND ext_d.refclassid = 'pg_extension'::regclass
      AND ext_d.deptype = 'e'
      AND ext.extname <> 'plpgsql'
    LIMIT 1)`;

/** ACL subquery: aggregated per grantee, sorted, PUBLIC for grantee 0.
 *  A NULL acl column means "the built-in default" — coalescing through
 *  acldefault() (pg_dump's model) makes NULL and an explicitly
 *  instantiated default extract identically, so a REVOKE that merely
 *  materializes the owner's implicit grant is not a diff.
 *
 *  Revoked PUBLIC default: PostgreSQL grants the built-in default (USAGE on
 *  types/languages, EXECUTE on functions) to PUBLIC automatically on CREATE.
 *  When the acl is customized (non-NULL) and that PUBLIC default has been taken
 *  away (no PUBLIC row), we still emit an empty PUBLIC entry so the diff plans a
 *  `REVOKE ALL … FROM PUBLIC` that clears the create-time default. Without it a
 *  freshly created object would keep the default and never converge. The
 *  "kind has a PUBLIC default" test is derived from acldefault() itself, so it
 *  stays correct across object kinds and PG versions. */
export const aclJson = (
  aclColumn: string,
  objtype: string,
  ownerColumn: string,
) => `
    (SELECT json_agg(json_build_object(
        'grantee', acl.grantee_name,
        'privileges', acl.privileges,
        'grantable', acl.grantable,
        -- The owner's create-time default privilege set for this object kind
        -- (carried ONLY on the owner's row). Lets the planner's default-ACL
        -- elision tell "owner kept the full default" (elidable) apart from
        -- "owner revoked one of their defaults" (must keep the REVOKE/GRANT),
        -- without hardcoding the version-dependent set (PG17 added MAINTAIN).
        'ownerDefault', CASE
          WHEN acl.grantee_name = (
            SELECT rolname FROM pg_roles WHERE oid = ${ownerColumn})
          THEN (SELECT array_agg(d.privilege_type ORDER BY d.privilege_type)
                FROM aclexplode(acldefault('${objtype}', ${ownerColumn})) d
                WHERE d.grantee = ${ownerColumn})
          ELSE NULL END) ORDER BY acl.grantee_name)
     FROM (
       SELECT COALESCE(g.rolname, 'PUBLIC') AS grantee_name,
              -- DISTINCT: aclexplode() yields one row per GRANTOR, so a privilege
              -- granted to one grantee by two grantors appears twice. pg-delta
              -- models the EFFECTIVE privilege set, not who granted it, so grantor
              -- identity is intentionally ignored — de-duplicate to avoid rendering
              -- a doubled privilege list (GRANT SELECT, SELECT ...), which
              -- Postgres collapses on apply so a re-extract no longer matches and
              -- the proof drifts.
              array_agg(DISTINCT e.privilege_type ORDER BY e.privilege_type) AS privileges,
              array_agg(DISTINCT e.privilege_type ORDER BY e.privilege_type)
                FILTER (WHERE e.is_grantable) AS grantable
       FROM aclexplode(COALESCE(${aclColumn}, acldefault('${objtype}', ${ownerColumn}))) e
       LEFT JOIN pg_roles g ON g.oid = e.grantee
       GROUP BY 1
       UNION ALL
       SELECT 'PUBLIC', ARRAY[]::text[], NULL::text[]
       WHERE ${aclColumn} IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM aclexplode(acldefault('${objtype}', ${ownerColumn})) d
           WHERE d.grantee = 0)
         AND NOT EXISTS (
           SELECT 1 FROM aclexplode(${aclColumn}) a WHERE a.grantee = 0)
       UNION ALL
       -- Revoked OWNER default (mirror of the PUBLIC case): PostgreSQL grants the
       -- owner its full default on CREATE, so a full owner revoke
       -- (REVOKE ALL ON ... FROM owner) leaves a non-NULL acl with NO owner row.
       -- Emit an empty owner entry so the diff plans a REVOKE ALL FROM owner that
       -- clears the create-time default; without it a freshly created object keeps
       -- PostgreSQL built-in owner privileges and never converges.
       SELECT (SELECT rolname FROM pg_roles WHERE oid = ${ownerColumn}),
              ARRAY[]::text[], NULL::text[]
       WHERE ${aclColumn} IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM aclexplode(acldefault('${objtype}', ${ownerColumn})) d
           WHERE d.grantee = ${ownerColumn})
         AND NOT EXISTS (
           SELECT 1 FROM aclexplode(${aclColumn}) a
           WHERE a.grantee = ${ownerColumn})
     ) acl)`;

/**
 * ACL delta for an EXTENSION MEMBER, pg_dump's `pg_init_privs` model: emit only
 * the grantees whose CURRENT privilege/grant-option set differs from the object's
 * as-installed set (`pg_init_privs.initprivs`, or `acldefault` when the extension
 * recorded no init row — a default-acl member). CREATE EXTENSION re-establishes
 * the init state, so a member that was never customized yields NO acl facts (no
 * churn on plain extensions); a customization layered afterward surfaces as its
 * delta grantees. Three shapes, via a FULL OUTER JOIN of current vs init:
 *   - added / upgraded grantee (in cur, differs from ini) → current privileges,
 *     `_initPrivs` = the install entry (null if the grantee had none at install);
 *   - fully-REVOKED init grantee (in ini, absent from cur, e.g. Supabase's
 *     `REVOKE EXECUTE … FROM PUBLIC` hardening) → an empty-privileges marker so
 *     the create renders a lone `REVOKE ALL` (grantActions);
 *   - grant-option-only change (same privileges, different grantable) → included.
 *
 * Same JSON shape as `aclJson` (+ non-semantic `_initPrivs`) so `parseAcl` reads
 * both. It omits `_ownerDefault` — a member delta carries only non-default
 * entries, so there is nothing for default-ACL elision to reconcile. `_initPrivs`
 * lets the DROP path RESTORE the install state instead of a blind `REVOKE ALL`
 * (see the `acl` rule in plan/rules/metadata.ts).
 */
const memberAclDeltaJson = (
  aclColumn: string,
  objtype: string,
  ownerColumn: string,
  classoid: string,
  oidExpr: string,
) => `
    (SELECT json_agg(json_build_object(
        'grantee', d.grantee, 'privileges', d.privileges,
        'grantable', d.grantable, '_initPrivs', d.init_privs
      ) ORDER BY d.grantee)
     FROM (
       WITH cur AS (
         SELECT COALESCE(g.rolname, 'PUBLIC') AS grantee,
                -- DISTINCT across grantors (aclexplode emits one row per grantor);
                -- grantor identity is intentionally ignored — see aclJson.
                array_agg(DISTINCT e.privilege_type ORDER BY e.privilege_type) AS privileges,
                COALESCE(array_agg(DISTINCT e.privilege_type ORDER BY e.privilege_type)
                  FILTER (WHERE e.is_grantable), ARRAY[]::text[]) AS grantable
         FROM aclexplode(COALESCE(${aclColumn}, acldefault('${objtype}', ${ownerColumn}))) e
         LEFT JOIN pg_roles g ON g.oid = e.grantee
         GROUP BY 1
       ),
       ini AS (
         SELECT COALESCE(g.rolname, 'PUBLIC') AS grantee,
                -- DISTINCT across grantors (aclexplode emits one row per grantor);
                -- grantor identity is intentionally ignored — see aclJson.
                array_agg(DISTINCT e.privilege_type ORDER BY e.privilege_type) AS privileges,
                COALESCE(array_agg(DISTINCT e.privilege_type ORDER BY e.privilege_type)
                  FILTER (WHERE e.is_grantable), ARRAY[]::text[]) AS grantable
         FROM aclexplode(COALESCE(
                (SELECT ip.initprivs FROM pg_init_privs ip
                 WHERE ip.objoid = ${oidExpr}
                   AND ip.classoid = '${classoid}'::regclass
                   AND ip.objsubid = 0),
                acldefault('${objtype}', ${ownerColumn}))) e
         LEFT JOIN pg_roles g ON g.oid = e.grantee
         GROUP BY 1
       )
       SELECT
         COALESCE(cur.grantee, ini.grantee) AS grantee,
         COALESCE(cur.privileges, ARRAY[]::text[]) AS privileges,
         COALESCE(cur.grantable, ARRAY[]::text[]) AS grantable,
         CASE WHEN ini.grantee IS NOT NULL
              THEN json_build_object(
                     'privileges', ini.privileges, 'grantable', ini.grantable)
              END AS init_privs
       FROM cur FULL OUTER JOIN ini USING (grantee)
       WHERE cur.privileges IS DISTINCT FROM ini.privileges
          OR cur.grantable IS DISTINCT FROM ini.grantable
     ) d)`;

/**
 * Member-aware ACL: an extension member (pg_depend deptype 'e') uses the
 * init-privs delta (`memberAclDeltaJson`); everything else uses the full
 * `aclJson`. The member OBJECT is projected reference-only in the view (never a
 * create/drop/alter), so only these satellite customizations flow to the diff.
 */
export const aclJsonMemberAware = (
  aclColumn: string,
  objtype: string,
  ownerColumn: string,
  classoid: string,
  oidExpr: string,
) => `
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_depend md
      WHERE md.classid = '${classoid}'::regclass AND md.objid = ${oidExpr}
        AND md.refclassid = 'pg_extension'::regclass AND md.deptype = 'e')
    THEN ${memberAclDeltaJson(aclColumn, objtype, ownerColumn, classoid, oidExpr)}
    ELSE ${aclJson(aclColumn, objtype, ownerColumn)}
    END`;

/** The as-installed ACL entry for an extension member (from pg_init_privs /
 *  acldefault), carried non-semantically so the DROP path can restore it. */
export interface InitPrivs {
  privileges: string[];
  grantable: string[];
}

export const parseAcl = (
  raw: unknown,
): {
  grantee: string;
  privileges: string[];
  grantable: string[];
  ownerDefault?: string[];
  initPrivs?: InitPrivs;
}[] => {
  if (raw == null) return [];
  const entries = raw as {
    grantee: string;
    privileges: string[];
    grantable: string[] | null;
    ownerDefault: string[] | null;
    _initPrivs: { privileges: string[]; grantable: string[] | null } | null;
  }[];
  return entries.map((e) => ({
    grantee: e.grantee,
    privileges: e.privileges,
    grantable: e.grantable ?? [],
    ...(e.ownerDefault != null ? { ownerDefault: e.ownerDefault } : {}),
    ...(e._initPrivs != null
      ? {
          initPrivs: {
            privileges: e._initPrivs.privileges,
            grantable: e._initPrivs.grantable ?? [],
          },
        }
      : {}),
  }));
};

export const schemaId = (name: unknown): StableId => ({
  kind: "schema",
  name: String(name),
});

/** The per-extraction mutable context: the accumulating fact / edge /
 *  diagnostic buffers, the timeout-aware query runner, and the satellite /
 *  provenance / owner push helpers that close over the buffers. The per-family
 *  query builders receive this and push into it; the order in which the
 *  orchestrator (`extractOnClient`) calls them is what defines the resulting
 *  fact / edge ordering. */
export interface ExtractContext {
  q: (sql: string) => Promise<Row[]>;
  facts: Fact[];
  edges: DependencyEdge[];
  diagnostics: Diagnostic[];
  /** Diagnostics that must ALSO ride on the resulting `FactBase` (not just
   *  `ExtractResult.diagnostics`), because `plan()` reads `FactBase.diagnostics`
   *  to gate against a delta it cannot trust (mirrors how extension-handler
   *  diagnostics are threaded — see extract.ts). Push here instead of
   *  `diagnostics` when a downstream `plan()` gate needs to see it; the
   *  orchestrator copies this onto `factBase.diagnostics` right after
   *  construction, which the final step then folds into `diagnostics` too, so
   *  every consumer still sees it exactly once. */
  factDiagnostics: Diagnostic[];
  /** When false, sensitive option values and subscription conninfo are kept in
   *  cleartext in the fact base (and therefore in every downstream channel).
   *  Default true; see sensitive-options.ts and extract.ts. */
  redactSecrets: boolean;
  pushWithMeta: (
    fact: Fact,
    row: Row,
    aclTargets?: {
      privileges: string[];
      grantable: string[];
      grantee: string;
      ownerDefault?: string[];
      initPrivs?: InitPrivs;
    }[],
  ) => void;
  pushMemberEdge: (id: StableId, row: Row) => void;
  pushOwnerEdge: (id: StableId, owner: unknown) => void;
  pushSeclabel: (target: StableId, provider: string, label: string) => void;
}

export function createExtractContext(
  client: PoolClient,
  statementTimeoutMs?: number,
  redactSecrets = true,
): ExtractContext {
  const facts: Fact[] = [];
  const edges: DependencyEdge[] = [];
  const diagnostics: Diagnostic[] = [];
  const factDiagnostics: Diagnostic[] = [];

  const q = async (sql: string): Promise<Row[]> => {
    try {
      return (await client.query(sql)).rows as Row[];
    } catch (error) {
      if (
        statementTimeoutMs !== undefined &&
        (error as { code?: string }).code === QUERY_CANCELED
      ) {
        throw new ExtractionTimeoutError(queryLabel(sql), statementTimeoutMs);
      }
      throw error;
    }
  };

  /** Helper: push a fact plus its optional comment/acl satellite facts. */
  const pushWithMeta = (
    fact: Fact,
    row: Row,
    aclTargets?: {
      privileges: string[];
      grantable: string[];
      grantee: string;
      ownerDefault?: string[];
      initPrivs?: InitPrivs;
    }[],
  ): void => {
    facts.push(fact);
    const comment = row["comment"];
    if (typeof comment === "string") {
      // a constraint on a DOMAIN needs `COMMENT ON CONSTRAINT … ON DOMAIN …`,
      // not the table form — but commentTarget only sees the (identically
      // shaped) constraint id and `drop` has no FactView to look up the parent.
      // Carry the discriminator on the satellite payload so every comment
      // callback (create / alter / drop) renders the right target.
      const onDomain =
        fact.id.kind === "constraint" && fact.parent?.kind === "domain";
      facts.push({
        id: { kind: "comment", target: fact.id },
        parent: fact.id,
        payload: onDomain
          ? { text: comment, onDomain: true }
          : { text: comment },
      });
    }
    for (const acl of aclTargets ?? []) {
      facts.push({
        id: { kind: "acl", target: fact.id, grantee: acl.grantee },
        parent: fact.id,
        payload: {
          privileges: acl.privileges,
          grantable: acl.grantable,
          // owner-only NON-SEMANTIC metadata (`_` prefix → excluded from the
          // hash/diff, see hash.ts): the owner's create-time default privilege
          // set, consumed by the planner's default-ACL elision
          // (elideDefaultAclCreates). It is version-dependent (PG17 added
          // MAINTAIN), so it must NOT join the equality surface or it would cause
          // spurious cross-version / snapshot diff deltas and fingerprint drift.
          ...(acl.ownerDefault !== undefined
            ? { _ownerDefault: acl.ownerDefault }
            : {}),
          // as-installed ACL for an extension member (non-semantic `_` prefix):
          // lets the DROP path restore install state instead of REVOKE ALL.
          // Built as a fresh literal so it satisfies the Payload index signature.
          ...(acl.initPrivs !== undefined
            ? {
                _initPrivs: {
                  privileges: acl.initPrivs.privileges,
                  grantable: acl.initPrivs.grantable,
                },
              }
            : {}),
        },
      });
    }
  };

  /** Emit a `memberOfExtension` edge from `id` to its owning extension when the
   *  row's `ext_member_of` column (from memberExtensionExpr) is set. The edge's
   *  `from` is the exact fact id, so it can never drift from the fact. */
  const pushMemberEdge = (id: StableId, row: Row): void => {
    const ext = row["ext_member_of"];
    if (typeof ext === "string") {
      edges.push({
        from: id,
        to: { kind: "extension", name: ext },
        kind: "memberOfExtension",
      });
    }
  };

  /** Emit an `owner` edge from `id` to its owning role when the owner value is
   *  a non-empty, non-built-in role. buildFactBase prunes dangling edges silently
   *  (e.g. a system-role owner not extracted) so out-of-view owners just get no
   *  edge — but a built-in (`pg_`-prefixed) owner such as `pg_database_owner` is
   *  NEVER extracted as a role fact, so its edge is always dangling; skipping it
   *  here avoids the recurring `dangling_edge` warning without changing the fact
   *  base (the edge would be pruned regardless). */
  const pushOwnerEdge = (id: StableId, owner: unknown): void => {
    if (
      typeof owner === "string" &&
      owner.length > 0 &&
      !isBuiltinRoleName(owner)
    ) {
      edges.push({
        from: id,
        to: { kind: "role", name: owner },
        kind: "owner",
      });
    }
  };

  const pushSeclabel = (
    target: StableId,
    provider: string,
    label: string,
  ): void => {
    facts.push({
      id: { kind: "securityLabel", target, provider },
      parent: target,
      payload: { label },
    });
  };

  return {
    q,
    facts,
    edges,
    diagnostics,
    factDiagnostics,
    redactSecrets,
    pushWithMeta,
    pushMemberEdge,
    pushOwnerEdge,
    pushSeclabel,
  };
}
