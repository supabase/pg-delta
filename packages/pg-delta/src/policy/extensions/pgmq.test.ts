/**
 * Unit tests for the pgmq handler (docs/architecture/extension-intent.md §4.1,
 * CLI-2054). No database — a fake `HandlerContext` returns canned rows keyed
 * off the SQL the handler issues. Covers: intent-fact shape + depends-edge
 * guarding, the Phase-A `managedBy` edges on the operational `q_*` / `a_*`
 * tables (and their `current.has` guard), the partitioned-queue
 * `INTENT_UNSUPPORTED` scoping decision, and the `intentKinds.queue`
 * create/drop SQL for both logged and unlogged queues.
 */
import { describe, expect, test } from "bun:test";
import { INTENT_UNSUPPORTED } from "../../core/diagnostic.ts";
import { buildFactBase, type Fact } from "../../core/fact.ts";
import type { HandlerContext } from "../../extract/handler.ts";
import type { Row } from "../../extract/scope.ts";
import type { StableId } from "../../core/stable-id.ts";
import { pgmqHandler } from "./pgmq.ts";

const PGMQ: StableId = { kind: "extension", name: "pgmq" };
const pgmqFact: Fact = { id: PGMQ, payload: {} };

const tableId = (name: string): StableId => ({
  kind: "table",
  schema: "pgmq",
  name,
});
const tableFact = (name: string): Fact => ({ id: tableId(name), payload: {} });

const queueIntentId = (key: string): StableId => ({
  kind: "extensionIntent",
  ext: "pgmq",
  intentKind: "queue",
  key,
});

interface QueueRow {
  queue_name: string;
  is_partitioned: boolean;
  is_unlogged: boolean;
  qtable: string;
  atable: string;
}

/** A `pgmq.meta` row plus the two operational table names Postgres derives
 *  from it (`lower('q_' || queue_name)` / `lower('a_' || …)`, exactly what
 *  `pgmq.format_table_name` does). */
const queue = (
  overrides: Partial<QueueRow> & { queue_name: string },
): QueueRow => ({
  is_partitioned: false,
  is_unlogged: false,
  qtable: `q_${overrides.queue_name.toLowerCase()}`,
  atable: `a_${overrides.queue_name.toLowerCase()}`,
  ...overrides,
});

/** Build a fake ctx: detect() returns pgmq's install schema (or no rows when
 *  the extension is absent); the registry query returns the supplied rows. */
function fakeCtx(queues: QueueRow[], installed = true): HandlerContext {
  return {
    query: async (sql: string): Promise<Row[]> => {
      if (/pg_extension/i.test(sql)) {
        return installed ? [{ schema: "pgmq" }] : [];
      }
      if (/\.meta\b/i.test(sql)) {
        return queues as unknown as Row[];
      }
      throw new Error(`fakeCtx: unexpected query: ${sql}`);
    },
  };
}

describe("pgmqHandler.capture", () => {
  test("not installed → no facts, no edges", async () => {
    const ctx = fakeCtx([], false);
    const current = buildFactBase([], []);
    const result = await pgmqHandler.capture(ctx, current);
    expect(result.facts).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  test("installed with no queues → no facts, no edges", async () => {
    const ctx = fakeCtx([]);
    const current = buildFactBase([pgmqFact], []);
    const result = await pgmqHandler.capture(ctx, current);
    expect(result.facts).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  test("two queues → two intent facts with correct ids + payloads + depends edges", async () => {
    const ctx = fakeCtx([
      queue({ queue_name: "jobs" }),
      queue({ queue_name: "fast", is_unlogged: true }),
    ]);
    const current = buildFactBase(
      [
        pgmqFact,
        tableFact("q_jobs"),
        tableFact("a_jobs"),
        tableFact("q_fast"),
        tableFact("a_fast"),
      ],
      [],
    );

    const result = await pgmqHandler.capture(ctx, current);

    expect(result.facts).toHaveLength(2);
    const jobs = result.facts.find(
      (f) => (f.id as { key: string }).key === "jobs",
    );
    expect(jobs?.id).toEqual(queueIntentId("jobs"));
    expect(jobs?.payload).toEqual({ isPartitioned: false, isUnlogged: false });

    const fast = result.facts.find(
      (f) => (f.id as { key: string }).key === "fast",
    );
    expect(fast?.id).toEqual(queueIntentId("fast"));
    expect(fast?.payload).toEqual({ isPartitioned: false, isUnlogged: true });

    // every intent fact carries EXACTLY one depends edge, on the extension
    const dependsEdges = result.edges.filter((e) => e.kind === "depends");
    expect(dependsEdges).toEqual([
      { from: queueIntentId("jobs"), to: PGMQ, kind: "depends" },
      { from: queueIntentId("fast"), to: PGMQ, kind: "depends" },
    ]);
  });

  test("depends edge is guarded by current.has(pgmq) — omitted when the extension fact is absent", async () => {
    const ctx = fakeCtx([queue({ queue_name: "jobs" })]);
    const current = buildFactBase([], []); // no pgmq extension fact
    const result = await pgmqHandler.capture(ctx, current);
    expect(result.facts).toHaveLength(1);
    expect(result.edges).toEqual([]);
  });

  test("managedBy edges tag the operational q_/a_ tables of every queue", async () => {
    const ctx = fakeCtx([queue({ queue_name: "jobs" })]);
    const current = buildFactBase(
      [pgmqFact, tableFact("q_jobs"), tableFact("a_jobs")],
      [],
    );

    const result = await pgmqHandler.capture(ctx, current);

    const managed = result.edges.filter((e) => e.kind === "managedBy");
    expect(managed).toEqual([
      { from: tableId("q_jobs"), to: PGMQ, kind: "managedBy" },
      { from: tableId("a_jobs"), to: PGMQ, kind: "managedBy" },
    ]);
  });

  test("managedBy edges are guarded by current.has(table) — no dangling edge for a table that is not a fact", async () => {
    const ctx = fakeCtx([queue({ queue_name: "jobs" })]);
    // only the queue table is a fact; the archive table is not
    const current = buildFactBase([pgmqFact, tableFact("q_jobs")], []);

    const result = await pgmqHandler.capture(ctx, current);

    const managed = result.edges.filter((e) => e.kind === "managedBy");
    expect(managed).toEqual([
      { from: tableId("q_jobs"), to: PGMQ, kind: "managedBy" },
    ]);
  });

  test("a queue name that is not all-lowercase tags the LOWERCASED table names pgmq actually created", async () => {
    // pgmq.format_table_name is `lower(prefix || '_' || queue_name)`, so
    // `pgmq.create('MixedCase')` records `MixedCase` in `pgmq.meta` but creates
    // `pgmq.q_mixedcase` / `pgmq.a_mixedcase`. The table names come from the
    // catalog query, never from re-deriving the key in JS.
    const ctx = fakeCtx([queue({ queue_name: "MixedCase" })]);
    const current = buildFactBase(
      [pgmqFact, tableFact("q_mixedcase"), tableFact("a_mixedcase")],
      [],
    );

    const result = await pgmqHandler.capture(ctx, current);

    expect(result.facts.map((f) => (f.id as { key: string }).key)).toEqual([
      "MixedCase",
    ]);
    expect(result.edges.filter((e) => e.kind === "managedBy")).toEqual([
      { from: tableId("q_mixedcase"), to: PGMQ, kind: "managedBy" },
      { from: tableId("a_mixedcase"), to: PGMQ, kind: "managedBy" },
    ]);
  });

  test("a PARTITIONED queue emits no intent fact and one INTENT_UNSUPPORTED warning", async () => {
    const ctx = fakeCtx([
      queue({ queue_name: "events", is_partitioned: true }),
      queue({ queue_name: "jobs" }),
    ]);
    const current = buildFactBase(
      [
        pgmqFact,
        tableFact("q_events"),
        tableFact("a_events"),
        tableFact("q_jobs"),
        tableFact("a_jobs"),
      ],
      [],
    );

    const result = await pgmqHandler.capture(ctx, current);

    // only the non-partitioned queue becomes a fact
    expect(result.facts.map((f) => (f.id as { key: string }).key)).toEqual([
      "jobs",
    ]);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics?.[0]?.code).toBe(INTENT_UNSUPPORTED);
    expect(result.diagnostics?.[0]?.severity).toBe("warning");
    expect(result.diagnostics?.[0]?.message).toMatch(/events/);
    expect(result.diagnostics?.[0]?.context).toEqual({
      ext: "pgmq",
      intentKind: "queue",
    });
  });

  test("a partitioned queue's operational tables are STILL tagged managedBy (they are pgmq's, intent or not)", async () => {
    const ctx = fakeCtx([
      queue({ queue_name: "events", is_partitioned: true }),
    ]);
    const current = buildFactBase(
      [pgmqFact, tableFact("q_events"), tableFact("a_events")],
      [],
    );

    const result = await pgmqHandler.capture(ctx, current);

    expect(result.facts).toEqual([]);
    expect(result.edges.filter((e) => e.kind === "managedBy")).toEqual([
      { from: tableId("q_events"), to: PGMQ, kind: "managedBy" },
      { from: tableId("a_events"), to: PGMQ, kind: "managedBy" },
    ]);
  });

  test("no queue is ever unkeyable — pgmq.meta.queue_name is the registry's unique key", async () => {
    // Regression guard for the SHAPE decision: unlike pg_cron (jobname is
    // nullable and non-unique), pgmq cannot produce an unkeyable row, so the
    // handler ships no duplicate/empty-name machinery. Two rows that would
    // collide are impossible; assert the straightforward mapping instead.
    const ctx = fakeCtx([
      queue({ queue_name: "a" }),
      queue({ queue_name: "b" }),
      queue({ queue_name: "c" }),
    ]);
    const current = buildFactBase([pgmqFact], []);
    const result = await pgmqHandler.capture(ctx, current);
    expect(result.facts.map((f) => (f.id as { key: string }).key)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(result.diagnostics ?? []).toEqual([]);
  });
});

describe("pgmqHandler.intentKinds.queue", () => {
  const queueRule = pgmqHandler.intentKinds?.["queue"];

  const queueFact = (key: string, isUnlogged = false): Fact => ({
    id: queueIntentId(key),
    payload: { isPartitioned: false, isUnlogged },
  });

  test("payloadAttrs matches the captured pgmq.meta shape", () => {
    expect(queueRule?.payloadAttrs).toEqual(["isPartitioned", "isUnlogged"]);
  });

  test("create: a logged queue renders select pgmq.create(...)", () => {
    const actions = queueRule?.create(queueFact("jobs"), undefined as never);
    expect(actions).toHaveLength(1);
    expect(actions?.[0]?.sql).toMatchInlineSnapshot(
      `"select pgmq.create('jobs')"`,
    );
  });

  test("create: an unlogged queue renders select pgmq.create_unlogged(...)", () => {
    const actions = queueRule?.create(
      queueFact("fast", true),
      undefined as never,
    );
    expect(actions).toHaveLength(1);
    expect(actions?.[0]?.sql).toMatchInlineSnapshot(
      `"select pgmq.create_unlogged('fast')"`,
    );
  });

  test("create: doubles embedded single quotes in the queue name", () => {
    // pgmq.validate_queue_name actually REJECTS a quote, so this can never come
    // from a real catalog — the rendering is still quote-safe by construction.
    const actions = queueRule?.create(
      queueFact("bob's queue"),
      undefined as never,
    );
    expect(actions?.[0]?.sql).toMatchInlineSnapshot(
      `"select pgmq.create('bob''s queue')"`,
    );
  });

  test("drop: renders select pgmq.drop_queue(...) with DESTRUCTIVE dataLoss", () => {
    const action = queueRule?.drop(queueFact("jobs"));
    expect(action?.sql).toMatchInlineSnapshot(
      `"select pgmq.drop_queue('jobs')"`,
    );
    // dropping a queue destroys every message still in it
    expect(action?.dataLoss).toBe("destructive");
  });

  test("drop: an unlogged queue drops through the same single-arg drop_queue", () => {
    const action = queueRule?.drop(queueFact("fast", true));
    expect(action?.sql).toMatchInlineSnapshot(
      `"select pgmq.drop_queue('fast')"`,
    );
  });
});

describe("pgmqHandler shape", () => {
  test("declares the pgmq extension", () => {
    expect(pgmqHandler.extension).toBe("pgmq");
  });

  test("has NO shadowPrecheck — pgmq works in any database (unlike pg_cron)", () => {
    expect(pgmqHandler.shadowPrecheck).toBeUndefined();
  });
});
