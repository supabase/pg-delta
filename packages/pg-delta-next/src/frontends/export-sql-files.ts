/**
 * Declarative export (stage 9 deliverable 6): render a fact base to SQL
 * files via the planner (plan(∅ → fb) — the same renderer as everything
 * else) and split the statements across files by a mapping policy.
 *
 * Two layouts:
 * - "by-object" (default): the human layout users know from the old
 *   engine's exporter — cluster/roles.sql, schemas/<s>/tables/<t>.sql, …
 *   Files within a path are emitted in plan (dependency) order, but the
 *   loader's lexicographic discovery may need its bounded retry rounds for
 *   cross-file references. Fidelity is the gate: load(export(fb)) ≡ fb.
 * - "ordered": file names carry a zero-padded sequence prefix in plan
 *   order, so lexicographic discovery IS dependency order and the loader
 *   converges with zero deferred rounds (the stage-9 zero-round gate).
 */
import { buildFactBase, type FactBase } from "../core/fact.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import { plan, type Action } from "../plan/plan.ts";
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

export interface ExportOptions {
  layout?: "by-object" | "ordered" | "grouped";
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

const CLUSTER_FILES: Record<string, string> = {
  role: "cluster/roles.sql",
  membership: "cluster/roles.sql",
  defaultPrivilege: "cluster/roles.sql",
  fdw: "cluster/foreign_data_wrappers.sql",
  server: "cluster/foreign_data_wrappers.sql",
  userMapping: "cluster/foreign_data_wrappers.sql",
  publication: "cluster/publications.sql",
  subscription: "cluster/subscriptions.sql",
  eventTrigger: "cluster/event_triggers.sql",
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
 * the extra rule encodes dot-only segments (`.`, `..`) which it leaves alone.
 * Ordinary identifiers (alphanumerics + `_`) pass through unchanged, so the
 * common export layout is unaffected.
 */
function seg(name: string): string {
  return encodeURIComponent(name).replace(/^\.+$/, (m) =>
    m.replace(/\./g, "%2E"),
  );
}

function pathFor(id: StableId): string {
  const target = fileTarget(id);
  const kind = target.kind;
  // A schema-scoped ALTER DEFAULT PRIVILEGES depends on its schema, so it must
  // NOT share the atomic cluster/roles.sql file with CREATE ROLE: with reorder
  // disabled (any ADP present) the raw loader would roll the role back when the
  // ADP fails on the not-yet-created schema. File it under the schema instead,
  // where the loader's defer-and-retry converges (review P2). A global ADP
  // (schema null) has no such dependency and stays with the roles.
  if (kind === "defaultPrivilege") {
    const schema = (target as { schema: string | null }).schema;
    if (schema !== null) {
      return `schemas/${seg(schema)}/default_privileges.sql`;
    }
  }
  const clusterFile = CLUSTER_FILES[kind];
  if (clusterFile !== undefined) return clusterFile;
  if (kind === "extension") {
    return `cluster/extensions/${seg((target as { name: string }).name)}.sql`;
  }
  if (kind === "schema") {
    return `schemas/${seg((target as { name: string }).name)}/schema.sql`;
  }
  if (TABLE_SCOPED.has(kind)) {
    const t = target as { schema: string; table: string };
    return `schemas/${seg(t.schema)}/tables/${seg(t.table)}.sql`;
  }
  if (kind === "index") {
    // indexes name only (schema, name) — file them with the schema; their
    // CREATE INDEX statement names the table itself
    const t = target as { schema: string; name: string };
    return `schemas/${seg(t.schema)}/indexes/${seg(t.name)}.sql`;
  }
  const dir = SCHEMA_DIRS[kind];
  if (dir !== undefined) {
    const t = target as { schema: string; name: string };
    return `schemas/${seg(t.schema)}/${dir}/${seg(t.name)}.sql`;
  }
  return "cluster/misc.sql";
}

export function exportSqlFiles(
  fb: FactBase,
  options: ExportOptions = {},
): SqlFile[] {
  const layout = options.layout ?? "by-object";
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
  const pristine = fb.facts().filter((fact) => {
    const id = fact.id;
    if (id.kind === "schema" && (id as { name: string }).name === "public")
      return true;
    return fb.referenceOnly.has(encodeId(id));
  });
  const baseline = buildFactBase(pristine, []);
  // `fb` is the already-resolved managed view, so we do NOT re-run policy
  // filtering / serialize rules here; we only forward the assumed schema/role
  // sets so the requirement guard exempts actions consuming assumed-but-filtered
  // objects (review P1).
  const rendered = plan(baseline, fb, {
    ...(options.assumedSchemas !== undefined
      ? { assumedSchemas: options.assumedSchemas }
      : {}),
    ...(options.assumedRoles !== undefined
      ? { assumedRoles: options.assumedRoles }
      : {}),
  });

  if (layout === "grouped") {
    return exportGrouped(rendered.actions, fb, options);
  }

  // group statements by file, preserving plan order within AND across
  // groups (first-statement order decides file order). Statements are stored
  // BARE (no trailing `;`) so the optional formatter sees clean input.
  const files = new Map<string, { firstAt: number; statements: string[] }>();
  rendered.actions.forEach((action, position) => {
    const subject = subjectOf(action);
    const path = subject === undefined ? "cluster/misc.sql" : pathFor(subject);
    const entry = files.get(path) ?? { firstAt: position, statements: [] };
    entry.statements.push(action.sql);
    files.set(path, entry);
  });

  if (layout === "ordered") {
    // statement-true splitting: runs of CONSECUTIVE same-object actions
    // become one numbered file, so lexicographic discovery IS plan order
    // and the loader converges in a single pass — an object interleaved
    // with its dependencies simply spans several numbered files
    const runs: { path: string; statements: string[] }[] = [];
    rendered.actions.forEach((action) => {
      const subject = subjectOf(action);
      const path =
        subject === undefined ? "cluster/misc.sql" : pathFor(subject);
      const last = runs[runs.length - 1];
      if (last !== undefined && last.path === path) {
        last.statements.push(action.sql);
      } else {
        runs.push({ path, statements: [action.sql] });
      }
    });
    return runs.map((run, index) => ({
      name: `${String(index).padStart(4, "0")}_${run.path.replaceAll("/", "_")}`,
      sql: renderFileSql(run.statements, options.format),
    }));
  }

  const ordered = [...files.entries()].sort(
    (a, b) => a[1].firstAt - b[1].firstAt,
  );
  return ordered.map(([path, entry]) => ({
    name: path,
    sql: renderFileSql(entry.statements, options.format),
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
): SqlFile[] {
  const grouping = options.grouping ?? {};
  const mode = grouping.mode ?? "subdirectory";
  const autoGroupPartitions = grouping.autoGroupPartitions !== false;
  const flatSet = new Set(grouping.flatSchemas ?? []);
  const patterns = compilePatterns(
    grouping.groupPatterns ?? [],
    options.onWarning,
  );

  const groupedPath = (id: StableId): string => {
    const base = pathFor(id);
    const { schema, objectName } = schemaAndName(id);
    // cluster-level objects (no schema) are never regrouped
    if (schema === undefined) return base;

    const category = categoryOf(id);

    // flat schema: collapse to one file per category (schema.sql stays put)
    if (flatSet.has(schema)) {
      return category === "schema"
        ? base
        : `schemas/${seg(schema)}/${category}.sql`;
    }

    // partition child → its parent table's file (co-locate with the parent)
    if (autoGroupPartitions) {
      const parent = partitionParentName(id, fb);
      if (parent !== undefined) {
        return `schemas/${seg(schema)}/tables/${seg(parent)}.sql`;
      }
    }

    // name patterns: first match wins
    if (objectName !== undefined) {
      for (const p of patterns) {
        if (p.regex.test(objectName)) {
          return mode === "single-file"
            ? `schemas/${seg(schema)}/${category}/${seg(p.name)}.sql`
            : `schemas/${seg(schema)}/${seg(p.name)}/${category}.sql`;
        }
      }
    }
    return base;
  };

  interface GroupedFile {
    category: Category;
    items: { sql: string; verbRank: number; scopeRank: number; at: number }[];
  }
  const files = new Map<string, GroupedFile>();
  actions.forEach((action, at) => {
    const subject = subjectOf(action);
    const path =
      subject === undefined ? "cluster/misc.sql" : groupedPath(subject);
    const category = subject === undefined ? "misc" : categoryOf(subject);
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
    return { name: path, sql: renderFileSql(statements, options.format) };
  });
}
