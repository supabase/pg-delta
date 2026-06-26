/**
 * Shared helpers for the rule table (target-architecture §3.4). These are the
 * rendering / metadata utilities the per-kind rule families compose. Types are
 * imported type-only from `../rules.ts` so this module never forms a runtime
 * import cycle with the registry that re-exports it.
 */
import type { Fact } from "../../core/fact.ts";
import type { PayloadValue } from "../../core/hash.ts";
import { encodeId, type StableId } from "../../core/stable-id.ts";
import { grantTarget, qid, rel, splitOption } from "../render.ts";
import type { ActionSpec, FactView } from "../rules.ts";

/** Most renames are `<ALTER prefix> RENAME TO <new name>`. */
export function renameRule(
  alterPrefix: (fact: Fact) => string,
): (fact: Fact, to: StableId) => ActionSpec {
  return (fact, to) => ({
    sql: `${alterPrefix(fact)} RENAME TO ${qid((to as { name: string }).name)}`,
  });
}

export const str = (v: PayloadValue): string => {
  if (v === null || v === undefined || typeof v === "object") {
    throw new Error(
      `rule rendering: expected a scalar, got ${JSON.stringify(v)}`,
    );
  }
  return String(v);
};

export function p(fact: Fact, key: string): PayloadValue {
  return fact.payload[key];
}

/** ` WITH (k=v, …)` clause from a fact's `reloptions` payload (the canonical
 *  sorted `key=value` array captured from pg_class.reloptions), or "" when the
 *  relation carries no storage/view options. */
export function reloptionsWithClause(fact: Fact): string {
  const opts = p(fact, "reloptions") as string[] | null;
  return opts != null && opts.length > 0 ? ` WITH (${opts.join(", ")})` : "";
}

/** `<prefix> SET (…)` / `<prefix> RESET (…)` specs for a reloptions transition.
 *  Emits SET for keys whose value was added or changed and RESET for keys that
 *  disappeared — the in-place form for both views (security_invoker, …) and
 *  tables (fillfactor, autovacuum_*, …) so an options-only change is no longer
 *  invisible (it used to hash identically and plan nothing). */
export function reloptionsAlterSpecs(
  alterPrefix: string,
  from: PayloadValue,
  to: PayloadValue,
): ActionSpec[] {
  const fromMap = new Map((from as string[] | null)?.map(splitOption) ?? []);
  const toMap = new Map((to as string[] | null)?.map(splitOption) ?? []);
  const setParts: string[] = [];
  for (const [key, value] of toMap) {
    if (fromMap.get(key) !== value) setParts.push(`${key}=${value}`);
  }
  const resetKeys: string[] = [];
  for (const key of fromMap.keys()) {
    if (!toMap.has(key)) resetKeys.push(key);
  }
  const specs: ActionSpec[] = [];
  if (setParts.length > 0) {
    specs.push({ sql: `${alterPrefix} SET (${setParts.join(", ")})` });
  }
  if (resetKeys.length > 0) {
    specs.push({ sql: `${alterPrefix} RESET (${resetKeys.join(", ")})` });
  }
  return specs;
}

/** true when `partial` appears in `full` in order (possibly with gaps) */
export function isSubsequence(partial: string[], full: string[]): boolean {
  let i = 0;
  for (const value of full) {
    if (i < partial.length && value === partial[i]) i++;
  }
  return i === partial.length;
}

/** Role attribute keyword map (CREATE ROLE / ALTER ROLE flags). */
export const ROLE_FLAGS: Record<string, [on: string, off: string]> = {
  superuser: ["SUPERUSER", "NOSUPERUSER"],
  inherit: ["INHERIT", "NOINHERIT"],
  createRole: ["CREATEROLE", "NOCREATEROLE"],
  createDb: ["CREATEDB", "NOCREATEDB"],
  login: ["LOGIN", "NOLOGIN"],
  replication: ["REPLICATION", "NOREPLICATION"],
  bypassRls: ["BYPASSRLS", "NOBYPASSRLS"],
};

export function roleFlagSql(payload: Fact["payload"]): string {
  return Object.entries(ROLE_FLAGS)
    .map(([key, [on, off]]) => (payload[key] ? on : off))
    .join(" ");
}

/** A backing identity sequence's parameters (mirrors the sequence payload,
 *  minus dataType — that is fixed by the column type). */
export interface IdentityOptions {
  increment: string;
  start: string;
  minValue: string;
  maxValue: string;
  cache: string;
  cycle: boolean;
}

/** Identity payload:
 *  { generation: 'a'|'d', sequence: {schema,name}, options: IdentityOptions } | null.
 *  The backing sequence rides along so identity transitions can declare the
 *  physical sequence they implicitly create/destroy; its options ride along so
 *  a non-default START/INCREMENT/MIN/MAX/CACHE/CYCLE is reproduced. */
interface IdentityPayload {
  generation: string;
  sequence: { schema: string; name: string } | null;
  options?: IdentityOptions | null;
}

export function identityGeneration(value: PayloadValue): string | null {
  if (value == null) return null;
  return (value as unknown as IdentityPayload).generation;
}

export function identitySequenceId(value: PayloadValue): StableId | null {
  if (value == null) return null;
  const sequence = (value as unknown as IdentityPayload).sequence;
  if (sequence == null) return null;
  return { kind: "sequence", schema: sequence.schema, name: sequence.name };
}

export function identityOptions(value: PayloadValue): IdentityOptions | null {
  if (value == null) return null;
  return (value as unknown as IdentityPayload).options ?? null;
}

/** Type-derived max for the implicit identity sequence; null for a type we
 *  don't recognise (then any captured options are treated as non-default and
 *  rendered explicitly, which is always safe). */
const IDENTITY_TYPE_MAX: Record<string, string> = {
  smallint: "32767",
  integer: "2147483647",
  bigint: "9223372036854775807",
};

/** true when the identity sequence carries exactly the parameters PostgreSQL
 *  picks for a bare `GENERATED … AS IDENTITY` of the given column type, so the
 *  clause can stay bare (no churn for ordinary identity columns). */
export function isDefaultIdentityOptions(
  options: IdentityOptions,
  columnType: string,
): boolean {
  return (
    options.increment === "1" &&
    options.start === "1" &&
    options.minValue === "1" &&
    options.cache === "1" &&
    options.cycle === false &&
    options.maxValue === IDENTITY_TYPE_MAX[columnType]
  );
}

/** ` (INCREMENT BY … MINVALUE … …)` for a non-default identity sequence, or ""
 *  when the parameters are the type defaults. */
export function identityOptionsClause(
  options: IdentityOptions | null,
  columnType: string,
): string {
  if (options == null || isDefaultIdentityOptions(options, columnType))
    return "";
  const parts = [
    `INCREMENT BY ${options.increment}`,
    `MINVALUE ${options.minValue}`,
    `MAXVALUE ${options.maxValue}`,
    `START WITH ${options.start}`,
    `CACHE ${options.cache}`,
    options.cycle ? "CYCLE" : "NO CYCLE",
  ];
  return ` (${parts.join(" ")})`;
}

/** in-place `ALTER COLUMN … SET <seq option>` specs for an identity sequence
 *  parameter transition (no rebuild). */
export function identityOptionAlterSpecs(
  target: string,
  from: IdentityOptions | null,
  to: IdentityOptions | null,
): ActionSpec[] {
  if (to == null) return [];
  const specs: ActionSpec[] = [];
  if (from == null || from.increment !== to.increment)
    specs.push({ sql: `${target} SET INCREMENT BY ${to.increment}` });
  if (from == null || from.minValue !== to.minValue)
    specs.push({ sql: `${target} SET MINVALUE ${to.minValue}` });
  if (from == null || from.maxValue !== to.maxValue)
    specs.push({ sql: `${target} SET MAXVALUE ${to.maxValue}` });
  if (from == null || from.start !== to.start)
    specs.push({ sql: `${target} SET START WITH ${to.start}` });
  if (from == null || from.cache !== to.cache)
    specs.push({ sql: `${target} SET CACHE ${to.cache}` });
  if (from == null || from.cycle !== to.cycle)
    specs.push({ sql: `${target} SET ${to.cycle ? "CYCLE" : "NO CYCLE"}` });
  return specs;
}

export function columnRef(fact: Fact): {
  table: string;
  schema: string;
  column: string;
} {
  const id = fact.id as { schema: string; table: string; name: string };
  return { schema: id.schema, table: id.table, column: id.name };
}

export function columnClause(fact: Fact): string {
  const { column } = columnRef(fact);
  const type = str(p(fact, "type"));
  let sql = `${qid(column)} ${type}`;
  const collation = p(fact, "collation");
  if (collation != null) sql += ` COLLATE ${str(collation)}`;
  const generated = p(fact, "generatedExpr");
  if (generated != null)
    sql += ` GENERATED ALWAYS AS (${str(generated)}) STORED`;
  const identity = p(fact, "identity");
  const generation = identityGeneration(identity);
  if (generation === "a" || generation === "d") {
    sql += ` GENERATED ${generation === "a" ? "ALWAYS" : "BY DEFAULT"} AS IDENTITY`;
    sql += identityOptionsClause(identityOptions(identity), type);
  }
  if (p(fact, "notNull")) sql += ` NOT NULL`;
  return sql;
}

const POLICY_CMD: Record<string, string> = {
  r: "SELECT",
  a: "INSERT",
  w: "UPDATE",
  d: "DELETE",
  "*": "ALL",
};

export function policySql(fact: Fact): string {
  const id = fact.id as { schema: string; table: string; name: string };
  const roles = (p(fact, "roles") as string[]).map((r) =>
    r === "PUBLIC" ? "PUBLIC" : qid(r),
  );
  let sql = `CREATE POLICY ${qid(id.name)} ON ${rel(id.schema, id.table)}`;
  if (!p(fact, "permissive")) sql += ` AS RESTRICTIVE`;
  sql += ` FOR ${POLICY_CMD[str(p(fact, "cmd"))] ?? "ALL"}`;
  sql += ` TO ${roles.join(", ")}`;
  const using = p(fact, "usingExpr");
  if (using != null) sql += ` USING (${str(using)})`;
  const check = p(fact, "checkExpr");
  if (check != null) sql += ` WITH CHECK (${str(check)})`;
  return sql;
}

/**
 * OWNED BY is rendered as a follow-up statement (pg_dump's model): an auto
 * edge sequence→column would cycle with the column default that references
 * the sequence.
 */
export function sequenceOwnedBySpecs(
  fact: Fact,
  opts: { allowNone?: boolean } = {},
): ActionSpec[] {
  const id = fact.id as { schema: string; name: string };
  const ownedBy = p(fact, "ownedBy") as {
    schema: string;
    table: string;
    column: string;
  } | null;
  if (ownedBy == null) {
    return opts.allowNone
      ? [{ sql: `ALTER SEQUENCE ${rel(id.schema, id.name)} OWNED BY NONE` }]
      : [];
  }
  return [
    {
      sql: `ALTER SEQUENCE ${rel(id.schema, id.name)} OWNED BY ${rel(ownedBy.schema, ownedBy.table)}.${qid(ownedBy.column)}`,
      consumes: [
        {
          kind: "column",
          schema: ownedBy.schema,
          table: ownedBy.table,
          name: ownedBy.column,
        },
      ],
    },
  ];
}

/** Constraints attach to tables OR domains; the parent kind decides. */
export function constraintTarget(fact: Fact): string {
  const id = fact.id as { schema: string; table: string };
  const keyword =
    fact.parent?.kind === "domain"
      ? "DOMAIN"
      : fact.parent?.kind === "foreignTable"
        ? "FOREIGN TABLE"
        : "TABLE";
  return `ALTER ${keyword} ${rel(id.schema, id.table)}`;
}

/** A composite type attribute's `name type [COLLATE …]` clause. */
export function typeAttributeClause(fact: Fact): string {
  const name = (fact.id as { name: string }).name;
  const collation = p(fact, "collation");
  return `${qid(name)} ${str(p(fact, "type"))}${collation != null ? ` COLLATE ${str(collation)}` : ""}`;
}

/** Table columns that USE a given composite type (via the column→type
 *  dependency edge). ALTER TYPE … ATTRIBUTE … CASCADE rewrites those
 *  tables; referencing the columns lets the proof's rewrite attribution
 *  map the type-scoped action to the tables it actually touches. */
export function compositeUserColumns(
  view: FactView,
  typeId: StableId,
): StableId[] {
  const key = encodeId(typeId);
  return view.edges
    .filter((e) => e.from.kind === "column" && encodeId(e.to) === key)
    .map((e) => e.from)
    .filter((id) => view.get(id) !== undefined);
}

/** O/D/R/A enabled-state chars → ALTER … ENABLE/DISABLE phrases. */
export function enabledPhrase(state: string): string {
  switch (state) {
    case "D":
      return "DISABLE";
    case "R":
      return "ENABLE REPLICA";
    case "A":
      return "ENABLE ALWAYS";
    default:
      return "ENABLE";
  }
}

/**
 * REPLICA IDENTITY rendered from the desired payload (both attributes render
 * the identical full clause, so order between them never matters). USING
 * INDEX consumes whichever fact owns that index name (a real index fact, or
 * the constraint backing it).
 */
export function replicaIdentitySpec(fact: Fact, view: FactView): ActionSpec {
  const id = fact.id as { schema: string; name: string };
  const mode = str(p(fact, "replicaIdentity") ?? "d");
  const relName = rel(id.schema, id.name);
  if (mode === "n") {
    return { sql: `ALTER TABLE ${relName} REPLICA IDENTITY NOTHING` };
  }
  if (mode === "f") {
    return { sql: `ALTER TABLE ${relName} REPLICA IDENTITY FULL` };
  }
  if (mode === "i") {
    const indexName = str(p(fact, "replicaIdentityIndex"));
    const consumes: StableId[] = [];
    const ownedConstraint = view
      .childrenOf(fact.id)
      .find((c) => c.id.kind === "constraint" && c.id.name === indexName);
    if (ownedConstraint) consumes.push(ownedConstraint.id);
    else consumes.push({ kind: "index", schema: id.schema, name: indexName });
    return {
      sql: `ALTER TABLE ${relName} REPLICA IDENTITY USING INDEX ${qid(indexName)}`,
      consumes,
    };
  }
  return { sql: `ALTER TABLE ${relName} REPLICA IDENTITY DEFAULT` };
}

export function grantActions(fact: Fact, verb: "grant"): ActionSpec[] {
  const id = fact.id as { kind: "acl"; target: StableId; grantee: string };
  const grantee = id.grantee === "PUBLIC" ? "PUBLIC" : qid(id.grantee);
  const privileges = p(fact, "privileges") as string[];
  const grantable = new Set((p(fact, "grantable") as string[]) ?? []);
  const plain = privileges.filter((priv) => !grantable.has(priv));
  const withOption = privileges.filter((priv) => grantable.has(priv));
  const consumes: StableId[] =
    id.grantee === "PUBLIC" ? [] : [{ kind: "role", name: id.grantee }];
  const specs: ActionSpec[] = [
    // pg_dump's model: reset to a clean slate first — implicit default-
    // privilege grants on freshly created objects would otherwise linger
    {
      sql: `REVOKE ALL ON ${grantTarget(id.target)} FROM ${grantee}`,
      consumes,
    },
  ];
  if (plain.length > 0) {
    specs.push({
      sql: `GRANT ${plain.join(", ")} ON ${grantTarget(id.target)} TO ${grantee}`,
      consumes,
    });
  }
  if (withOption.length > 0) {
    specs.push({
      sql: `GRANT ${withOption.join(", ")} ON ${grantTarget(id.target)} TO ${grantee} WITH GRANT OPTION`,
      consumes,
    });
  }
  void verb;
  return specs;
}

/** Aggregate signature: direct args [ORDER BY ordered args]; '*' when none. */
export function aggSig(fact: Fact): string {
  const args = (fact.id as { args: string[] }).args;
  const aggKind = str(p(fact, "aggKind") ?? "n");
  if (aggKind === "o" || aggKind === "h") {
    const direct = Number(p(fact, "numDirectArgs") ?? 0);
    return `${args.slice(0, direct).join(", ")} ORDER BY ${args.slice(direct).join(", ")}`;
  }
  return args.length > 0 ? args.join(", ") : "*";
}

export const DEFACL_OBJTYPE: Record<string, string> = {
  r: "TABLES",
  S: "SEQUENCES",
  f: "FUNCTIONS",
  T: "TYPES",
  n: "SCHEMAS",
};

export function defaultPrivPrefix(id: {
  role: string;
  schema: string | null;
}): string {
  let sql = `ALTER DEFAULT PRIVILEGES FOR ROLE ${qid(id.role)}`;
  if (id.schema != null) sql += ` IN SCHEMA ${qid(id.schema)}`;
  return sql;
}

export function defaultPrivConsumes(id: {
  role: string;
  schema: string | null;
  grantee: string;
}): StableId[] {
  const consumes: StableId[] = [{ kind: "role", name: id.role }];
  if (id.grantee !== "PUBLIC")
    consumes.push({ kind: "role", name: id.grantee });
  if (id.schema != null) consumes.push({ kind: "schema", name: id.schema });
  return consumes;
}

export function defaultPrivilegeActions(
  fact: Fact,
  verb: "GRANT",
): ActionSpec[] {
  const id = fact.id as {
    role: string;
    schema: string | null;
    objtype: string;
    grantee: string;
  };
  const grantee = id.grantee === "PUBLIC" ? "PUBLIC" : qid(id.grantee);
  const objtype = DEFACL_OBJTYPE[id.objtype] ?? "TABLES";
  const privileges = (p(fact, "privileges") as string[]) ?? [];
  const grantable = new Set((p(fact, "grantable") as string[]) ?? []);
  const plain = privileges.filter((priv) => !grantable.has(priv));
  const withOption = privileges.filter((priv) => grantable.has(priv));
  const consumes = defaultPrivConsumes(id);
  const specs: ActionSpec[] = [];
  if (plain.length > 0) {
    specs.push({
      sql: `${defaultPrivPrefix(id)} ${verb} ${plain.join(", ")} ON ${objtype} TO ${grantee}`,
      consumes,
    });
  }
  if (withOption.length > 0) {
    specs.push({
      sql: `${defaultPrivPrefix(id)} ${verb} ${withOption.join(", ")} ON ${objtype} TO ${grantee} WITH GRANT OPTION`,
      consumes,
    });
  }
  return specs;
}

/** The `rel [(cols)] [WHERE (…)]` member for a publicationRel fact, without the
 *  leading `TABLE` keyword (so it can be grouped under a single `TABLE`). */
function publicationRelMember(fact: Fact): string {
  const id = fact.id as { schema: string; table: string };
  let member = rel(id.schema, id.table);
  const cols = p(fact, "columns") as string[] | null;
  if (cols != null && cols.length > 0) {
    member += ` (${cols.map((c) => qid(c)).join(", ")})`;
  }
  const where = p(fact, "where");
  if (where != null) member += ` WHERE (${str(where)})`;
  return member;
}

/** The `TABLE rel [(cols)] [WHERE (…)]` clause for a publicationRel fact, used
 *  by the standalone `ALTER PUBLICATION … ADD TABLE` path. */
export function publicationRelClause(fact: Fact): string {
  return `TABLE ${publicationRelMember(fact)}`;
}

/** Inlined FOR-clause object list for a fresh publication, gathered from its
 *  publicationRel / publicationSchema children, with the ids consumed and
 *  the child facts produced (delta-set inlining). */
export function publicationObjects(
  fact: Fact,
  view: FactView,
): { clauses: string[]; consumes: StableId[]; produced: StableId[] } {
  // Group all table relations under a single `TABLE` keyword and all schemas
  // under a single `TABLES IN SCHEMA`. Repeating the keyword per item
  // (`FOR TABLE a, TABLE b`) is only valid grammar on PG15+; PG14 requires the
  // collapsed `FOR TABLE a, b` form, and the collapsed form is valid on every
  // version (PG14 never has schema members).
  const tableMembers: string[] = [];
  const schemaMembers: string[] = [];
  const consumes: StableId[] = [];
  const produced: StableId[] = [];
  for (const child of view.childrenOf(fact.id)) {
    if (child.id.kind === "publicationRel") {
      const cid = child.id as { schema: string; table: string };
      tableMembers.push(publicationRelMember(child));
      consumes.push({ kind: "table", schema: cid.schema, name: cid.table });
      produced.push(child.id);
    } else if (child.id.kind === "publicationSchema") {
      const cid = child.id as { schema: string };
      schemaMembers.push(qid(cid.schema));
      consumes.push({ kind: "schema", name: cid.schema });
      produced.push(child.id);
    }
  }
  const clauses: string[] = [];
  if (tableMembers.length > 0) clauses.push(`TABLE ${tableMembers.join(", ")}`);
  if (schemaMembers.length > 0)
    clauses.push(`TABLES IN SCHEMA ${schemaMembers.join(", ")}`);
  return { clauses, consumes, produced };
}
