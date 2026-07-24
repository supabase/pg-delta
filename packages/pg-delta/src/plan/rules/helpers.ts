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

const TEXT_ENCODER = new TextEncoder();

/** UTF-8 byte length of a string. Runtime-agnostic (no `Buffer`), so it works
 *  identically in Bun / Node / Deno — used where PostgreSQL's byte-based
 *  identifier limit (NAMEDATALEN) matters, not the JS UTF-16 code-unit length. */
export function byteLength(s: string): number {
  return TEXT_ENCODER.encode(s).length;
}

/** Clip `s` to at most `maxBytes` UTF-8 bytes WITHOUT splitting a code point, so
 *  the result is an identifier PostgreSQL will store verbatim (never itself
 *  truncate). Iterates by code point (`for…of`), never by UTF-16 unit. */
export function clipToByteLength(s: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (byteLength(s) <= maxBytes) return s;
  let out = "";
  let used = 0;
  for (const ch of s) {
    const chBytes = byteLength(ch);
    if (used + chBytes > maxBytes) break;
    out += ch;
    used += chBytes;
  }
  return out;
}

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

/** The `depends` edge targets of `id` in `view` — the objects the fact's
 *  definition references. A routine's def-alter (CREATE OR REPLACE) consumes
 *  these so it is ordered AFTER their creates: a BEGIN ATOMIC body is parsed and
 *  dependency-checked at replace time. plpgsql / quoted-string bodies are not
 *  (check_function_bodies=off in the preamble) and record no such edges, so this
 *  is exactly the set that needs ordering. Consuming an id nothing in-plan
 *  produces is harmless — no ordering edge is added. */
export function dependencyConsumes(view: FactView, id: StableId): StableId[] {
  return view
    .outgoingEdges(id)
    .filter((e) => e.kind === "depends")
    .map((e) => e.to);
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
interface IdentityOptions {
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
function isDefaultIdentityOptions(
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

/** The name PostgreSQL auto-derives for an identity column's implicit backing
 *  sequence: `<table>_<column>_seq` (in the table's own schema). */
function defaultIdentitySequenceName(table: string, column: string): string {
  return `${table}_${column}_seq`;
}

/** ` SEQUENCE NAME "<schema>"."<name>"` when the backing sequence's name (or
 *  schema) differs from PostgreSQL's `<table>_<column>_seq` default — the
 *  sequence was renamed or created via `SEQUENCE NAME`. Returns "" for the
 *  ordinary default-named case so exports stay minimal. Truncation/collision
 *  edge cases produce a name that never equals the naive default, so they
 *  always emit the clause — verbose but always valid, never a wrong-name
 *  round-trip. */
export function identitySequenceNameClause(
  value: PayloadValue,
  ref: { schema: string; table: string; column: string },
): string {
  if (value == null) return "";
  const sequence = (value as unknown as IdentityPayload).sequence;
  if (sequence == null) return "";
  const isDefault =
    sequence.schema === ref.schema &&
    sequence.name === defaultIdentitySequenceName(ref.table, ref.column);
  return isDefault
    ? ""
    : `SEQUENCE NAME ${rel(sequence.schema, sequence.name)}`;
}

/** ` (SEQUENCE NAME … INCREMENT BY … MINVALUE … …)` for an identity sequence
 *  with a non-default name and/or parameters, or "" when the name is the
 *  `<table>_<column>_seq` default and the parameters are the type defaults.
 *  `SEQUENCE NAME` is a valid identity option and PostgreSQL accepts it first
 *  in the list (pg_dump renders it the same way). */
export function identityOptionsClause(
  options: IdentityOptions | null,
  columnType: string,
  sequenceNameClause = "",
): string {
  const parts: string[] = [];
  if (sequenceNameClause) parts.push(sequenceNameClause);
  if (options != null && !isDefaultIdentityOptions(options, columnType)) {
    parts.push(
      `INCREMENT BY ${options.increment}`,
      `MINVALUE ${options.minValue}`,
      `MAXVALUE ${options.maxValue}`,
      `START WITH ${options.start}`,
      `CACHE ${options.cache}`,
      options.cycle ? "CYCLE" : "NO CYCLE",
    );
  }
  return parts.length === 0 ? "" : ` (${parts.join(" ")})`;
}

/** true when the OLD `[oldMin, oldMax]` value range and the NEW `[newMin, newMax]`
 *  range are provably DISJOINT (`oldMax < newMin || oldMin > newMax`).
 *
 *  A sequence's / identity's live counter (`last_value`) is UNMODELED runtime
 *  state — the diff never sees it. When the two ranges are disjoint the counter
 *  is GUARANTEED to fall outside the new range, so the only in-place path that
 *  converges is `RESTART` (realign to the new START, always inside the new range
 *  — matching what a fresh `… START WITH …` would produce). When the ranges
 *  OVERLAP we must NOT `RESTART`: the live counter is very likely still valid
 *  (e.g. counter at 500, MIN 1→0 + START 1→2 leaves 500 usable), and silently
 *  resetting it to START replays already-issued values → duplicate keys. If an
 *  overlapping change happens to leave the counter outside the new range,
 *  PostgreSQL rejects the ALTER loudly and the operator decides — we never
 *  silently reset. Bounds are bigint-valued, so compare with BigInt (they reach
 *  9223372036854775807, past Number's safe-integer range). */
function rangesDisjoint(
  oldMin: string,
  oldMax: string,
  newMin: string,
  newMax: string,
): boolean {
  return BigInt(oldMax) < BigInt(newMin) || BigInt(oldMin) > BigInt(newMax);
}

/** in-place identity-sequence parameter transition (no rebuild), emitted as ONE
 *  `ALTER COLUMN … SET <opt> SET <opt> …` statement.
 *
 *  A single ALTER COLUMN with CHAINED `SET` clauses validates the FINAL state:
 *  splitting the change into one statement per option (in diff-field order) ran
 *  `SET MAXVALUE 50` while MIN was still 100 when moving both bounds down —
 *  Postgres rejects the transient `min > max`. Chaining defers the range check to
 *  the end of the statement (verified on PG15/17).
 *
 *  `RESTART` is appended only when the old and new ranges are provably DISJOINT
 *  (see {@link rangesDisjoint}). An overlapping change — even one that moves a
 *  bound AND the START — leaves the live counter alone, because it is probably
 *  still valid and resetting it risks duplicate keys. */
export function identityOptionAlterSpecs(
  target: string,
  from: IdentityOptions | null,
  to: IdentityOptions | null,
): ActionSpec[] {
  if (to == null) return [];
  const clauses: string[] = [];
  if (from == null || from.increment !== to.increment)
    clauses.push(`SET INCREMENT BY ${to.increment}`);
  if (from == null || from.minValue !== to.minValue)
    clauses.push(`SET MINVALUE ${to.minValue}`);
  if (from == null || from.maxValue !== to.maxValue)
    clauses.push(`SET MAXVALUE ${to.maxValue}`);
  if (from == null || from.start !== to.start)
    clauses.push(`SET START WITH ${to.start}`);
  if (from == null || from.cache !== to.cache)
    clauses.push(`SET CACHE ${to.cache}`);
  if (from == null || from.cycle !== to.cycle)
    clauses.push(`SET ${to.cycle ? "CYCLE" : "NO CYCLE"}`);
  if (clauses.length === 0) return [];
  if (
    from != null &&
    rangesDisjoint(from.minValue, from.maxValue, to.minValue, to.maxValue)
  )
    clauses.push("RESTART");
  return [{ sql: `${target} ${clauses.join(" ")}` }];
}

/** The CREATE-SEQUENCE-style value options a standalone sequence carries, in a
 *  fixed render order. `ownedBy` is deliberately excluded: it carries its own
 *  dependency metadata (consumes/releases) and is emitted as a separate
 *  `OWNED BY` statement. */
const SEQUENCE_VALUE_OPTIONS = [
  "dataType",
  "increment",
  "minValue",
  "maxValue",
  "start",
  "cache",
  "cycle",
] as const;

function sequenceOptionClause(fact: Fact, option: string): string {
  switch (option) {
    case "dataType":
      return `AS ${str(p(fact, "dataType"))}`;
    case "increment":
      return `INCREMENT BY ${str(p(fact, "increment"))}`;
    case "minValue":
      return `MINVALUE ${str(p(fact, "minValue"))}`;
    case "maxValue":
      return `MAXVALUE ${str(p(fact, "maxValue"))}`;
    case "start":
      return `START WITH ${str(p(fact, "start"))}`;
    case "cache":
      return `CACHE ${str(p(fact, "cache"))}`;
    case "cycle":
      return p(fact, "cycle") ? "CYCLE" : "NO CYCLE";
    default:
      throw new Error(`sequence rule: unknown value option '${option}'`);
  }
}

/** Combined `ALTER SEQUENCE … <opt> <opt> …` for a standalone sequence's
 *  value-option transition, emitted ONCE — from whichever changed option sorts
 *  first — because the emitter calls each changed attribute's `alter`
 *  independently and we want a SINGLE statement covering all of them.
 *
 *  One statement validates the FINAL state: per-field `ALTER SEQUENCE` statements
 *  in diff-field (lexicographic) order ran `MAXVALUE 50` while MIN was still 100
 *  when moving both bounds down, and Postgres rejects the transient `min > max`.
 *
 *  `RESTART` is appended only when the old and new ranges are provably DISJOINT —
 *  see {@link rangesDisjoint} and {@link identityOptionAlterSpecs} for the
 *  identity seam's identical reasoning: the sequence's live counter (unmanaged
 *  runtime state, not part of the diff) is left in place for an overlapping
 *  change, because it is probably still valid and resetting it risks duplicate
 *  keys; only a disjoint shift guarantees the counter is invalid. */
export function sequenceOptionAlter(
  currentAttr: string,
  fact: Fact,
  sourceView: FactView,
): ActionSpec[] {
  const source = sourceView.get(fact.id);
  const changed = SEQUENCE_VALUE_OPTIONS.filter(
    (key) => source === undefined || source.payload[key] !== fact.payload[key],
  );
  if (changed.length === 0) return [];
  const [lead] = [...changed].sort();
  if (currentAttr !== lead) return [];
  const id = fact.id as { schema: string; name: string };
  const clauses = changed.map((option) => sequenceOptionClause(fact, option));
  if (
    source !== undefined &&
    rangesDisjoint(
      str(source.payload["minValue"]),
      str(source.payload["maxValue"]),
      str(p(fact, "minValue")),
      str(p(fact, "maxValue")),
    )
  )
    clauses.push("RESTART");
  return [
    { sql: `ALTER SEQUENCE ${rel(id.schema, id.name)} ${clauses.join(" ")}` },
  ];
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
    sql += identityOptionsClause(
      identityOptions(identity),
      type,
      identitySequenceNameClause(identity, columnRef(fact)),
    );
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
  opts: {
    allowNone?: boolean;
    /** the previous owner (an ownedBy payload value) when this is an in-place
     *  reassignment — released so the ALTER runs before a same-plan DROP of the
     *  old owning column/table, which would otherwise cascade the sequence away
     *  before it is re-owned. */
    releaseOld?: { schema: string; table: string; column: string } | null;
  } = {},
): ActionSpec[] {
  const id = fact.id as { schema: string; name: string };
  const old = opts.releaseOld;
  const releases: StableId[] =
    old != null
      ? [
          {
            kind: "column",
            schema: old.schema,
            table: old.table,
            name: old.column,
          },
        ]
      : [];
  const ownedBy = p(fact, "ownedBy") as {
    schema: string;
    table: string;
    column: string;
  } | null;
  if (ownedBy == null) {
    return opts.allowNone
      ? [
          {
            sql: `ALTER SEQUENCE ${rel(id.schema, id.name)} OWNED BY NONE`,
            ...(releases.length > 0 ? { releases } : {}),
          },
        ]
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
      ...(releases.length > 0 ? { releases } : {}),
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
  const id = fact.id as {
    kind: "acl";
    target: StableId;
    grantee: string;
    column?: string;
  };
  const grantee = id.grantee === "PUBLIC" ? "PUBLIC" : qid(id.grantee);
  const privileges = p(fact, "privileges") as string[];
  const grantable = new Set((p(fact, "grantable") as string[]) ?? []);
  const plain = privileges.filter((priv) => !grantable.has(priv));
  const withOption = privileges.filter((priv) => grantable.has(priv));
  const consumes: StableId[] =
    id.grantee === "PUBLIC" ? [] : [{ kind: "role", name: id.grantee }];
  // Column-level grant: each privilege is qualified by the column
  // (`SELECT (col)`) and REVOKE ALL takes the column list too. Object-level
  // grants render the bare privilege list.
  const col = id.column;
  const q = (privs: string[]): string =>
    col === undefined
      ? privs.join(", ")
      : privs.map((priv) => `${priv} (${qid(col)})`).join(", ");
  const revokeAll =
    col === undefined ? "REVOKE ALL" : `REVOKE ALL (${qid(col)})`;
  const specs: ActionSpec[] = [
    // pg_dump's model: reset to a clean slate first — implicit default-
    // privilege grants on freshly created objects would otherwise linger
    {
      sql: `${revokeAll} ON ${grantTarget(id.target)} FROM ${grantee}`,
      consumes,
    },
  ];
  if (plain.length > 0) {
    specs.push({
      sql: `GRANT ${q(plain)} ON ${grantTarget(id.target)} TO ${grantee}`,
      consumes,
    });
  }
  if (withOption.length > 0) {
    specs.push({
      sql: `GRANT ${q(withOption)} ON ${grantTarget(id.target)} TO ${grantee} WITH GRANT OPTION`,
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

const DEFACL_OBJTYPE: Record<string, string> = {
  r: "TABLES",
  S: "SEQUENCES",
  f: "FUNCTIONS",
  T: "TYPES",
  n: "SCHEMAS",
  L: "LARGE OBJECTS",
};

/** Render a `pg_default_acl.defaclobjtype` code, or throw loud — an unmapped
 *  code silently rendered as `TABLES` (the old `?? "TABLES"` fallback) would
 *  emit the WRONG DDL for a future/unhandled objtype instead of surfacing the
 *  gap. */
function defaclObjType(objtype: string): string {
  const rendered = DEFACL_OBJTYPE[objtype];
  if (rendered === undefined) {
    throw new Error(
      `defaultPrivilege: unmapped pg_default_acl.defaclobjtype "${objtype}" — add it to DEFACL_OBJTYPE (helpers.ts)`,
    );
  }
  return rendered;
}

function defaultPrivPrefix(id: {
  role: string;
  schema: string | null;
}): string {
  let sql = `ALTER DEFAULT PRIVILEGES FOR ROLE ${qid(id.role)}`;
  if (id.schema != null) sql += ` IN SCHEMA ${qid(id.schema)}`;
  return sql;
}

function defaultPrivConsumes(id: {
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

/**
 * A `defaultPrivilege` fact with EMPTY `privileges` is a synthesized marker for
 * a REVOKED built-in default (e.g. `ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON
 * FUNCTIONS FROM PUBLIC`): the grantee's built-in default was taken away. Its
 * `_revokedDefault` carries the privileges that were removed so the DROP can
 * restore them. A non-empty fact is an ordinary positive grant.
 */
function isRevokedDefaultMarker(fact: Fact): boolean {
  return ((p(fact, "privileges") as string[]) ?? []).length === 0;
}

/** CREATE a default-privilege fact: GRANT the privileges, or — for a revoked
 *  default marker — REVOKE the built-in default the marker records is gone. */
export function defaultPrivilegeCreateActions(fact: Fact): ActionSpec[] {
  const id = fact.id as {
    role: string;
    schema: string | null;
    objtype: string;
    grantee: string;
  };
  const grantee = id.grantee === "PUBLIC" ? "PUBLIC" : qid(id.grantee);
  const objtype = defaclObjType(id.objtype);
  const consumes = defaultPrivConsumes(id);
  if (isRevokedDefaultMarker(fact)) {
    return [
      {
        sql: `${defaultPrivPrefix(id)} REVOKE ALL ON ${objtype} FROM ${grantee}`,
        consumes,
      },
    ];
  }
  const privileges = (p(fact, "privileges") as string[]) ?? [];
  const grantable = new Set((p(fact, "grantable") as string[]) ?? []);
  const plain = privileges.filter((priv) => !grantable.has(priv));
  const withOption = privileges.filter((priv) => grantable.has(priv));
  const specs: ActionSpec[] = [];
  if (plain.length > 0) {
    specs.push({
      sql: `${defaultPrivPrefix(id)} GRANT ${plain.join(", ")} ON ${objtype} TO ${grantee}`,
      consumes,
    });
  }
  if (withOption.length > 0) {
    specs.push({
      sql: `${defaultPrivPrefix(id)} GRANT ${withOption.join(", ")} ON ${objtype} TO ${grantee} WITH GRANT OPTION`,
      consumes,
    });
  }
  return specs;
}

/** DROP a default-privilege fact: REVOKE the positive grant, or — for a revoked
 *  default marker — GRANT the built-in default back (restoring it). */
export function defaultPrivilegeDropActions(fact: Fact): ActionSpec {
  const id = fact.id as {
    role: string;
    schema: string | null;
    objtype: string;
    grantee: string;
  };
  const grantee = id.grantee === "PUBLIC" ? "PUBLIC" : qid(id.grantee);
  const objtype = defaclObjType(id.objtype);
  const consumes = defaultPrivConsumes(id);
  if (isRevokedDefaultMarker(fact)) {
    const restored = (p(fact, "_revokedDefault") as string[]) ?? [];
    return {
      sql: `${defaultPrivPrefix(id)} GRANT ${restored.join(", ")} ON ${objtype} TO ${grantee}`,
      consumes,
    };
  }
  return {
    sql: `${defaultPrivPrefix(id)} REVOKE ALL ON ${objtype} FROM ${grantee}`,
    consumes,
  };
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
