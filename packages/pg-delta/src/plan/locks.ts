/**
 * The vetted lock-class table (target-architecture §3.7, stage 5
 * deliverable 7): per-DDL-form lock levels from PostgreSQL's documentation.
 * Lock classes are REPORTED, not certified — no runtime introspection
 * (stage 6 pitfall). Classes describe the strongest lock the statement
 * takes on EXISTING user relations; creating a brand-new object locks
 * nothing a user query can collide with, so it reports "none".
 *
 * Sources: PostgreSQL docs "Explicit Locking" (table-level lock modes) and
 * the ALTER TABLE / CREATE INDEX / CREATE TRIGGER reference pages.
 */

export type LockClass =
  /** no lock on any existing user relation (new objects, cluster/catalog-only DDL) */
  | "none"
  /** SHARE — blocks writes, allows reads (CREATE INDEX) */
  | "share"
  /** SHARE ROW EXCLUSIVE — blocks writes + other DDL (CREATE TRIGGER, ADD FOREIGN KEY) */
  | "shareRowExclusive"
  /** SHARE UPDATE EXCLUSIVE — blocks DDL, allows reads+writes (CONCURRENTLY forms, VALIDATE CONSTRAINT) */
  | "shareUpdateExclusive"
  /** ACCESS EXCLUSIVE — blocks everything (most ALTER TABLE forms, DROP) */
  | "accessExclusive";

/**
 * Default lock class per (kind, verb). Rules override per-spec where a
 * specific DDL form is weaker/stronger than its kind's default (e.g.
 * FK constraints, CONCURRENTLY index builds).
 */
const KIND_VERB_LOCKS: Record<
  string,
  Partial<Record<"create" | "alter" | "drop", LockClass>>
> = {
  // relation-touching kinds
  table: { create: "none", alter: "accessExclusive", drop: "accessExclusive" },
  column: {
    create: "accessExclusive", // ALTER TABLE ADD COLUMN
    alter: "accessExclusive",
    drop: "accessExclusive",
  },
  default: {
    create: "accessExclusive", // ALTER TABLE … SET DEFAULT (brief catalog-only, still AE)
    alter: "accessExclusive",
    drop: "accessExclusive",
  },
  constraint: {
    create: "accessExclusive", // rules override: FK = shareRowExclusive, VALIDATE = SUE
    alter: "accessExclusive",
    drop: "accessExclusive",
  },
  index: {
    create: "share", // CREATE INDEX; CONCURRENTLY overrides to shareUpdateExclusive
    alter: "accessExclusive",
    drop: "accessExclusive",
  },
  trigger: {
    create: "shareRowExclusive",
    alter: "shareRowExclusive", // ENABLE/DISABLE TRIGGER
    drop: "accessExclusive",
  },
  policy: {
    create: "accessExclusive",
    alter: "accessExclusive",
    drop: "accessExclusive",
  },
  rule: {
    create: "accessExclusive",
    alter: "accessExclusive",
    drop: "accessExclusive",
  },
  view: { create: "none", alter: "accessExclusive", drop: "accessExclusive" },
  materializedView: {
    create: "none",
    alter: "accessExclusive",
    drop: "accessExclusive",
  },
  foreignTable: {
    create: "none",
    alter: "accessExclusive",
    drop: "accessExclusive",
  },
  sequence: {
    create: "none",
    alter: "accessExclusive",
    drop: "accessExclusive",
  },
  // ALTER PUBLICATION … SET takes ShareUpdateExclusive on the listed tables
  publication: { create: "none", alter: "shareUpdateExclusive", drop: "none" },
};

/** Kinds whose DDL never locks an existing user relation. */
const NO_RELATION_LOCK_KINDS = new Set([
  "schema",
  "role",
  "membership",
  "defaultPrivilege",
  "extension",
  "function",
  "procedure",
  "aggregate",
  "domain",
  "type",
  "collation",
  "eventTrigger",
  "subscription",
  "fdw",
  "server",
  "userMapping",
  "comment",
  "acl",
]);

export function lockClassFor(
  kind: string,
  verb: "create" | "alter" | "drop",
): LockClass {
  const perKind = KIND_VERB_LOCKS[kind];
  if (perKind?.[verb] !== undefined) return perKind[verb];
  if (NO_RELATION_LOCK_KINDS.has(kind)) return "none";
  // unknown kind: report the conservative worst case rather than a
  // soothing default
  return "accessExclusive";
}
