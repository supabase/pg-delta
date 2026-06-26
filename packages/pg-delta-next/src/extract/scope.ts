/**
 * Shared extraction scope (stage 2): the constants, SQL fragments, satellite
 * pruning, and the per-extraction mutable context that the per-family query
 * builders compose. Splitting the family builders into their own modules keeps
 * each catalog family local; this module is the one place the shared pieces
 * live (target-architecture §3.1–3.2).
 */
import type { PoolClient } from "pg";
import type { Diagnostic } from "../core/diagnostic.ts";
import type { DependencyEdge, Fact } from "../core/fact.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";

/** Postgres SQLSTATE for a statement cancelled by `statement_timeout`. */
const QUERY_CANCELED = "57014";

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
        'grantable', acl.grantable) ORDER BY acl.grantee_name)
     FROM (
       SELECT COALESCE(g.rolname, 'PUBLIC') AS grantee_name,
              array_agg(e.privilege_type ORDER BY e.privilege_type) AS privileges,
              array_agg(e.privilege_type ORDER BY e.privilege_type)
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
     ) acl)`;

export const parseAcl = (
  raw: unknown,
): { grantee: string; privileges: string[]; grantable: string[] }[] => {
  if (raw == null) return [];
  const entries = raw as {
    grantee: string;
    privileges: string[];
    grantable: string[] | null;
  }[];
  return entries.map((e) => ({
    grantee: e.grantee,
    privileges: e.privileges,
    grantable: e.grantable ?? [],
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
        payload: { privileges: acl.privileges, grantable: acl.grantable },
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
   *  a non-empty string. buildFactBase prunes dangling edges silently (e.g. a
   *  system-role owner not extracted) so out-of-view owners just get no edge. */
  const pushOwnerEdge = (id: StableId, owner: unknown): void => {
    if (typeof owner === "string" && owner.length > 0) {
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
    redactSecrets,
    pushWithMeta,
    pushMemberEdge,
    pushOwnerEdge,
    pushSeclabel,
  };
}
