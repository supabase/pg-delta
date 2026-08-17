/**
 * Declarative export (stage 9 deliverable 6): render a fact base to SQL
 * files via the planner (plan(∅ → fb) — the same renderer as everything
 * else) and split the statements across files by a mapping policy.
 *
 * Two layouts:
 * - "by-object" (default): the human layout users know from the old
 *   engine's exporter — _cluster/roles.sql, <schema>/tables/<t>.sql, …
 *   Files within a path are emitted in plan (dependency) order, but the
 *   loader's lexicographic discovery may need its bounded retry rounds for
 *   cross-file references. Fidelity is the gate: load(export(fb)) ≡ fb.
 * - "ordered": file names carry a zero-padded sequence prefix in plan
 *   order, so lexicographic discovery IS dependency order and the loader
 *   converges with zero deferred rounds (the stage-9 zero-round gate).
 *
 * Orthogonally, `pathStyle` decides the two ROOT segments every layout builds
 * on ({@link clusterRoot} / {@link schemaRoot}) — "flat" (default) or the
 * historical "nested". Nothing below the root differs between the styles.
 */
import { createHash } from "node:crypto";
import { buildFactBase, type FactBase } from "../core/fact.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import { plan, type Action } from "../plan/plan.ts";
import type { IntentRuleIndex } from "../plan/rules.ts";
import { extensionMemberReferenceOnly } from "../policy/view.ts";
import { foldCaseCollidingPaths } from "./export-case-collisions.ts";
import type { SqlFile } from "./load-sql-files.ts";
import {
  formatSqlStatements,
  type SqlFormatOptions,
} from "./sql-format/index.ts";

/** Group objects by a name pattern into a named directory/file (v1 parity). */
export interface ExportGroupingPattern {
  /** Regex (as a string) tested against the object's name; first match wins. */
  pattern: string;
  /** Group name used as the directory (subdirectory mode) or file (single-file). */
  name: string;
}

/** v1-parity grouping options, honored only by the "grouped" layout. */
export interface ExportGrouping {
  /** How a matched group is organized on disk (default: "subdirectory"). */
  mode?: "single-file" | "subdirectory";
  /** Name-pattern → group rules; first match wins. */
  groupPatterns?: ExportGroupingPattern[];
  /** Schemas collapsed to one file per category (e.g. schemas/partman/tables.sql). */
  flatSchemas?: string[];
  /** File partition children into their parent table's file (default: true). */
  autoGroupPartitions?: boolean;
}

/**
 * Where the two ROOT segments of an export tree live. Orthogonal to `layout`
 * (every layout composes with both styles), and everything BELOW the root is
 * identical either way.
 *
 * - `"flat"` (default): schema directories sit at the export root
 *   (`app/tables/t.sql`) and cluster-level files under `_cluster/`
 *   (`_cluster/roles.sql`). One level less nesting in the tree users read,
 *   diff, and review.
 * - `"nested"`: the historical `schemas/app/tables/t.sql` + `cluster/roles.sql`
 *   tree, kept as a back-compat escape hatch for callers whose tooling pins
 *   those paths.
 */
export type ExportPathStyle = "flat" | "nested";

export interface ExportOptions {
  layout?: "by-object" | "ordered" | "grouped";
  /** Root-segment layout of the emitted paths (default: `"flat"`).
   *  See {@link ExportPathStyle}. */
  pathStyle?: ExportPathStyle;
  /** Grouping rules for the "grouped" layout; ignored by other layouts. */
  grouping?: ExportGrouping;
  /** Pretty-print each file's SQL with the formatter (frontends/sql-format).
   *  Off by default (output is the renderer's raw SQL). Layout-agnostic.
   *  Advisory/cosmetic — the fidelity gate (load(export) ≡ fb) still holds. */
  format?: SqlFormatOptions;
  /** Non-fatal warnings (e.g. an invalid group-pattern regex). */
  onWarning?: (message: string) => void;
  /** Schemas/roles the active profile assumes present-but-unmanaged at apply
   *  time. Forwarded to the internal `plan()` so its action-graph guard does not
   *  reject a managed-view action that consumes an assumed-but-filtered object
   *  (e.g. `CREATE EXTENSION … SCHEMA extensions`, `GRANT … TO anon`). Empty for
   *  the `raw` profile (no policy) — an identity projection (review P1). */
  assumedSchemas?: string[];
  assumedRoles?: string[];
  /** Intent-rule index from the active profile's handlers (e.g. pg_cron under
   *  `--profile supabase`). Forwarded to the internal `plan()` so an
   *  `extensionIntent` fact in `fb` (a named cron job) renders its replay SQL
   *  instead of throwing "no intent rule registered". Omit for profiles with no
   *  intent handlers. */
  intentRules?: IntentRuleIndex;
}

/** Longest filename COMPONENT most filesystems accept (ext4/APFS/NTFS). The
 *  ordered layout flattens a whole path into one component, and dot encoding
 *  can triple a dot-heavy identifier's length — two 63-byte identifiers full
 *  of dots overflow this limit (PR #368 review). Every seg()-encoded name is
 *  pure ASCII, so string length equals byte length. */
const MAX_FILENAME_LENGTH = 255;

/** Clamp an over-long flattened name to a deterministic truncate+hash tail,
 *  preserving the `.sql` suffix the loader discovers by. Uniqueness holds
 *  because the ordered layout's sequence prefix survives the truncation. */
function clampFileName(name: string): string {
  if (name.length <= MAX_FILENAME_LENGTH) return name;
  const hash = createHash("sha256").update(name, "utf8").digest("hex");
  const tail = `-${hash.slice(0, 16)}.sql`;
  return `${name.slice(0, MAX_FILENAME_LENGTH - tail.length)}${tail}`;
}

/** Assemble a file's SQL from bare (semicolon-less) statements: optionally
 *  pretty-print them, then re-attach `;` and join. Centralizes the
 *  format-or-not decision so every layout formats identically. */
function renderFileSql(
  bareStatements: string[],
  format: SqlFormatOptions | undefined,
): string {
  const statements = format
    ? formatSqlStatements(bareStatements, format)
    : bareStatements;
  return `${statements.map((s) => `${s};`).join("\n\n")}\n`;
}

/** The subject deciding an action's file: produced fact, else consumed. */
function subjectOf(action: Action): StableId | undefined {
  return action.produces[0] ?? action.consumes[0];
}

/** Satellite facts (comment/acl) file with their target. */
function fileTarget(id: StableId): StableId {
  if (id.kind === "comment" || id.kind === "acl") {
    return fileTarget((id as { target: StableId }).target);
  }
  return id;
}

/** Like {@link fileTarget} but also unwraps securityLabel — used for category
 *  classification in the grouped layout (kept out of the by-object path). */
function groupingTarget(id: StableId): StableId {
  if (
    id.kind === "comment" ||
    id.kind === "acl" ||
    id.kind === "securityLabel"
  ) {
    return groupingTarget((id as { target: StableId }).target);
  }
  return id;
}

/** Semantic file categories, in the fixed emission order the grouped layout
 *  uses (ported + extended from the v1 exporter). */
const CATEGORY_ORDER = [
  "cluster",
  "schema",
  "extensions",
  "types",
  "domains",
  "collations",
  "sequences",
  "tables",
  "indexes",
  "foreign_tables",
  "views",
  "matviews",
  "functions",
  "procedures",
  "aggregates",
  "publications",
  "subscriptions",
  "event_triggers",
  "misc",
] as const;
type Category = (typeof CATEGORY_ORDER)[number];
const CATEGORY_PRIORITY: Record<Category, number> = Object.fromEntries(
  CATEGORY_ORDER.map((c, i) => [c, i]),
) as Record<Category, number>;

/** Stable-id kind → category. Table-scoped satellites and indexes map to where
 *  their DDL is filed, so a file holds one category. */
const CATEGORY_OF_KIND: Record<string, Category> = {
  role: "cluster",
  membership: "cluster",
  defaultPrivilege: "cluster",
  fdw: "cluster",
  server: "cluster",
  userMapping: "cluster",
  publication: "publications",
  // membership facts normally inline into CREATE PUBLICATION, but they emit
  // standalone ALTER PUBLICATION … ADD when the parent publication is
  // reference-only (an assumed platform publication, e.g. supabase_realtime)
  publicationRel: "publications",
  publicationSchema: "publications",
  subscription: "subscriptions",
  eventTrigger: "event_triggers",
  extension: "extensions",
  schema: "schema",
  type: "types",
  domain: "domains",
  collation: "collations",
  sequence: "sequences",
  table: "tables",
  column: "tables",
  default: "tables",
  constraint: "tables",
  trigger: "tables",
  policy: "tables",
  rule: "tables",
  index: "indexes",
  foreignTable: "foreign_tables",
  view: "views",
  materializedView: "matviews",
  function: "functions",
  procedure: "procedures",
  aggregate: "aggregates",
};

function categoryOf(id: StableId): Category {
  return CATEGORY_OF_KIND[groupingTarget(id).kind] ?? "misc";
}

/** The schema + grouping name of an object, or `undefined` schema for
 *  cluster-level objects (which the grouped layout never regroups). */
function schemaAndName(id: StableId): {
  schema?: string;
  objectName?: string;
} {
  const t = groupingTarget(id);
  if (t.kind === "schema") {
    const name = (t as { name: string }).name;
    return { schema: name, objectName: name };
  }
  // table-scoped satellites group under their owning table's name
  if (TABLE_SCOPED.has(t.kind)) {
    const s = t as { schema: string; table: string };
    return { schema: s.schema, objectName: s.table };
  }
  if ("schema" in t && "name" in t) {
    const s = t as { schema: string; name: string };
    return { schema: s.schema, objectName: s.name };
  }
  return {};
}

/** If the action's table is a partition child, the parent table's name. */
function partitionParentName(id: StableId, fb: FactBase): string | undefined {
  const t = groupingTarget(id);
  let tableId: StableId | undefined;
  if (t.kind === "table") {
    tableId = t;
  } else if (TABLE_SCOPED.has(t.kind)) {
    const s = t as { schema: string; table: string };
    tableId = { kind: "table", schema: s.schema, name: s.table };
  }
  if (tableId === undefined) return undefined;
  const payload = fb.get(tableId)?.payload as
    | { partitionBound?: unknown; parentTable?: { name: string } | null }
    | undefined;
  if (
    payload?.partitionBound != null &&
    payload.parentTable != null &&
    typeof payload.parentTable.name === "string"
  ) {
    return payload.parentTable.name;
  }
  return undefined;
}

const VERB_PRIORITY: Record<string, number> = { create: 0, alter: 1, drop: 2 };
function scopeRank(id: StableId): number {
  switch (id.kind) {
    case "comment":
      return 1;
    case "securityLabel":
      return 2;
    case "acl":
      return 3;
    case "defaultPrivilege":
      return 4;
    case "membership":
      return 5;
    default:
      return 0;
  }
}

/** Cluster-level file names, RELATIVE to {@link clusterRoot}. */
const CLUSTER_FILES: Record<string, string> = {
  role: "roles.sql",
  membership: "roles.sql",
  defaultPrivilege: "roles.sql",
  fdw: "foreign_data_wrappers.sql",
  server: "foreign_data_wrappers.sql",
  userMapping: "foreign_data_wrappers.sql",
  publication: "publications.sql",
  publicationRel: "publications.sql",
  publicationSchema: "publications.sql",
  subscription: "subscriptions.sql",
  eventTrigger: "event_triggers.sql",
};

const SCHEMA_DIRS: Record<string, string> = {
  type: "types",
  domain: "domains",
  collation: "collations",
  sequence: "sequences",
  table: "tables",
  view: "views",
  materializedView: "materialized_views",
  foreignTable: "foreign_tables",
  function: "functions",
  procedure: "functions",
  aggregate: "functions",
};

/** Table-scoped satellites write into their table's file. */
const TABLE_SCOPED = new Set([
  "column",
  "default",
  "constraint",
  "trigger",
  "policy",
  "rule",
]);

/**
 * Make a database identifier safe as a single path segment: PostgreSQL names
 * can contain `/`, `\`, `..`, and other path-significant characters, which
 * would otherwise let an object name escape the output directory or collide
 * with `.`/`..` (review P2). encodeURIComponent handles separators reversibly;
 * every DOT is additionally encoded (`%2E`) so an identifier can never spoof
 * the code-reserved `.sql` / `.fk.sql` suffixes: a table named `Foo.fk` would
 * otherwise export to `Foo.fk.sql` — case-folding into another table's
 * cyclic-FK split file and wrongly receiving the split header — and a group
 * name like `schema.sql` would become a DIRECTORY ending in `.sql`, prefix
 * colliding with a real file (PR #368 review). This also covers dot-only
 * segments (`.`, `..`). Ordinary identifiers (alphanumerics + `_`) pass
 * through unchanged, so the common export layout is unaffected.
 */
function seg(name: string): string {
  return clampSegment(encodeURIComponent(name).replaceAll(".", "%2E"));
}

/** Longest encoded SEGMENT the exporter emits, leaving room for the code
 *  appended suffixes (`.sql`, `.fk.sql`) under the 255-byte filesystem
 *  component limit. Identifiers (≤63 bytes → ≤189 encoded) never hit this;
 *  GROUP NAMES come from user config and are unbounded — a dot-rich name
 *  grows ~3x under dot encoding and overflowed the limit (ENAMETOOLONG,
 *  PR #368 review). Encoded segments are pure ASCII, so string length equals
 *  byte length. */
const MAX_SEGMENT_LENGTH = 240;

/** Deterministic truncate+hash clamp for an over-long encoded segment. */
function clampSegment(segment: string): string {
  if (segment.length <= MAX_SEGMENT_LENGTH) return segment;
  const hash = createHash("sha256").update(segment, "utf8").digest("hex");
  return `${segment.slice(0, MAX_SEGMENT_LENGTH - 17)}-${hash.slice(0, 16)}`;
}

/**
 * Root-level directory names the export tree owns under the `"flat"` style,
 * where SCHEMA directories are root-level too and could otherwise claim one:
 *
 * - `_cluster` holds the cluster-level files this module emits (roles,
 *   publications, extensions, …);
 * - `_custom` is the reserved hand-authored-SQL directory (custom-dir.ts):
 *   the exporter must never write into it (the CLI turns a collision into a
 *   hard error) and the pruner never scans it, so a schema claiming it would
 *   make the export unwritable. Kept as a literal rather than an import so the
 *   pure path layer stays free of the fs-touching module; `_custom` is not
 *   reserved under `"nested"`, where the `schemas/` wrapper separates the two
 *   namespaces (export-path-style.test.ts pins that the two names agree).
 *
 * Matching is exact and case-SENSITIVE: `_CLUSTER` keeps its own spelling and
 * is handled downstream by the case-collision fold (export-case-collisions.ts),
 * which merges the twin roots into one spelling and reports it.
 */
export const RESERVED_ROOT_SEGMENTS: ReadonlySet<string> = new Set([
  "_cluster",
  "_custom",
]);

/** Root directory of the cluster-level files, for a path style. */
function clusterRoot(style: ExportPathStyle): string {
  return style === "flat" ? "_cluster" : "cluster";
}

/**
 * Root directory of a SCHEMA's files, for a path style. Under `"flat"` a
 * schema whose encoded segment is exactly a {@link RESERVED_ROOT_SEGMENTS}
 * name percent-encodes its leading underscore (`_cluster` → `%5Fcluster`), so
 * it can never claim a directory the export tree owns. `%` itself is escaped
 * by `encodeURIComponent`, so no other identifier can ever encode to the
 * escaped spelling — the escape is injective. Other underscore-prefixed
 * schemas (`_foo`) are untouched.
 */
function schemaRoot(style: ExportPathStyle, schema: string): string {
  const segment = seg(schema);
  if (style === "nested") return `schemas/${segment}`;
  return RESERVED_ROOT_SEGMENTS.has(segment)
    ? `%5F${segment.slice(1)}`
    : segment;
}

/** Precomputed routing context threaded through {@link pathFor}: the cyclic-FK
 *  split set, the extension-member map, the index→relation parent map, the
 *  relation-kind map, and the concurrent-index exception set. Built once per
 *  export. */
interface PathContext {
  /** Root-segment style of every path built here ({@link ExportPathStyle}). */
  readonly pathStyle: ExportPathStyle;
  /** Encoded ids of cycle-participating FK constraints (→ `.fk.sql`). */
  readonly cyclicFks: ReadonlySet<string>;
  /** Encoded extension-member object id → owning extension name. Satellites
   *  (acl/comment) targeting a member route to the extension's own file. */
  readonly memberExt: ReadonlyMap<string, string>;
  /** Encoded index id → its owning relation's file dir + name (from the index
   *  fact's parent link): indexes CO-LOCATE with their table / matview file. */
  readonly indexParent: ReadonlyMap<string, { dir: string; name: string }>;
  /** `schema\u0000name` → file dir for the relation ("views" /
   *  "materialized_views"); absent = "tables". Routes a TABLE_SCOPED satellite
   *  (an INSTEAD OF trigger on a view, a rule) to its actual relation's file. */
  readonly relationDir: ReadonlyMap<string, string>;
  /** Encoded ids of indexes whose rendered SQL is CREATE INDEX CONCURRENTLY —
   *  non-transactional statements must stay ALONE in their file (loader
   *  contract), so these keep their own `indexes/<name>.sql` path. */
  readonly concurrentIndexes: ReadonlySet<string>;
}

/** Encoded member object id → owning extension name, from the
 *  `memberOfExtension` edges extraction records. */
function extensionMembersByEncoded(fb: FactBase): Map<string, string> {
  const map = new Map<string, string>();
  for (const edge of fb.edges) {
    if (edge.kind !== "memberOfExtension") continue;
    if (edge.to.kind !== "extension") continue;
    map.set(encodeId(edge.from), (edge.to as { name: string }).name);
  }
  return map;
}

/** Encoded index id → owning relation (dir + name), from the index facts'
 *  parent links (extraction records the table / materialized view as the
 *  index's parent). */
function indexParentsByEncoded(
  fb: FactBase,
): Map<string, { dir: string; name: string }> {
  const map = new Map<string, { dir: string; name: string }>();
  for (const fact of fb.facts()) {
    if (fact.id.kind !== "index" || fact.parent === undefined) continue;
    const parent = fact.parent as { kind: string; name?: string };
    if (typeof parent.name !== "string") continue;
    map.set(encodeId(fact.id), {
      dir: parent.kind === "materializedView" ? "materialized_views" : "tables",
      name: parent.name,
    });
  }
  return map;
}

/** `schema\u0000name` → file dir for VIEW / MATERIALIZED VIEW relations, so a
 *  TABLE_SCOPED satellite naming that relation routes to the right file. */
function relationDirsByName(fb: FactBase): Map<string, string> {
  const map = new Map<string, string>();
  for (const fact of fb.facts()) {
    if (fact.id.kind !== "view" && fact.id.kind !== "materializedView") {
      continue;
    }
    const id = fact.id as { schema: string; name: string };
    map.set(
      nameKey(id.schema, id.name),
      fact.id.kind === "view" ? "views" : "materialized_views",
    );
  }
  return map;
}

/** Explanatory header prepended to every split `.fk.sql` file. */
const FK_SPLIT_HEADER =
  "-- Foreign keys in a cross-table reference cycle are split out of their\n" +
  "-- table's file: each file loads atomically, so keeping them inline would\n" +
  "-- deadlock the loader (every file would need a table another pending file\n" +
  "-- creates). These statements apply once all referenced tables exist.\n\n";

/** Join a schema-qualified relation name into an opaque map key. NUL
 *  (backslash-u0000) cannot appear in an identifier, so keys are
 *  collision-free (a space separator could collide: "a b"+"c" vs
 *  "a"+"b c"). EVERY producer and consumer of these keys goes through
 *  this helper. */
function nameKey(schema: string, name: string): string {
  return `${schema}\u0000${name}`;
}

/** The owning table of a table-scoped (or table) id, as an opaque key. */
function owningTableKey(id: StableId): string | undefined {
  if (id.kind === "table") {
    const t = id as { schema: string; name: string };
    return nameKey(t.schema, t.name);
  }
  if (TABLE_SCOPED.has(id.kind)) {
    const t = id as unknown as { schema: string; table: string };
    return nameKey(t.schema, t.table);
  }
  return undefined;
}

/**
 * Encoded ids of FOREIGN KEY constraints that participate in a cross-table
 * reference CYCLE (mutual FKs, or a longer loop). ONLY these move to a sibling
 * `<table>.fk.sql`: export files apply atomically, so a reference cycle across
 * table files can never load (each file needs a table another un-committed file
 * creates), while every ACYCLIC FK resolves through the loader's bounded retry
 * and stays inline in its table's file for readability.
 *
 * Reference edges come from extraction's pg_depend edges (an FK constraint
 * `depends` on the referenced table's columns / unique constraint), so no SQL
 * is parsed here. Cycle test: Tarjan SCC over the table-reference graph — an FK
 * is cyclic iff its owning table and a referenced table share a component.
 *
 * The cycle test runs at TWO grains and unions the results (PR #368 review):
 * - RAW table keys — mutual FKs between distinctly-spelled tables, including
 *   the twins themselves (`"Foo"` ⇄ `"foo"`): folding alone would erase that
 *   mutual reference as a self-edge, leaving both FKs inline in the merged
 *   file, which could then never apply (each CREATE references the twin the
 *   same file has not created yet).
 * - CASE-FOLDED keys — case-twin tables merge into one physical file
 *   (export-case-collisions.ts) and the atomic unit at load time is the
 *   FILE, so an FK chain acyclic at table grain (`"Foo"` → helper → `"foo"`)
 *   is a real cycle at file grain. Folding the RAW names is conservative for
 *   non-ASCII identifiers (it can contract twins whose percent-encoded paths
 *   would not actually merge) — the cost is an unnecessary `.fk.sql` split,
 *   never a wedged load.
 * A genuine self-referential FK (a table referencing itself) is skipped at
 * both grains via the RAW comparison and stays inline, where it is valid.
 */
function cyclicForeignKeys(fb: FactBase): Set<string> {
  interface Fk {
    encoded: string;
    owner: string;
    refs: Set<string>;
  }
  const fks = new Map<string, Fk>();
  for (const fact of fb.facts()) {
    if (fact.id.kind !== "constraint") continue;
    if ((fact.payload as { type?: unknown }).type !== "f") continue;
    const owner = owningTableKey(fact.id);
    if (owner === undefined) continue;
    const encoded = encodeId(fact.id);
    fks.set(encoded, { encoded, owner, refs: new Set() });
  }
  if (fks.size === 0) return new Set();

  // table-reference graph on RAW keys: owner → referenced table, per FK edge
  const adjacency = new Map<string, Set<string>>();
  for (const edge of fb.edges) {
    const fk = fks.get(encodeId(edge.from));
    if (fk === undefined) continue;
    const ref = owningTableKey(edge.to);
    // RAW comparison: only a genuine self-reference is dropped — a case-twin
    // reference is a distinct table and must stay a graph edge.
    if (ref === undefined || ref === fk.owner) continue;
    fk.refs.add(ref);
    let targets = adjacency.get(fk.owner);
    if (targets === undefined) {
      targets = new Set();
      adjacency.set(fk.owner, targets);
    }
    targets.add(ref);
  }

  // the same graph contracted to case-folded keys (file grain)
  const foldedAdjacency = new Map<string, Set<string>>();
  for (const [owner, targets] of adjacency) {
    const foldedOwner = owner.toLowerCase();
    let folded = foldedAdjacency.get(foldedOwner);
    if (folded === undefined) {
      folded = new Set();
      foldedAdjacency.set(foldedOwner, folded);
    }
    for (const target of targets) {
      const foldedTarget = target.toLowerCase();
      // an edge WITHIN a contracted node (twin ⇄ twin) is intra-file; the
      // raw grain already classifies it
      if (foldedTarget !== foldedOwner) folded.add(foldedTarget);
    }
  }

  const rawScc = stronglyConnectedComponents(adjacency);
  const foldedScc = stronglyConnectedComponents(foldedAdjacency);

  const cyclic = new Set<string>();
  for (const fk of fks.values()) {
    const ownerRawScc = rawScc.get(fk.owner);
    const ownerFoldedScc = foldedScc.get(fk.owner.toLowerCase());
    for (const ref of fk.refs) {
      const rawCyclic =
        ownerRawScc !== undefined && rawScc.get(ref) === ownerRawScc;
      // a reference to the owner's own case twin is intra-file at folded
      // grain but still a real forward reference the merged file cannot
      // satisfy inline — treat it as cyclic (the twins' CREATEs and their
      // mutual FKs cannot all inline in one atomic file)
      const twinRef =
        ref.toLowerCase() === fk.owner.toLowerCase() && ref !== fk.owner;
      const foldedCyclic =
        !twinRef &&
        ownerFoldedScc !== undefined &&
        foldedScc.get(ref.toLowerCase()) === ownerFoldedScc;
      if (rawCyclic || foldedCyclic || twinRef) {
        cyclic.add(fk.encoded);
        break;
      }
    }
  }
  return cyclic;
}

/** Tarjan SCC (iterative — no recursion-depth ceiling on large schemas):
 *  node → component index, over `adjacency` and every node it mentions. */
function stronglyConnectedComponents(
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, number> {
  const sccOf = new Map<string, number>();
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let counter = 0;
  let sccCount = 0;
  const nodes = new Set<string>(adjacency.keys());
  for (const targets of adjacency.values()) {
    for (const t of targets) nodes.add(t);
  }
  interface Frame {
    node: string;
    neighbors: string[];
    i: number;
  }
  const visit = (frames: Frame[], node: string): void => {
    index.set(node, counter);
    low.set(node, counter);
    counter++;
    stack.push(node);
    onStack.add(node);
    frames.push({ node, neighbors: [...(adjacency.get(node) ?? [])], i: 0 });
  };
  for (const root of nodes) {
    if (index.has(root)) continue;
    const frames: Frame[] = [];
    visit(frames, root);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      if (frame.i < frame.neighbors.length) {
        const next = frame.neighbors[frame.i++]!;
        if (!index.has(next)) {
          visit(frames, next);
        } else if (onStack.has(next)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(next)!));
        }
      } else {
        frames.pop();
        const parent = frames[frames.length - 1];
        if (parent !== undefined) {
          low.set(
            parent.node,
            Math.min(low.get(parent.node)!, low.get(frame.node)!),
          );
        }
        if (low.get(frame.node) === index.get(frame.node)) {
          let member: string;
          do {
            member = stack.pop()!;
            onStack.delete(member);
            sccOf.set(member, sccCount);
          } while (member !== frame.node);
          sccCount++;
        }
      }
    }
  }
  return sccOf;
}

/**
 * Detect multi-file dependency cycles CREATED by case-twin folding and merge
 * each into ONE file. Export files apply atomically under the raw loader's
 * bounded retry, so a dependency cycle across files can never load. FK-only
 * cycles are split into `.fk.sql` post-data files ({@link cyclicForeignKeys},
 * whose graph is contracted to the same file grain) — but a NON-FK cycle,
 * e.g. case-twin VIEWS with an interposed view (`"Foo"` selects helper,
 * helper selects `"foo"`), has no deferrable ALTER to split out: the only
 * loadable shape is the whole cycle in one file, statements in plan order
 * (PR #368 review). Only components containing a fold destination are
 * touched — the export produces no multi-file cycles otherwise; if one
 * somehow exists it is reported and left unchanged.
 *
 * @returns path → merge target (the component's lexicographically smallest
 *          member); identity mappings are absent.
 */
function mergeDependencyCycles(
  fb: FactBase,
  idToPath: (id: StableId) => string,
  emittedPaths: ReadonlySet<string>,
  foldDestinations: ReadonlySet<string>,
  onWarning?: (message: string) => void,
): Map<string, string> {
  if (foldDestinations.size === 0) return new Map();
  const adjacency = new Map<string, Set<string>>();
  for (const edge of fb.edges) {
    const from = idToPath(edge.from);
    const to = idToPath(edge.to);
    if (from === to) continue;
    if (!emittedPaths.has(from) || !emittedPaths.has(to)) continue;
    let targets = adjacency.get(from);
    if (targets === undefined) {
      targets = new Set();
      adjacency.set(from, targets);
    }
    targets.add(to);
  }
  if (adjacency.size === 0) return new Map();

  const sccOf = stronglyConnectedComponents(adjacency);
  const componentMembers = new Map<number, string[]>();
  for (const [path, component] of sccOf) {
    const members = componentMembers.get(component);
    if (members === undefined) {
      componentMembers.set(component, [path]);
    } else {
      members.push(path);
    }
  }

  const merges = new Map<string, string>();
  for (const members of componentMembers.values()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const list = sorted.map((p) => `"${p}"`).join(", ");
    if (!sorted.some((path) => foldDestinations.has(path))) {
      onWarning?.(
        `export files ${list} form a dependency cycle the file-atomic ` +
          `loader cannot apply; leaving them unchanged (the cycle is not ` +
          `caused by case-collision merging)`,
      );
      continue;
    }
    const target = sorted[0]!;
    onWarning?.(
      `export files ${list} form a dependency cycle once case twins merge; ` +
        `combining them into "${target}" so every file stays loadable`,
    );
    for (const path of sorted) {
      if (path !== target) merges.set(path, target);
    }
  }
  return merges;
}

function pathFor(id: StableId, ctx: PathContext): string {
  const target = fileTarget(id);
  const kind = target.kind;
  const cluster = clusterRoot(ctx.pathStyle);
  // A satellite (acl/comment, unwrapped by fileTarget) whose target is an
  // EXTENSION MEMBER files into the owning extension's file, next to its
  // CREATE EXTENSION. Member objects themselves never yield actions
  // (reference-only), so only satellites reach this branch. Keeps a real DB
  // with e.g. pgTAP from sprouting hundreds of REVOKE-only function files —
  // the state stays fully managed, only its file placement changes.
  const memberExtension = ctx.memberExt.get(encodeId(target));
  if (memberExtension !== undefined) {
    return `${cluster}/extensions/${seg(memberExtension)}.sql`;
  }
  // A schema-scoped ALTER DEFAULT PRIVILEGES depends on its schema, so it must
  // NOT share the atomic cluster/roles.sql file with CREATE ROLE: with reorder
  // disabled (any ADP present) the raw loader would roll the role back when the
  // ADP fails on the not-yet-created schema. File it under the schema instead,
  // where the loader's defer-and-retry converges (review P2). A global ADP
  // (schema null) has no such dependency and stays with the roles.
  if (kind === "defaultPrivilege") {
    const schema = (target as { schema: string | null }).schema;
    if (schema !== null) {
      return `${schemaRoot(ctx.pathStyle, schema)}/default_privileges.sql`;
    }
  }
  const clusterFile = CLUSTER_FILES[kind];
  if (clusterFile !== undefined) return `${cluster}/${clusterFile}`;
  if (kind === "extension") {
    return `${cluster}/extensions/${seg((target as { name: string }).name)}.sql`;
  }
  if (kind === "schema") {
    const name = (target as { name: string }).name;
    return `${schemaRoot(ctx.pathStyle, name)}/schema.sql`;
  }
  if (TABLE_SCOPED.has(kind)) {
    const t = target as { schema: string; table: string };
    // A foreign key participating in a cross-table reference CYCLE cannot stay
    // in its table's file: the loader applies each file atomically, so two
    // mutually-referencing tables would each need a table the other
    // un-committed file creates, and neither could ever commit. Those FKs —
    // and their comment/acl satellites, already unwrapped by `fileTarget` —
    // move to a sibling `<table>.fk.sql` loaded once all referenced tables
    // exist (pg_dump's post-data precedent). ACYCLIC FKs (the common case)
    // stay INLINE for readability — the loader's bounded retry orders their
    // files. `cyclicFks` is precomputed by {@link cyclicForeignKeys}.
    if (target.kind === "constraint" && ctx.cyclicFks.has(encodeId(target))) {
      return `${schemaRoot(ctx.pathStyle, t.schema)}/tables/${seg(t.table)}.fk.sql`;
    }
    // The `table` field of a TABLE_SCOPED id names a RELATION, not necessarily
    // a table: an INSTEAD OF trigger / rule / comment can target a view or a
    // materialized view — file those with their actual relation.
    const relationDir =
      ctx.relationDir.get(nameKey(t.schema, t.table)) ?? "tables";
    return `${schemaRoot(ctx.pathStyle, t.schema)}/${relationDir}/${seg(t.table)}.sql`;
  }
  if (kind === "index") {
    const t = target as { schema: string; name: string };
    // Indexes CO-LOCATE with their owning relation's file (old-engine
    // behavior, restored for readability) — the owning table / matview comes
    // from the index fact's parent link. EXCEPT a CREATE INDEX CONCURRENTLY
    // (only rendered under the opt-in `concurrentIndexes` param): it is
    // non-transactional and must stay ALONE in its file (loader contract).
    const parent = ctx.indexParent.get(encodeId(target));
    const root = schemaRoot(ctx.pathStyle, t.schema);
    if (parent !== undefined && !ctx.concurrentIndexes.has(encodeId(target))) {
      return `${root}/${parent.dir}/${seg(parent.name)}.sql`;
    }
    return `${root}/indexes/${seg(t.name)}.sql`;
  }
  const dir = SCHEMA_DIRS[kind];
  if (dir !== undefined) {
    const t = target as { schema: string; name: string };
    return `${schemaRoot(ctx.pathStyle, t.schema)}/${dir}/${seg(t.name)}.sql`;
  }
  return `${cluster}/misc.sql`;
}

export function exportSqlFiles(
  fb: FactBase,
  options: ExportOptions = {},
): SqlFile[] {
  const layout = options.layout ?? "by-object";
  const pathStyle = options.pathStyle ?? "flat";
  // Render against a PRISTINE baseline, not absolute emptiness, so the export
  // reflects what a real target already has:
  //   - schema "public" always exists, so seed its EXISTENCE (a CREATE SCHEMA
  //     public could never replay). Its acl/comment are deliberately NOT seeded:
  //     they diff like every other schema's, so a customized public (REVOKE
  //     CREATE FROM PUBLIC, a changed COMMENT) is exported rather than masked by
  //     a same-valued baseline (review: public-schema ACL/comment preservation).
  //   - reference-only facts are assumed-present platform objects (e.g.
  //     auth.users under --profile supabase). diff/plan don't consult
  //     `referenceOnly` — the DB-to-DB path relies on both sides carrying them —
  //     but the from-pristine export has no such symmetry, so seed them here.
  //     Then a managed child kept in the view (a user trigger on auth.users)
  //     resolves its requirement against the baseline instead of throwing
  //     "missing requirement", and the assumed parent is not itself recreated
  //     (review #3501088189).
  //
  //     EXCEPT extension members (net.http_get, partman.part_config): they must
  //     NOT be seeded. A member's parent — the install schema — can be a MANAGED
  //     fact this export recreates (e.g. `partman`); seeding the member without
  //     its ancestor throws "missing parent" in buildFactBase (Codex #3537607461),
  //     and seeding the ancestor too would suppress its own CREATE SCHEMA
  //     (buildFactBase seeds existence → diff skips it), breaking `CREATE EXTENSION
  //     … WITH SCHEMA` reload. Members need no seeding regardless: `CREATE EXTENSION`
  //     materializes them and the planner's requirement guard satisfies any
  //     consumer via `memberExtensionPresent` (a member satellite — a user
  //     GRANT/COMMENT on a member — still exports, its requirement met the same
  //     way). Assumed-schema facts stay seeded: that category is parent-closed
  //     (the schema fact is itself reference-only), so no dangling parent arises.
  const members = extensionMemberReferenceOnly(fb);
  const pristine = fb.facts().filter((fact) => {
    const id = fact.id;
    if (id.kind === "schema" && (id as { name: string }).name === "public")
      return true;
    const key = encodeId(id);
    return fb.referenceOnly.has(key) && !members.has(key);
  });
  const baseline = buildFactBase(pristine, []);
  // FKs inside a cross-table reference cycle stay as ALTERs (routed to a
  // sibling `.fk.sql`); everything else folds inline. Computed BEFORE the plan
  // so the fold pass can exclude them.
  const cyclicFks = cyclicForeignKeys(fb);
  // `fb` is the already-resolved managed view, so we do NOT re-run policy
  // filtering / serialize rules here; we only forward the assumed schema/role
  // sets so the requirement guard exempts actions consuming assumed-but-filtered
  // objects (review P1). `foldConstraints` renders validated table constraints
  // INLINE in their CREATE TABLE (export files are consumed by the retry /
  // reorder loader, where that is safe — see PlanOptions.foldConstraints).
  const rendered = plan(baseline, fb, {
    foldConstraints: { exclude: cyclicFks },
    ...(options.assumedSchemas !== undefined
      ? { assumedSchemas: options.assumedSchemas }
      : {}),
    ...(options.assumedRoles !== undefined
      ? { assumedRoles: options.assumedRoles }
      : {}),
    ...(options.intentRules !== undefined
      ? { intentRules: options.intentRules }
      : {}),
  });

  // Routing context, computed once per export: the cyclic-FK split set (empty
  // for ~all schemas), the extension-member map (satellites on members file
  // with their extension), the index→relation parent map (co-location), the
  // relation-kind map (satellites on views), and the concurrent-index
  // exception set (must stay alone in their file).
  const pathContext: PathContext = {
    pathStyle,
    cyclicFks,
    memberExt: extensionMembersByEncoded(fb),
    indexParent: indexParentsByEncoded(fb),
    relationDir: relationDirsByName(fb),
    concurrentIndexes: new Set(
      rendered.actions
        .filter(
          (a) =>
            a.produces[0]?.kind === "index" && /\bCONCURRENTLY\b/i.test(a.sql),
        )
        .map((a) => encodeId(a.produces[0]!)),
    ),
  };

  if (layout === "grouped") {
    return exportGrouped(rendered.actions, fb, options, pathContext);
  }

  // Each action's file path, in plan order (shared by both layouts below).
  const miscPath = `${clusterRoot(pathStyle)}/misc.sql`;
  const actionPaths = rendered.actions.map((action) => {
    const subject = subjectOf(action);
    return subject === undefined ? miscPath : pathFor(subject, pathContext);
  });

  if (layout === "ordered") {
    // statement-true splitting: runs of CONSECUTIVE same-object actions
    // become one numbered file, so lexicographic discovery IS plan order
    // and the loader converges in a single pass — an object interleaved
    // with its dependencies simply spans several numbered files. Case-twin
    // paths need no folding here: the sequence prefix already makes every
    // file name case-insensitively unique.
    const runs: { path: string; statements: string[] }[] = [];
    rendered.actions.forEach((action, position) => {
      const path = actionPaths[position]!;
      const last = runs[runs.length - 1];
      if (last !== undefined && last.path === path) {
        last.statements.push(action.sql);
      } else {
        runs.push({ path, statements: [action.sql] });
      }
    });
    return runs.map((run, index) => ({
      name: clampFileName(
        `${String(index).padStart(4, "0")}_${run.path.replaceAll("/", "_")}`,
      ),
      sql: renderFileSql(run.statements, options.format),
    }));
  }

  // group statements by file, preserving plan order within AND across
  // groups (first-statement order decides file order). Statements are stored
  // BARE (no trailing `;`) so the optional formatter sees clean input.
  // Case-twin paths (`Users.sql` vs `users.sql`) are one physical file on
  // APFS/NTFS — fold each colliding set to its canonical spelling so the
  // twins SHARE a file instead of silently overwriting each other (#365).
  const folds = foldCaseCollidingPaths(actionPaths, options.onWarning);
  const foldedPaths = actionPaths.map((p) => folds.get(p) ?? p);
  // a dependency cycle the fold created (case-twin views around an interposed
  // view) must collapse into ONE file — a no-op when nothing folded.
  const cycleMerges = mergeDependencyCycles(
    fb,
    (id) => {
      const raw = pathFor(id, pathContext);
      return folds.get(raw) ?? raw;
    },
    new Set(foldedPaths),
    new Set(folds.values()),
    options.onWarning,
  );
  const files = new Map<string, { firstAt: number; statements: string[] }>();
  rendered.actions.forEach((action, position) => {
    const folded = foldedPaths[position]!;
    const path = cycleMerges.get(folded) ?? folded;
    const entry = files.get(path) ?? { firstAt: position, statements: [] };
    entry.statements.push(action.sql);
    files.set(path, entry);
  });

  const ordered = [...files.entries()].sort(
    (a, b) => a[1].firstAt - b[1].firstAt,
  );
  return ordered.map(([path, entry]) => ({
    name: path,
    sql:
      (path.endsWith(".fk.sql") ? FK_SPLIT_HEADER : "") +
      renderFileSql(entry.statements, options.format),
  }));
}

interface CompiledPattern {
  regex: RegExp;
  name: string;
}

function compilePatterns(
  patterns: ExportGroupingPattern[],
  onWarning?: (message: string) => void,
): CompiledPattern[] {
  const compiled: CompiledPattern[] = [];
  for (const p of patterns) {
    try {
      compiled.push({ regex: new RegExp(p.pattern), name: p.name });
    } catch (error) {
      onWarning?.(
        `ignoring invalid group-pattern /${p.pattern}/: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return compiled;
}

/**
 * The "grouped" layout (v1 parity): order files by semantic category rather than
 * plan order, sort statements within a file for readability, and apply opt-in
 * grouping — flat schemas, partition-with-parent, and name patterns. Fidelity is
 * still the gate (the loader's retry rounds absorb the non-dependency order).
 */
function exportGrouped(
  actions: Action[],
  fb: FactBase,
  options: ExportOptions,
  pathContext: PathContext,
): SqlFile[] {
  const grouping = options.grouping ?? {};
  const mode = grouping.mode ?? "subdirectory";
  const autoGroupPartitions = grouping.autoGroupPartitions !== false;
  const flatSet = new Set(grouping.flatSchemas ?? []);
  const patterns = compilePatterns(
    grouping.groupPatterns ?? [],
    options.onWarning,
  );

  // Category that FOLLOWS the co-location routing: an index takes its owning
  // relation's category (tables / matviews); a TABLE_SCOPED satellite on a
  // view / matview takes that relation's category — so flat-schema collapse
  // keeps co-located statements in the same per-category file as their
  // relation instead of splitting them back out.
  const categoryFor = (id: StableId): Category => {
    const t = groupingTarget(id);
    if (t.kind === "index") {
      const encoded = encodeId(t);
      const parent = pathContext.indexParent.get(encoded);
      if (parent !== undefined && !pathContext.concurrentIndexes.has(encoded)) {
        return parent.dir === "materialized_views" ? "matviews" : "tables";
      }
    }
    if (TABLE_SCOPED.has(t.kind)) {
      const s = t as unknown as { schema: string; table: string };
      const dir = pathContext.relationDir.get(nameKey(s.schema, s.table));
      if (dir === "views") return "views";
      if (dir === "materialized_views") return "matviews";
    }
    return categoryOf(id);
  };

  const style = pathContext.pathStyle;
  const extensionsPrefix = `${clusterRoot(style)}/extensions/`;

  const groupedPath = (id: StableId): string => {
    const base = pathFor(id, pathContext);
    // Cycle-participating FKs keep their sibling `<table>.fk.sql` path in EVERY
    // grouping mode: the flat-schema / name-pattern regrouping below would
    // otherwise fold them back into an atomic per-schema file, re-introducing
    // the mutual-FK load deadlock the split exists to prevent (two flat schemas
    // referencing each other). pathFor routes only cyclic FKs to `.fk.sql`, so
    // the suffix uniquely identifies them.
    if (base.endsWith(".fk.sql")) return base;
    // Satellites routed to an extension's file stay there: their TARGET has a
    // schema (e.g. a pgcrypto function in `public`), so the flat/pattern
    // regrouping below would otherwise pull them back into `schemas/<s>/…`.
    if (base.startsWith(extensionsPrefix)) return base;
    // a CONCURRENTLY index (or one with no resolvable parent) keeps its own
    // indexes/<name>.sql file — flat regrouping would fold the
    // non-transactional statement into an atomic multi-statement file.
    if (base.includes("/indexes/")) return base;
    const { schema, objectName } = schemaAndName(id);
    // cluster-level objects (no schema) are never regrouped
    if (schema === undefined) return base;

    const category = categoryFor(id);
    const root = schemaRoot(style, schema);

    // flat schema: collapse to one file per category (schema.sql stays put)
    if (flatSet.has(schema)) {
      return category === "schema" ? base : `${root}/${category}.sql`;
    }

    // partition child → its parent table's file (co-locate with the parent)
    if (autoGroupPartitions) {
      const parent = partitionParentName(id, fb);
      if (parent !== undefined) {
        return `${root}/tables/${seg(parent)}.sql`;
      }
    }

    // name patterns: first match wins
    if (objectName !== undefined) {
      for (const p of patterns) {
        if (p.regex.test(objectName)) {
          return mode === "single-file"
            ? `${root}/${category}/${seg(p.name)}.sql`
            : `${root}/${seg(p.name)}/${category}.sql`;
        }
      }
    }
    return base;
  };

  interface GroupedFile {
    category: Category;
    items: { sql: string; verbRank: number; scopeRank: number; at: number }[];
  }
  // Case-twin paths fold to one shared file, exactly like the by-object
  // layout (issue #365) — regrouping cannot re-split them because the fold is
  // computed on the final grouped paths.
  const actionPaths = actions.map((action) => {
    const subject = subjectOf(action);
    return subject === undefined
      ? `${clusterRoot(style)}/misc.sql`
      : groupedPath(subject);
  });
  const folds = foldCaseCollidingPaths(actionPaths, options.onWarning);
  const foldedPaths = actionPaths.map((p) => folds.get(p) ?? p);
  // a dependency cycle the fold created collapses into ONE file, exactly as
  // in the by-object layout — a no-op when nothing folded.
  const cycleMerges = mergeDependencyCycles(
    fb,
    (id) => {
      const raw = groupedPath(id);
      return folds.get(raw) ?? raw;
    },
    new Set(foldedPaths),
    new Set(folds.values()),
    options.onWarning,
  );
  const files = new Map<string, GroupedFile>();
  actions.forEach((action, at) => {
    const subject = subjectOf(action);
    const folded = foldedPaths[at]!;
    const path = cycleMerges.get(folded) ?? folded;
    const category = subject === undefined ? "misc" : categoryFor(subject);
    const entry = files.get(path) ?? { category, items: [] };
    entry.items.push({
      sql: action.sql,
      verbRank: VERB_PRIORITY[action.verb] ?? 99,
      scopeRank: subject === undefined ? 0 : scopeRank(subject),
      at,
    });
    files.set(path, entry);
  });

  // file order: category priority, then path (deterministic, not plan order)
  const orderedPaths = [...files.entries()].sort((a, b) => {
    const c =
      CATEGORY_PRIORITY[a[1].category] - CATEGORY_PRIORITY[b[1].category];
    return c !== 0 ? c : a[0].localeCompare(b[0]);
  });

  return orderedPaths.map(([path, entry]) => {
    // within-file order: create→alter, then object→comment→…, stable by position
    const statements = [...entry.items]
      .sort(
        (a, b) =>
          a.verbRank - b.verbRank || a.scopeRank - b.scopeRank || a.at - b.at,
      )
      .map((item) => item.sql);
    return {
      name: path,
      sql:
        (path.endsWith(".fk.sql") ? FK_SPLIT_HEADER : "") +
        renderFileSql(statements, options.format),
    };
  });
}
