/**
 * One-shot seeder: build tests/porting-ledger.json from the authoritative old
 * test inventory (extracted via AST) reconciled against PORTING.md's per-case
 * tables and top-level "Not ported" file list.
 *
 * This is a dev/maintenance tool, NOT a CI gate — `audit-porting-ledger.ts` is
 * the gate. Re-run it only to regenerate the seed from PORTING.md; afterwards
 * the JSON is edited by hand (and validated by the audit).
 *
 *   bun scripts/seed-porting-ledger.ts            # write the ledger
 *   bun scripts/seed-porting-ledger.ts --dry-run  # report coverage only
 *
 * Reconciliation: every old test (file + testName) gets exactly one entry.
 * - per-case table row in PORTING.md  -> disposition parsed from the row
 * - file only in the "Not ported" list -> file-level not-ported/infra reason
 * - neither                            -> emitted with disposition "not-ported"
 *   and reason "UNMAPPED — not found in PORTING.md" so the gap is explicit and
 *   greppable rather than silently dropped.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Disposition,
  extractAllOldTests,
  type LedgerEntry,
} from "./audit-porting-ledger.ts";

const HERE = new URL(".", import.meta.url).pathname;
const NEXT_ROOT = join(HERE, "..");
const PORTING_MD = join(NEXT_ROOT, "PORTING.md");
const LEDGER_PATH = join(NEXT_ROOT, "tests", "porting-ledger.json");

interface ParsedDisposition {
  disposition: Disposition;
  corpus?: string;
  nextTest?: string;
  reason?: string;
}

const NEXT_TEST_RE = /tests\/([A-Za-z0-9._-]+\.test\.ts)/;
// Agent1-4 write `corpus/<dir>`; agent5-6 write bare `<dir>` in backticks
// (no corpus/ prefix). Capture the first backtick token and strip the prefix.
const CORPUS_BACKTICK_RE = /`(?:corpus\/)?([A-Za-z0-9._-]+\/?)`/;

function firstCorpus(text: string): string | undefined {
  const m = CORPUS_BACKTICK_RE.exec(text)?.[1];
  if (!m) return undefined;
  const name = m.replace(/\/$/, "");
  // Scenario dirs always contain a "--" separator; a bare word in backticks
  // (e.g. `withDbIsolated`) is prose, not a corpus reference.
  return name.includes("--") ? name : undefined;
}

/** Parse a PORTING.md disposition cell into structured form. */
function parseDisposition(raw: string): ParsedDisposition {
  // Agent6 / sensitive-handling rows wrap the keyword in markdown bold
  // (`**ported**`); strip emphasis before matching so they are not all
  // misclassified as not-ported.
  const text = raw.replace(/\*\*/g, "").trim();
  const lower = text.toLowerCase();
  const corpus = firstCorpus(text);
  const nextTest = NEXT_TEST_RE.exec(text)?.[1];

  if (lower.startsWith("ported")) {
    if (corpus) return { disposition: "ported", corpus };
    if (nextTest) return { disposition: "ported", nextTest };
    return { disposition: "ported", reason: text };
  }
  if (lower.startsWith("merged")) {
    return corpus
      ? { disposition: "merged", corpus, reason: text }
      : { disposition: "merged", reason: text };
  }
  if (lower.startsWith("not-ported") || lower.startsWith("not ported")) {
    return { disposition: "not-ported", reason: text };
  }
  // Unknown shape — keep the text as reason and let the audit reason-check pass.
  return { disposition: "not-ported", reason: text };
}

interface PerCaseRow {
  name: string;
  parsed: ParsedDisposition;
}

const DISPOSITION_KW = /^\*{0,2}(ported|merged|not[- ]ported|infra)\b/i;
const HEADER_LABELS = new Set([
  "Test case",
  "Source test",
  "Old file",
  "Test name",
  "Test",
  "#",
  "Status",
  "Disposition",
]);

/**
 * Parse one markdown table row into (name, disposition). PORTING.md uses four
 * layouts across its six agent sections:
 *   | Test case | Disposition |                       (agent1-4)
 *   | Source test | Disposition |                     (agent5-6, view/aggregate)
 *   | # | Test name | Status | Corpus directory |     (FDW)
 *   | Test | Status | Corpus dir / Reason |           (deps-cycles)
 * Rather than special-case each, we treat the cells positionally: drop a
 * leading numeric "#", take the first cell that is NOT a disposition keyword as
 * the test name, and parse the remaining cells (joined) as the disposition.
 */
function parseRow(line: string): PerCaseRow | undefined {
  const cells = line
    .split("|")
    .map((c) => c.trim())
    .filter((c) => c !== "" && !/^-+$/.test(c));
  if (cells.length === 0) return undefined;
  const meaningful = cells.filter((c) => !/^\d+$/.test(c));
  const name = meaningful.find((c) => !DISPOSITION_KW.test(c));
  if (!name || HEADER_LABELS.has(name)) return undefined;
  const dispCells = meaningful.filter((c) => c !== name);
  if (dispCells.length === 0) return undefined;
  return { name, parsed: parseDisposition(dispCells.join(" — ")) };
}

/** Parse all `## <file>.test.ts` per-case tables, grouped by old file. */
function parsePerCaseRows(md: string): Map<string, PerCaseRow[]> {
  const out = new Map<string, PerCaseRow[]>();
  let currentFile: string | undefined;
  for (const line of md.split("\n")) {
    // Agent1-4: "## file.test.ts"; agent5-6: "## file.test.ts (N cases → …)".
    const header = /^##\s+(\S+\.test\.ts)\b/.exec(line);
    if (header) {
      const base = header[1]!;
      currentFile =
        base === "example-usage.test.ts" || base === "postgres-alpine.test.ts"
          ? base
          : `integration/${base}`;
      out.set(currentFile, out.get(currentFile) ?? []);
      continue;
    }
    if (!currentFile || !line.startsWith("|")) continue;
    const row = parseRow(line);
    if (row) out.get(currentFile)!.push(row);
  }
  return out;
}

/** Parse the top "## Not ported" file-level table. */
function parseNotPortedFiles(md: string): Map<string, ParsedDisposition> {
  const out = new Map<string, ParsedDisposition>();
  const start = md.indexOf("## Not ported");
  if (start < 0) return out;
  const end = md.indexOf("## Ported", start);
  const section = md.slice(start, end < 0 ? undefined : end);
  for (const line of section.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 4) continue;
    const file = cells[1]!;
    const reason = cells[2]!;
    if (!file.endsWith(".test.ts")) continue;
    const isInfra =
      file === "example-usage.test.ts" || file === "postgres-alpine.test.ts";
    out.set(file, {
      disposition: isInfra ? "infra" : "not-ported",
      reason,
    });
  }
  return out;
}

function baseName(rel: string): string {
  return rel.includes("/") ? rel.slice(rel.lastIndexOf("/") + 1) : rel;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenSet(s: string): Set<string> {
  return new Set(
    normalize(s)
      .split(" ")
      .filter((w) => w.length > 2),
  );
}

/** Jaccard-ish overlap weighted toward the shorter (paraphrased) string. */
function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.95;
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

const MATCH_THRESHOLD = 0.6;

/**
 * Hand corrections applied on top of the PORTING.md parse. Two kinds:
 *  - the top "Not ported" file table in PORTING.md is stale for three files
 *    that DO now have mirroring next tests (Tier 1 of the plan), and
 *  - seven old tests post-date PORTING.md and parse as UNMAPPED.
 * Keying these here (instead of editing the JSON by hand) keeps the ledger
 * fully regenerable: PORTING.md parse + OVERRIDES = the committed ledger.
 */
const OVERRIDES: Record<string, Omit<LedgerEntry, "file" | "testName">> = {
  // --- dbdev-roundtrip: ported, mirrored by tests/dbdev-roundtrip.test.ts ---
  "integration/dbdev-roundtrip.test.ts :: exported schema roundtrips to 0 remaining changes with supabase integration":
    { disposition: "ported", nextTest: "dbdev-roundtrip.test.ts" },

  // --- Tier 2: secret-redaction output parity. The corpus only proves
  //     schema-state convergence, not that secrets are scrubbed from output
  //     channels — that is now proven by tests/redaction-output.test.ts. ---
  // fdw-option-secret-redaction was seeded as corpus-only, but corpus proves
  // convergence, not redaction. The dedicated proof is redaction-output.test.ts.
  "integration/fdw-option-secret-redaction.test.ts :: plan SQL, catalog snapshot, and declarative export never leak option secrets across FDW / server / user-mapping / foreign-table":
    { disposition: "ported", nextTest: "redaction-output.test.ts" },
  // Subscription conninfo masking + diff-suppression of env-dependent conninfo
  // changes now fall out of extract-time redaction (both sides mask to the same
  // placeholder → no spurious diff), proven by redaction-output.test.ts.
  "integration/sensitive-and-env-dependent-handling.test.ts :: subscription with password in conninfo is masked":
    { disposition: "ported", nextTest: "redaction-output.test.ts" },
  "integration/sensitive-and-env-dependent-handling.test.ts :: alter subscription connection with password is ignored":
    { disposition: "ported", nextTest: "redaction-output.test.ts" },
  "integration/sensitive-and-env-dependent-handling.test.ts :: subscription: changing conninfo does not generate ALTER":
    { disposition: "ported", nextTest: "redaction-output.test.ts" },

  // --- security-label-operations: proof test mirrors every modeled target
  //     kind; the enum + role label gaps are closed in Tier 7. ---
  ...labelPorted([
    "label on new table",
    "label on column",
    "change table + column labels together",
    "drop column label",
    "view label",
    "materialized view label",
    "sequence label",
    "domain label",
    "composite TYPE label",
    "enum (TYPE) label",
    "function label",
    "role label (shared catalog)",
    "add label to new schema",
    "add label to existing schema",
    "change label value",
    "drop label",
  ]),

  // --- declarative-schema-export: fidelity + tree covered by export.test.ts;
  //     file co-location / path layout cases are Tier 6 (export-layout). ---
  ...exportPorted([
    "simple table",
    "multiple schemas",
    "roles and extensions",
    "views and functions",
  ]),
  // table satellites that v2 STILL co-locates into the table file (old intent
  // preserved) — ported to export-layout.test.ts.
  ...exportLayoutPorted([
    "foreign key constraints in table file",
    "triggers in table file",
    "RLS policies in table file",
  ]),
  // deliberate v2 path deltas (old engine asserted the opposite) — pinned as
  // v2 behavior in export-layout.test.ts, recorded as intentional not-ported.
  ...exportLayoutGap([
    "table with index",
    "partitioned tables",
    "materialized views with indexes",
  ]),

  // --- filter-wildcard: two cases have no Policy v2 equivalent (plan Tier 5,
  //     intentional architectural drops, not oversights). ---
  "integration/filter-wildcard.test.ts :: boolean matching on table/is_partition":
    {
      disposition: "not-ported",
      reason:
        "Intentional v2 drop — Policy v2 matches identity fields/edges, not arbitrary payload booleans (no payload predicate). Plan Tier 5.",
    },
  "integration/filter-wildcard.test.ts :: regex matching on requires": {
    disposition: "not-ported",
    reason:
      "Intentional v2 drop — Policy v2 has no `requires`/dependency predicate and no regex (globs only); dependency exclusion is excludeFactsAndDescendants. Plan Tier 5.",
  },

  // --- seven tests post-dating PORTING.md (parsed UNMAPPED) ---
  "integration/function-operations.test.ts :: keeps functions whose bodies embed non-transactional SQL text in one transactional unit":
    {
      disposition: "not-ported",
      reason:
        "Apply-segmentation: function bodies embedding non-transactional SQL keywords as text must not split the transaction. Audit against tests/apply-nontransactional.test.ts + execution.test.ts (plan Tier 8).",
    },
  "integration/postgres-config.test.ts :: pool queries wait for async onConnect setup":
    {
      disposition: "infra",
      reason:
        "Connection-layer (pool onConnect async setup); no schema-state representation. Exclusion per plan Tier 8.",
    },
  // Tier 4: supabase-dsl-e2e under supabasePolicy (self-gated, supabaseCluster).
  "integration/supabase-dsl-e2e.test.ts :: captures pg_net extension drops in createPlan":
    { disposition: "ported", nextTest: "supabase-dsl-e2e.test.ts" },
  "integration/supabase-dsl-e2e.test.ts :: roundtrips pg_net extension drops through the supabase integration":
    {
      disposition: "merged",
      reason:
        "merged into the pg_net case in supabase-dsl-e2e.test.ts (drop is asserted and applied/roundtripped in one test).",
    },
  "integration/supabase-dsl-e2e.test.ts :: suppresses CREATE FOREIGN DATA WRAPPER backed by extensions.* handler":
    { disposition: "ported", nextTest: "supabase-dsl-e2e.test.ts" },
  "integration/supabase-dsl-e2e.test.ts :: preserves user-owned postgres_fdw server, foreign table, and user mapping":
    { disposition: "ported", nextTest: "supabase-dsl-e2e.test.ts" },
  "integration/supabase-dsl-e2e.test.ts :: suppresses GRANT/REVOKE on FOREIGN DATA WRAPPER even when owned by postgres":
    { disposition: "ported", nextTest: "supabase-dsl-e2e.test.ts" },
  "integration/supabase-dsl-e2e.test.ts :: preserves GRANT on user-owned FOREIGN SERVER":
    { disposition: "ported", nextTest: "supabase-dsl-e2e.test.ts" },
  "integration/supabase-dsl-e2e.test.ts :: suppresses user triggers on pgmq queue tables when pg_depend link is missing":
    { disposition: "ported", nextTest: "supabase-dsl-e2e.test.ts" },
  "integration/supabase-dsl-e2e.test.ts :: captures user-defined triggers attached to auth.users":
    { disposition: "ported", nextTest: "supabase-dsl-e2e.test.ts" },
  "integration/supabase-dsl-e2e.test.ts :: suppresses Wasm FDW server, foreign table, and user mapping dependents":
    {
      disposition: "ported",
      nextTest: "supabase-dsl-e2e.test.ts",
      reason:
        "v2 suppresses them structurally: the server/foreign-table/user-mapping are parented to the owner-excluded FDW, so resolveView cascades the exclusion (no Wasm-name match needed). Residual accepted delta (Old-12): a Wasm FDW owned by a NON-system role like postgres would not be owner-excluded.",
    },

  // Tier 5: policy / filter DSL → Policy v2. Predicate matching (kind, schema/
  // name glob, not/any/all, owner, ownedByExtension) is exhaustively unit-tested
  // in src/policy/policy.test.ts; managed-view + edgeTo + concurrentIndexes in
  // tests/policy.test.ts. tests/policy-filter-integration.test.ts adds the two
  // end-to-end behaviors those don't cover.
  "integration/catalog-export-filter.test.ts :: filterCatalog keeps only objects matching the filter":
    { disposition: "ported", nextTest: "policy-filter-integration.test.ts" },
  "integration/catalog-export-filter.test.ts :: round-trip: filtered snapshot diffs to zero against live source with same filter":
    { disposition: "ported", nextTest: "policy-filter-integration.test.ts" },
  "integration/catalog-export-filter.test.ts :: round-trip matches realtime usage: schema filter survives plan":
    { disposition: "ported", nextTest: "policy-filter-integration.test.ts" },
  "integration/catalog-export-filter.test.ts :: filterCatalog drops pg_depend edges that touch pruned objects":
    {
      disposition: "merged",
      reason:
        "v2 prunes edges whose endpoints are projected out in excludeFactsAndDescendants; covered by src/policy/resolve-view.test.ts.",
    },
  "integration/catalog-export-filter.test.ts :: schema filter keeps schema even when its owner role is filtered out":
    {
      disposition: "merged",
      reason:
        "Owner is an edge in v2 (owner-as-edge); a kept schema whose owner role is excluded simply loses the owner edge — covered by owner-edge.test.ts + tests/policy.test.ts (grants to assumed roles).",
    },
  "integration/catalog-export-filter.test.ts :: filterCatalog rejects cascade: true with an explanatory error":
    {
      disposition: "not-ported",
      reason:
        "Old filterCatalog `cascade: true` API concept has no Policy v2 analog — projection cascades to descendants by construction (excludeFactsAndDescendants); there is no cascade flag to reject.",
    },
  "integration/filter-wildcard.test.ts :: */schema filters by schema across object types":
    {
      disposition: "merged",
      reason:
        "schema glob predicate + filterDeltas: src/policy/policy.test.ts (schema glob) + tests/policy-filter-integration.test.ts (schema projection roundtrip).",
    },
  "integration/filter-wildcard.test.ts :: objectType filters by change type": {
    disposition: "merged",
    reason: "kind predicate: src/policy/policy.test.ts (factMatches — kind).",
  },
  "integration/filter-wildcard.test.ts :: not with */schema excludes schema": {
    disposition: "merged",
    reason:
      "not combinator: src/policy/policy.test.ts (factMatches — combinators).",
  },
  "integration/filter-wildcard.test.ts :: --filter AND-combines with integration filter":
    {
      disposition: "not-ported",
      reason:
        "CLI `--filter` AND-combine is an old-API shape; v2 composes filters via policy `extends` (src/policy/policy.test.ts flattenPolicy extends), not a CLI flag merged with the integration filter.",
    },
  "integration/security-label-filter.test.ts :: excludes all security_label changes when scope is negated":
    { disposition: "ported", nextTest: "policy-filter-integration.test.ts" },
  "integration/security-label-filter.test.ts :: provider filter excludes only matching provider":
    { disposition: "ported", nextTest: "policy-filter-integration.test.ts" },

  // Tier 4: the two low-value Supabase smokes are covered, not re-ported.
  "integration/supabase-base-init.test.ts :: replays the full-stack base init before test code runs":
    {
      disposition: "merged",
      reason:
        "Base-init replay is exercised end-to-end by tests/dbdev-roundtrip.test.ts (bootstrapDbdevFixture applies the base-init fixture before a full roundtrip); a standalone storage.buckets smoke adds no coverage.",
    },
  "integration/supabase-all-extensions-roundtrip.test.ts :: every pinned-schema extension reapplies cleanly via the supabase integration":
    {
      disposition: "merged",
      reason:
        "CI-skipped breadth canary for the CREATE EXTENSION … WITH SCHEMA <pinned-schema> path (issue #222). That path — a pinned schema that is an assumedSchema (extensions/pgmq) — is exercised by the ported postgres_fdw/pgvector/pgmq roundtrips in supabase-integration.test.ts + supabase-dsl-e2e.test.ts; breadth across every extension does not change the code path.",
    },

  // Tier 4: catalog-model extraction cases. pg-delta-next proves extraction by
  // the fact-ring (tests/extract.test.ts) + bidirectional corpus round-trips,
  // not by re-asserting the old Catalog shape. The one distinct case — PG18
  // temporal PK/FK — is ported as a minVersion:18 corpus scenario (constraints
  // carry WITHOUT OVERLAPS / PERIOD via pg_get_constraintdef, so they round-trip).
  "integration/catalog-model.test.ts :: extract temporal table constraints": {
    disposition: "ported",
    corpus: "constraint-ops--temporal-pk-fk",
  },
  "integration/catalog-model.test.ts :: extract system objects and filtering": {
    disposition: "merged",
    reason:
      "Supabase managed-schema/role filtering is covered by tests/supabase-dsl-e2e.test.ts + tests/policy.test.ts (managed-view projection).",
  },
  ...catalogModelMerged([
    "extract schemas and basic tables",
    "extract table structure and constraints",
    "extract view system",
    "extract database objects",
    "extract event triggers",
    "extract advanced features",
    "extract type system and dependencies",
  ]),

  // Tier 4: Supabase bare-image integration (self-gated, supabaseCluster).
  "integration/extension-operations.test.ts :: preserves pgvector typmod dimensions in catalog extraction and diff SQL":
    { disposition: "ported", nextTest: "supabase-integration.test.ts" },
  "integration/pgmq-declarative-roundtrip.test.ts :: exported schema reapplies cleanly with supabase integration":
    { disposition: "ported", nextTest: "supabase-integration.test.ts" },
  "integration/extension-operations.test.ts :: create extension": {
    disposition: "merged",
    reason:
      "vector extension create is exercised by the pgvector typmod case in supabase-integration.test.ts; generic CREATE EXTENSION roundtrip is covered by the extension-member-* corpus/tests.",
  },
  "integration/extension-operations.test.ts :: extension with comment": {
    disposition: "merged",
    reason:
      "extension COMMENT roundtrip covered by the `comments` corpus + extension-member-* coverage; vector-specific create exercised in supabase-integration.test.ts.",
  },

  // Tier 3: subscription slot parity. pg-delta-next's behavior was already
  // correct (create reuses an existing slot via connect=false, staying
  // transactional; drop-with-slot self-declares nonTransactional) — these tests
  // prove convergence end-to-end. Not corpus: slots are cluster/shared-catalog
  // state the TEMPLATE-cloning corpus runner skips.
  "integration/subscription-operations.test.ts :: creates a subscription reusing an existing replication slot inside a transaction":
    { disposition: "ported", nextTest: "subscription-slot.test.ts" },
  "integration/subscription-operations.test.ts :: drops a subscription with an associated replication slot outside a transaction block":
    { disposition: "ported", nextTest: "subscription-slot.test.ts" },
  "integration/trigger-operations.test.ts :: trigger with dependencies roundtrip":
    {
      disposition: "not-ported",
      reason:
        "Generic trigger+dependency roundtrip; schema state covered bidirectionally by corpus trigger-operations--* scenarios (no distinct fixture).",
    },
  "integration/type-operations.test.ts :: add enum value before setting default to the new value":
    {
      disposition: "not-ported",
      reason:
        "Enum-value-then-use ordering; schema state covered by corpus type-ops--enum-add-value-used-in-new-column + alter-table--column-type-enum-default.",
    },
  "integration/type-operations.test.ts :: add enum value before adding check constraint that references it":
    {
      disposition: "not-ported",
      reason:
        "Enum-value-before-dependent ordering; related corpus coverage in mixed-objects--enum-add-value-with-functions / type-ops--enum-add-value-used-in-new-column. Candidate for a dedicated check-constraint scenario (plan Tier 9).",
    },
};

function labelPorted(
  names: string[],
): Record<string, Omit<LedgerEntry, "file" | "testName">> {
  const out: Record<string, Omit<LedgerEntry, "file" | "testName">> = {};
  for (const n of names) {
    out[`integration/security-label-operations.test.ts :: ${n}`] = {
      disposition: "ported",
      nextTest: "security-label-proof.test.ts",
    };
  }
  return out;
}

function catalogModelMerged(
  names: string[],
): Record<string, Omit<LedgerEntry, "file" | "testName">> {
  const out: Record<string, Omit<LedgerEntry, "file" | "testName">> = {};
  for (const n of names) {
    out[`integration/catalog-model.test.ts :: ${n}`] = {
      disposition: "merged",
      reason:
        "Generic extraction proven by tests/extract.test.ts (fact ring) + the bidirectional corpus (every modeled kind); the old Catalog-shape assertions are not re-ported.",
    };
  }
  return out;
}

function exportPorted(
  names: string[],
): Record<string, Omit<LedgerEntry, "file" | "testName">> {
  const out: Record<string, Omit<LedgerEntry, "file" | "testName">> = {};
  for (const n of names) {
    out[`integration/declarative-schema-export.test.ts :: ${n}`] = {
      disposition: "ported",
      nextTest: "export.test.ts",
    };
  }
  return out;
}

function exportLayoutPorted(
  names: string[],
): Record<string, Omit<LedgerEntry, "file" | "testName">> {
  const out: Record<string, Omit<LedgerEntry, "file" | "testName">> = {};
  for (const n of names) {
    out[`integration/declarative-schema-export.test.ts :: ${n}`] = {
      disposition: "ported",
      nextTest: "export-layout.test.ts",
    };
  }
  return out;
}

function exportLayoutGap(
  names: string[],
): Record<string, Omit<LedgerEntry, "file" | "testName">> {
  const out: Record<string, Omit<LedgerEntry, "file" | "testName">> = {};
  for (const n of names) {
    out[`integration/declarative-schema-export.test.ts :: ${n}`] = {
      disposition: "not-ported",
      reason:
        "Intentional v2 layout delta (Tier 6) — old engine co-located this in the table/matview file; v2 files indexes under schemas/<>/indexes/, matviews under materialized_views/, and partition children as their own tables/<child>.sql. The v2 by-object mapping is pinned by tests/export-layout.test.ts; fidelity by tests/export.test.ts.",
    };
  }
  return out;
}

function main(): void {
  const md = readFileSync(PORTING_MD, "utf8");
  const perCaseRows = parsePerCaseRows(md);
  const notPortedFiles = parseNotPortedFiles(md);
  const oldTests = extractAllOldTests();

  const rawEntries: LedgerEntry[] = [];
  const stats = {
    exact: 0,
    fuzzy: 0,
    fromNotPortedFile: 0,
    unmapped: 0,
  };

  // Group authoritative tests by file so reconciliation is within-file only.
  const byFile = new Map<string, string[]>();
  for (const t of oldTests) {
    const arr = byFile.get(t.file) ?? [];
    arr.push(t.testName);
    byFile.set(t.file, arr);
  }

  for (const [file, names] of byFile) {
    const rows = [...(perCaseRows.get(file) ?? [])];
    const used = new Set<number>();
    for (const testName of names) {
      // Best unused row by similarity.
      let bestIdx = -1;
      let bestScore = 0;
      rows.forEach((r, i) => {
        if (used.has(i)) return;
        const s = similarity(testName, r.name);
        if (s > bestScore) {
          bestScore = s;
          bestIdx = i;
        }
      });
      if (bestIdx >= 0 && bestScore >= MATCH_THRESHOLD) {
        used.add(bestIdx);
        if (bestScore >= 0.95) stats.exact++;
        else stats.fuzzy++;
        rawEntries.push({ file, testName, ...rows[bestIdx]!.parsed });
        continue;
      }
      const fileHit = notPortedFiles.get(baseName(file));
      if (fileHit) {
        stats.fromNotPortedFile++;
        rawEntries.push({ file, testName, ...fileHit });
        continue;
      }
      stats.unmapped++;
      rawEntries.push({
        file,
        testName,
        disposition: "not-ported",
        reason: "UNMAPPED — not found in PORTING.md",
      });
    }
  }

  // Apply hand corrections. Track which overrides actually matched so a stale
  // OVERRIDES key (renamed/removed old test) surfaces instead of silently no-op.
  const overrideHits = new Set<string>();
  const entries: LedgerEntry[] = rawEntries.map((e) => {
    const key = `${e.file} :: ${e.testName}`;
    const ov = OVERRIDES[key];
    if (!ov) return e;
    overrideHits.add(key);
    return { file: e.file, testName: e.testName, ...ov };
  });
  const staleOverrides = Object.keys(OVERRIDES).filter(
    (k) => !overrideHits.has(k),
  );

  console.log("Seed coverage:");
  console.log(`  old tests:            ${oldTests.length}`);
  console.log(`  exact per-case match: ${stats.exact}`);
  console.log(`  fuzzy per-case match: ${stats.fuzzy}`);
  console.log(`  from not-ported list: ${stats.fromNotPortedFile}`);
  console.log(`  raw UNMAPPED:         ${stats.unmapped}`);
  console.log(`  overrides applied:    ${overrideHits.size}`);

  const remainingUnmapped = entries.filter((e) =>
    e.reason?.startsWith("UNMAPPED"),
  );
  if (remainingUnmapped.length > 0) {
    console.log("\n  Still UNMAPPED (add an OVERRIDES entry):");
    for (const e of remainingUnmapped) {
      console.log(`    ${e.file} :: ${e.testName}`);
    }
  }
  if (staleOverrides.length > 0) {
    console.log("\n  Stale OVERRIDES keys (no matching old test):");
    for (const k of staleOverrides) console.log(`    ${k}`);
  }

  if (process.argv.includes("--dry-run")) return;
  writeFileSync(LEDGER_PATH, JSON.stringify(entries, null, 2) + "\n");
  console.log(`\nWrote ${entries.length} entries to ${LEDGER_PATH}`);
}

main();
