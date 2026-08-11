/**
 * Typed stable identity — structured end-to-end (target-architecture §3.1).
 *
 * The ONLY place the canonical string encoding exists (guardrail 1).
 * Extraction returns identity *parts*; this codec produces/parses strings,
 * which appear only in persisted artifacts, graph keys, and logs.
 * Identity, rename, and ACL invariants: docs/architecture/identity-and-acl.md.
 */

/** Kinds identified by a single name (cluster- or database-global). */
const SIMPLE_KINDS = [
  "schema",
  "role",
  "extension",
  "language",
  "eventTrigger",
  "publication",
  "subscription",
  "fdw",
  "server",
] as const;
export type SimpleKind = (typeof SIMPLE_KINDS)[number];

/** Kinds identified by (schema, name). Indexes are schema-scoped in PostgreSQL. */
const QUALIFIED_KINDS = [
  "table",
  "view",
  "materializedView",
  "foreignTable",
  "sequence",
  "index",
  "collation",
  "domain",
  "type",
] as const;
export type QualifiedKind = (typeof QUALIFIED_KINDS)[number];

/** Kinds identified by (schema, table, name). For `default`, name = column name. */
const SUBENTITY_KINDS = [
  "column",
  "constraint",
  "trigger",
  "rule",
  "policy",
  "default",
] as const;
export type SubEntityKind = (typeof SUBENTITY_KINDS)[number];

/** Kinds identified by (schema, name, argument type list). PostgreSQL gives
 *  functions and procedures DIFFERENT DDL address syntax (COMMENT/GRANT/SECURITY
 *  LABEL ON FUNCTION vs ON PROCEDURE), so they are distinct id kinds — the
 *  renderer must never infer the address grammar from a payload field. */
export const ROUTINE_KINDS = ["function", "procedure", "aggregate"] as const;
export type RoutineKind = (typeof ROUTINE_KINDS)[number];

/**
 * Kinds whose fact materializes a USER EXPRESSION that PostgreSQL EVALUATES
 * while the DDL is applied, rather than merely recording it:
 *   - `default`   — `ADD COLUMN … DEFAULT f()` / `SET DEFAULT` (attmissingval
 *                   or a full rewrite);
 *   - `column`    — a STORED generated column (it carries NO `default` fact:
 *                   the extractor shadows the expression's edges onto the
 *                   column itself), backfilled on ADD COLUMN;
 *   - `constraint`— a VALIDATED CHECK scans the existing rows (PK/UNIQUE/FK
 *                   never reference a routine, so listing the whole kind
 *                   over-marks nothing in practice, and an EXCLUDE builds an
 *                   index anyway);
 *   - `index`     — an expression index evaluates its expression per row;
 *   - `materializedView`
 *                 — the create rule emits `CREATE MATERIALIZED VIEW … AS
 *                   <query>` with NO `WITH NO DATA` (plan/rules/views.ts), so
 *                   applying it RUNS the query. The `_RETURN` rewrite rule's
 *                   deps are attributed to the matview fact itself
 *                   (extract/dependencies.ts), so a routine the query calls IS
 *                   a `depends` edge on this fact. A plain `view` is NOT
 *                   listed: `CREATE VIEW` only records the rewrite rule.
 *
 * The planner's evaluator stratum (plan/internal.ts) uses this to sink such
 * actions below every simultaneously-ready DEFINITION action, because their
 * routine's OPAQUE quoted body may call helpers pg_depend never recorded.
 * Kept next to ROUTINE_KINDS so the classifier needs no FactKind literals.
 *
 * This list gates WHICH facts get tested; the test itself is transitive — *an
 * action is an evaluator iff applying it can execute a user routine, i.e. a
 * routine is REACHABLE from its evaluated expression's recorded structure.* That
 * structure is the `depends` edges PLUS the parent→child descents declared in
 * EVALUATED_CHILD_DESCENT below. The subquery-free kinds (`default`, `column`,
 * `constraint`, `index`) can only reference a routine directly, but a
 * `materializedView`'s expression is a whole query, so its routine may sit behind
 * an intermediate view.
 */
export const EVALUATED_EXPRESSION_KINDS = [
  "column",
  "constraint",
  "default",
  "index",
  "materializedView",
] as const satisfies readonly FactKind[];

/**
 * `[parent, child]` kind pairs the evaluator reachability walk descends INTO, on
 * top of `depends` edges. Some expressions a statement executes are recorded as
 * CHILD facts of a referenced object rather than as edges out of it:
 *
 *   - `["domain", "constraint"]` — a domain's CHECKs are children of the domain,
 *     and nothing links the domain fact to the routines they call. Storing a
 *     value in that domain RUNS them, so `ADD COLUMN col <domain> DEFAULT …`
 *     (whose only edge is `column -> domain`) must see them.
 *
 * Deliberately a narrow allowlist, NOT general child descent: a matview over a
 * table must not inherit the table's column defaults — populating a matview
 * never evaluates them, and inheriting them would sink half the plan.
 */
export const EVALUATED_CHILD_DESCENT = [
  ["domain", "constraint"],
] as const satisfies ReadonlyArray<readonly [FactKind, FactKind]>;

export type StableId =
  | { kind: SimpleKind; name: string }
  | { kind: QualifiedKind; schema: string; name: string }
  | { kind: SubEntityKind; schema: string; table: string; name: string }
  | { kind: RoutineKind; schema: string; name: string; args: string[] }
  | { kind: "membership"; role: string; member: string }
  | { kind: "userMapping"; server: string; role: string }
  | { kind: "typeAttribute"; schema: string; type: string; name: string }
  | {
      kind: "publicationRel";
      publication: string;
      schema: string;
      table: string;
    }
  | { kind: "publicationSchema"; publication: string; schema: string }
  | { kind: "comment"; target: StableId }
  /** `column` is set for a COLUMN-level grant (`pg_attribute.attacl`,
   *  e.g. `GRANT SELECT (col) ON t TO r`): `target` stays the owning relation
   *  and `column` names the attribute the privileges are qualified by. Absent
   *  for an ordinary object-level ACL. */
  | { kind: "acl"; target: StableId; grantee: string; column?: string }
  | { kind: "securityLabel"; target: StableId; provider: string }
  | {
      kind: "defaultPrivilege";
      role: string;
      schema: string | null;
      objtype: string;
      grantee: string;
    }
  /** Extension intent (docs/architecture/extension-intent.md §3): a single
   *  generic kind for every stateful-extension intent fact (pg_cron jobs,
   *  future pgmq queues, …), keyed by `ext` + `intentKind` + `key`. Produced by
   *  the integration layer (handlers), never by core `pg_catalog` extraction —
   *  the codec gains ONE generic kind, not one per extension. */
  | { kind: "extensionIntent"; ext: string; intentKind: string; key: string };

export type FactKind = StableId["kind"];

/** A satellite fact (comment / acl / securityLabel) hangs off a target object
 *  via a `target` field, rather than being an object in its own right. Callers
 *  that special-case "object vs its metadata" test this instead of re-deriving
 *  the `"target" in id` shape (extension-member projection, orphan-satellite
 *  pruning). */
export function isSatelliteId(id: StableId): boolean {
  return "target" in id;
}

/** Every `FactKind`, as a runtime array. The `satisfies` + the `_exhaustive`
 *  assignment below make this a COMPILE error if a new `StableId` kind is added
 *  without listing it here — which in turn keeps the role-name-bearing registry
 *  (plan/identity-normalize.ts) honest (a new kind must be classified). */
export const ALL_FACT_KINDS = [
  ...SIMPLE_KINDS,
  ...QUALIFIED_KINDS,
  ...SUBENTITY_KINDS,
  ...ROUTINE_KINDS,
  "membership",
  "userMapping",
  "typeAttribute",
  "publicationRel",
  "publicationSchema",
  "comment",
  "acl",
  "securityLabel",
  "defaultPrivilege",
  "extensionIntent",
] as const satisfies readonly FactKind[];
// `satisfies` rejects an entry that is not a FactKind; this assertion rejects a
// FactKind that is MISSING from the array (it resolves to `never`, so the
// `= true` fails to compile). Together they pin ALL_FACT_KINDS === FactKind.
const _allFactKindsCoversUnion: FactKind extends (typeof ALL_FACT_KINDS)[number]
  ? true
  : never = true;
void _allFactKindsCoversUnion;

const SIMPLE = new Set<string>(SIMPLE_KINDS);
const QUALIFIED = new Set<string>(QUALIFIED_KINDS);
const SUBENTITY = new Set<string>(SUBENTITY_KINDS);
const ROUTINE = new Set<string>(ROUTINE_KINDS);

/** Characters that force a segment to be quoted. */
const NEEDS_QUOTE = /[.:(),"\s]/;

function seg(part: string): string {
  if (part === "" || NEEDS_QUOTE.test(part)) {
    return `"${part.replaceAll('"', '""')}"`;
  }
  return part;
}

/**
 * StableId object -> its encoding. `encodeId` is one of the hottest functions in
 * the engine: `FactBase.get` / `has` / `hashOf` / `childrenOf` / `outgoingEdges`
 * all key their indexes by the encoding, so every lookup re-walks the id and
 * re-runs `seg` over each part, and a plan performs millions of lookups over a
 * few tens of thousands of DISTINCT id objects.
 *
 * INVARIANT: a StableId object is never mutated after construction. Ids are
 * built once (extract / load / snapshot decode / rule construction) and
 * thereafter only read; every transform that changes one returns a NEW id (e.g.
 * `plan/identity-normalize.ts`). This is the same invariant `payloadHashes` in
 * `core/hash.ts` already relies on for payloads. Weak keys, so entries die with
 * the facts that own them.
 *
 * Memoizing the outer call subsumes the nested one: `comment` / `acl` /
 * `securityLabel` encode their `target` id through `encodeId`, so a repeated
 * target hits this map too.
 */
const idEncodings = new WeakMap<object, string>();

export function encodeId(id: StableId): string {
  const memo = idEncodings.get(id);
  if (memo !== undefined) return memo;
  const encoded = encodeIdUncached(id);
  idEncodings.set(id, encoded);
  return encoded;
}

function encodeIdUncached(id: StableId): string {
  const k = id.kind;
  switch (k) {
    case "membership":
      return `membership:${seg(id.role)}.${seg(id.member)}`;
    case "userMapping":
      return `userMapping:${seg(id.server)}.${seg(id.role)}`;
    case "typeAttribute":
      return `typeAttribute:${seg(id.schema)}.${seg(id.type)}.${seg(id.name)}`;
    case "publicationRel":
      return `publicationRel:${seg(id.publication)}.${seg(id.schema)}.${seg(id.table)}`;
    case "publicationSchema":
      return `publicationSchema:${seg(id.publication)}.${seg(id.schema)}`;
    case "comment":
      return `comment:(${encodeId(id.target)})`;
    case "acl":
      // column suffix only when set, so object-level ACL ids stay byte-identical
      return `acl:(${encodeId(id.target)}).${seg(id.grantee)}${
        id.column !== undefined ? `.${seg(id.column)}` : ""
      }`;
    case "securityLabel":
      return `securityLabel:(${encodeId(id.target)}).${seg(id.provider)}`;
    case "defaultPrivilege":
      return `defaultPrivilege:${seg(id.role)}.${seg(id.schema ?? "")}.${seg(id.objtype)}.${seg(id.grantee)}`;
    case "extensionIntent":
      return `extensionIntent:${seg(id.ext)}.${seg(id.intentKind)}.${seg(id.key)}`;
    default:
      if (SIMPLE.has(k)) return `${k}:${seg((id as { name: string }).name)}`;
      if (QUALIFIED.has(k)) {
        const q = id as { schema: string; name: string };
        return `${k}:${seg(q.schema)}.${seg(q.name)}`;
      }
      if (SUBENTITY.has(k)) {
        const s = id as { schema: string; table: string; name: string };
        return `${k}:${seg(s.schema)}.${seg(s.table)}.${seg(s.name)}`;
      }
      if (ROUTINE.has(k)) {
        const r = id as { schema: string; name: string; args: string[] };
        return `${k}:${seg(r.schema)}.${seg(r.name)}(${r.args.map(seg).join(",")})`;
      }
      throw new Error(`encodeId: unknown kind ${String(k)}`);
  }
}

class Cursor {
  pos = 0;
  constructor(readonly input: string) {}

  peek(): string | undefined {
    return this.input[this.pos];
  }

  expect(ch: string): void {
    if (this.input[this.pos] !== ch) {
      throw new Error(
        `parseId: expected '${ch}' at position ${this.pos} in '${this.input}'`,
      );
    }
    this.pos++;
  }

  /** Read one segment: quoted ("" escapes) or bare (until a delimiter). */
  readSegment(): string {
    if (this.peek() === '"') return this.readQuotedSegment();
    const start = this.pos;
    while (
      this.pos < this.input.length &&
      !/[.:(),)]/.test(this.input[this.pos] as string)
    ) {
      this.pos++;
    }
    if (this.pos === start) {
      throw new Error(
        `parseId: empty segment at position ${this.pos} in '${this.input}'`,
      );
    }
    return this.input.slice(start, this.pos);
  }

  private readQuotedSegment(): string {
    this.pos++;
    let out = "";
    for (;;) {
      const ch = this.input[this.pos];
      if (ch === undefined) {
        throw new Error(`parseId: unterminated quote in '${this.input}'`);
      }
      if (ch === '"') {
        if (this.input[this.pos + 1] === '"') {
          out += '"';
          this.pos += 2;
        } else {
          this.pos++;
          return out;
        }
      } else {
        out += ch;
        this.pos++;
      }
    }
  }

  atEnd(): boolean {
    return this.pos >= this.input.length;
  }
}

function parseAt(c: Cursor): StableId {
  // kind is always bare alphanumeric, never quoted
  const kindStart = c.pos;
  while (c.pos < c.input.length && /[a-zA-Z]/.test(c.input[c.pos] as string))
    c.pos++;
  const kind = c.input.slice(kindStart, c.pos);
  c.expect(":");

  if (SIMPLE.has(kind)) {
    return { kind: kind as SimpleKind, name: c.readSegment() };
  }
  if (QUALIFIED.has(kind)) {
    const schema = c.readSegment();
    c.expect(".");
    const name = c.readSegment();
    return { kind: kind as QualifiedKind, schema, name };
  }
  if (SUBENTITY.has(kind)) {
    const schema = c.readSegment();
    c.expect(".");
    const table = c.readSegment();
    c.expect(".");
    const name = c.readSegment();
    return { kind: kind as SubEntityKind, schema, table, name };
  }
  if (ROUTINE.has(kind)) {
    const schema = c.readSegment();
    c.expect(".");
    const name = c.readSegment();
    c.expect("(");
    const args: string[] = [];
    if (c.peek() !== ")") {
      for (;;) {
        args.push(c.readSegment());
        if (c.peek() === ",") {
          c.pos++;
          continue;
        }
        break;
      }
    }
    c.expect(")");
    return { kind: kind as RoutineKind, schema, name, args };
  }
  switch (kind) {
    case "membership": {
      const role = c.readSegment();
      c.expect(".");
      const member = c.readSegment();
      return { kind, role, member };
    }
    case "userMapping": {
      const server = c.readSegment();
      c.expect(".");
      const role = c.readSegment();
      return { kind, server, role };
    }
    case "typeAttribute": {
      const schema = c.readSegment();
      c.expect(".");
      const type = c.readSegment();
      c.expect(".");
      const name = c.readSegment();
      return { kind, schema, type, name };
    }
    case "publicationRel": {
      const publication = c.readSegment();
      c.expect(".");
      const schema = c.readSegment();
      c.expect(".");
      const table = c.readSegment();
      return { kind, publication, schema, table };
    }
    case "publicationSchema": {
      const publication = c.readSegment();
      c.expect(".");
      const schema = c.readSegment();
      return { kind, publication, schema };
    }
    case "comment": {
      c.expect("(");
      const target = parseAt(c);
      c.expect(")");
      return { kind, target };
    }
    case "acl": {
      c.expect("(");
      const target = parseAt(c);
      c.expect(")");
      c.expect(".");
      const grantee = c.readSegment();
      // optional `.column` segment for a COLUMN-level grant; mirrors encodeId,
      // which appends it only when `column` is set. A trailing "." here (rather
      // than end-of-input or a nesting ")") signals the column is present.
      if (c.peek() === ".") {
        c.pos++;
        return { kind, target, grantee, column: c.readSegment() };
      }
      return { kind, target, grantee };
    }
    case "securityLabel": {
      c.expect("(");
      const target = parseAt(c);
      c.expect(")");
      c.expect(".");
      const provider = c.readSegment();
      return { kind, target, provider };
    }
    case "defaultPrivilege": {
      const role = c.readSegment();
      c.expect(".");
      const schema = c.readSegment();
      c.expect(".");
      const objtype = c.readSegment();
      c.expect(".");
      const grantee = c.readSegment();
      return {
        kind,
        role,
        schema: schema === "" ? null : schema,
        objtype,
        grantee,
      };
    }
    case "extensionIntent": {
      const ext = c.readSegment();
      c.expect(".");
      const intentKind = c.readSegment();
      c.expect(".");
      const key = c.readSegment();
      return { kind, ext, intentKind, key };
    }
    default:
      throw new Error(`parseId: unknown kind '${kind}' in '${c.input}'`);
  }
}

export function parseId(encoded: string): StableId {
  const c = new Cursor(encoded);
  const id = parseAt(c);
  if (!c.atEnd()) {
    throw new Error(
      `parseId: trailing input at position ${c.pos} in '${encoded}'`,
    );
  }
  return id;
}
