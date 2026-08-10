/**
 * End-to-end planner wiring for `extensionIntent` facts (docs/architecture/
 * extension-intent.md §4). A toy cron-shaped intent rule is supplied through
 * `PlanOptions.intentRules` (what the resolved profile does in production), and
 * we assert the generic planner turns intent deltas into replay actions:
 *   add    → `select cron.schedule(...)`, ordered after schema DDL
 *   set    → `unschedule` then `schedule` (replace, by key)
 *   remove → `select cron.unschedule(...)`, dataLoss none
 * plus: renames:"auto" tolerates intent add/remove, and an intent delta with no
 * registered rule fails loudly. No Docker — synthetic fact bases.
 */
import { describe, expect, test } from "bun:test";
import { INTENT_UNKEYED, INTENT_UNSUPPORTED } from "../core/diagnostic.ts";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";
import {
  buildIntentRuleIndex,
  type IntentKindRule,
  type IntentRuleIndex,
} from "./rules.ts";

const f = (
  id: StableId,
  parent?: StableId,
  payload: Fact["payload"] = {},
): Fact => (parent ? { id, parent, payload } : { id, payload });

const keyOf = (fact: Fact): string =>
  (fact.id as Extract<StableId, { kind: "extensionIntent" }>).key;

/** Toy pg_cron-shaped intent rule (the real one lands in A3). */
const cronJobRule: IntentKindRule = {
  payloadAttrs: ["schedule", "command", "database", "username", "active"],
  create: (fact) => {
    const p = fact.payload as { schedule: string; command: string };
    return [
      {
        sql: `select cron.schedule('${keyOf(fact)}', '${p.schedule}', $$${p.command}$$)`,
      },
    ];
  },
  drop: (fact) => ({
    sql: `select cron.unschedule('${keyOf(fact)}')`,
    dataLoss: "none",
  }),
};

const intentRules: IntentRuleIndex = buildIntentRuleIndex([
  { extension: "pg_cron", intentKinds: { job: cronJobRule } },
]);

const publicSchema: StableId = { kind: "schema", name: "public" };
const pgCron: StableId = { kind: "extension", name: "pg_cron" };
const table: StableId = { kind: "table", schema: "public", name: "t" };
const job = (key: string): StableId => ({
  kind: "extensionIntent",
  ext: "pg_cron",
  intentKind: "job",
  key,
});

/** pg_cron present on both sides (never diffed) so the depends edge is valid. */
const baseFacts: Fact[] = [
  f(publicSchema),
  f(pgCron, publicSchema, { schema: "pg_catalog", relocatable: false }),
];

const jobFact = (key: string, schedule: string): Fact =>
  f(job(key), undefined, {
    schedule,
    command: "select 1",
    database: "postgres",
    username: "postgres",
    active: true,
  });

const indexOf = (actions: readonly { sql: string }[], needle: RegExp): number =>
  actions.findIndex((a) => needle.test(a.sql));

describe("plan() — extension intent wiring", () => {
  test("add: emits cron.schedule, ordered after a schema table create", () => {
    const source = buildFactBase(baseFacts, []);
    const desired = buildFactBase(
      [
        ...baseFacts,
        f(table, publicSchema, { persistence: "p" }),
        jobFact("nightly", "0 0 * * *"),
      ],
      [{ from: job("nightly"), to: pgCron, kind: "depends" }],
    );

    const thePlan = plan(source, desired, { intentRules });

    const scheduleIdx = indexOf(thePlan.actions, /cron\.schedule\('nightly'/);
    const tableIdx = indexOf(thePlan.actions, /CREATE TABLE/i);
    expect(scheduleIdx).toBeGreaterThanOrEqual(0);
    expect(tableIdx).toBeGreaterThanOrEqual(0);
    // intent weight (90) is later than every schema kind → schedule sorts last
    expect(scheduleIdx).toBeGreaterThan(tableIdx);
    const scheduleAction = thePlan.actions[scheduleIdx]!;
    expect(scheduleAction.verb).toBe("create");
    expect(scheduleAction.produces).toContainEqual(job("nightly"));
    expect(scheduleAction.transactionality).toBe("transactional");
    expect(scheduleAction.lockClass).toBe("none");
  });

  test("set: a schedule change replays as unschedule then schedule", () => {
    const source = buildFactBase(
      [...baseFacts, jobFact("nightly", "0 0 * * *")],
      [{ from: job("nightly"), to: pgCron, kind: "depends" }],
    );
    const desired = buildFactBase(
      [...baseFacts, jobFact("nightly", "*/5 * * * *")],
      [{ from: job("nightly"), to: pgCron, kind: "depends" }],
    );

    const thePlan = plan(source, desired, { intentRules });

    const unscheduleIdx = indexOf(
      thePlan.actions,
      /cron\.unschedule\('nightly'/,
    );
    const scheduleIdx = indexOf(thePlan.actions, /cron\.schedule\('nightly'/);
    expect(unscheduleIdx).toBeGreaterThanOrEqual(0);
    expect(scheduleIdx).toBeGreaterThanOrEqual(0);
    // destroy-before-re-produce: unschedule the old job before scheduling the new
    expect(unscheduleIdx).toBeLessThan(scheduleIdx);
    expect(thePlan.actions[scheduleIdx]!.sql).toContain("*/5 * * * *");
    // no in-place ALTER action was emitted for the intent
    expect(thePlan.actions).toHaveLength(2);
  });

  test("remove: emits cron.unschedule with no data loss", () => {
    const source = buildFactBase(
      [...baseFacts, jobFact("nightly", "0 0 * * *")],
      [{ from: job("nightly"), to: pgCron, kind: "depends" }],
    );
    const desired = buildFactBase(baseFacts, []);

    const thePlan = plan(source, desired, { intentRules });

    expect(thePlan.actions).toHaveLength(1);
    const drop = thePlan.actions[0]!;
    expect(drop.sql).toContain("cron.unschedule('nightly')");
    expect(drop.verb).toBe("drop");
    expect(drop.dataLoss).toBe("none");
  });

  test('renames:"auto" tolerates intent add/remove (no rename candidacy)', () => {
    const source = buildFactBase(
      [...baseFacts, jobFact("old", "0 0 * * *")],
      [{ from: job("old"), to: pgCron, kind: "depends" }],
    );
    const desired = buildFactBase(
      [...baseFacts, jobFact("new", "0 0 * * *")],
      [{ from: job("new"), to: pgCron, kind: "depends" }],
    );

    expect(() =>
      plan(source, desired, { intentRules, renames: "auto" }),
    ).not.toThrow();
    const thePlan = plan(source, desired, { intentRules, renames: "auto" });
    // drop+create by key, never a rename
    expect(thePlan.renameCandidates).toHaveLength(0);
    expect(
      indexOf(thePlan.actions, /cron\.unschedule\('old'/),
    ).toBeGreaterThanOrEqual(0);
    expect(
      indexOf(thePlan.actions, /cron\.schedule\('new'/),
    ).toBeGreaterThanOrEqual(0);
  });

  test("an intent delta with no registered rule fails loudly", () => {
    const source = buildFactBase(baseFacts, []);
    const desired = buildFactBase(
      [...baseFacts, jobFact("nightly", "0 0 * * *")],
      [{ from: job("nightly"), to: pgCron, kind: "depends" }],
    );
    // no intentRules supplied → the resolver has no rule for pg_cron/job
    expect(() => plan(source, desired)).toThrow(/no intent rule registered/);
  });

  test("a desired-side unkeyed-intent diagnostic aborts the plan", () => {
    const source = buildFactBase(baseFacts, []);
    const desired = buildFactBase(baseFacts, []);
    desired.diagnostics.push({
      code: INTENT_UNKEYED,
      severity: "warning",
      message:
        "cron job (command: delete from x) has no jobname and cannot be managed",
      context: { ext: "pg_cron", intentKind: "job" },
    });
    expect(() => plan(source, desired, { intentRules })).toThrow(
      /cannot key|unnamed|no jobname/i,
    );
  });

  test("a source-side unkeyed-intent diagnostic does NOT abort (unmanaged drift)", () => {
    const source = buildFactBase(baseFacts, []);
    source.diagnostics.push({
      code: INTENT_UNKEYED,
      severity: "warning",
      message: "cron job (command: delete from x) has no jobname",
      context: { ext: "pg_cron", intentKind: "job" },
    });
    const desired = buildFactBase(baseFacts, []);
    expect(() => plan(source, desired, { intentRules })).not.toThrow();
  });

  // ── INTENT_UNSUPPORTED: keyable but not replayable (a PARTITIONED pgmq
  // queue). The gate is COLLISION-SCOPED, not side-scoped: the warning alone is
  // benign (the object stays unmanaged on whichever side holds it), but if the
  // OPPOSITE side manages a fact under the SAME key, acting on the diff is
  // wrong in both directions — so plan() refuses only then. The diagnostic
  // carries `key` in its context so the would-be id can be reconstructed here.
  // ext/intentKind are pg_cron/job below purely so the ids line up with
  // `jobFact` — the gate itself is extension-agnostic. ────────────────────────
  const unsupported = (key: string) => ({
    code: INTENT_UNSUPPORTED,
    severity: "warning" as const,
    message: `intent '${key}' is PARTITIONED and cannot be replayed`,
    context: { ext: "pg_cron", intentKind: "job", key },
  });

  test("desired-side unsupported + a same-key SOURCE fact aborts the plan", () => {
    // Source manages `clash`; desired declares an unreplayable form of the same
    // key. Ungated the diff sees only a removal and plans a bare destructive
    // drop whose proof falsely converges (the desired re-extract skips it too).
    const source = buildFactBase(
      [...baseFacts, jobFact("clash", "0 0 * * *")],
      [{ from: job("clash"), to: pgCron, kind: "depends" }],
    );
    const desired = buildFactBase(baseFacts, []);
    desired.diagnostics.push(unsupported("clash"));
    expect(() => plan(source, desired, { intentRules })).toThrow(/clash/);
  });

  test("source-side unsupported + a same-key DESIRED fact aborts the plan", () => {
    // Mirror image: source holds the unreplayable form, desired declares a
    // manageable one under the same key. Ungated the plan emits a create that
    // no-ops against the existing registration (pgmq's create is IF NOT
    // EXISTS) and the proof fails later with a confusing mismatch.
    const source = buildFactBase(baseFacts, []);
    source.diagnostics.push(unsupported("clash"));
    const desired = buildFactBase(
      [...baseFacts, jobFact("clash", "0 0 * * *")],
      [{ from: job("clash"), to: pgCron, kind: "depends" }],
    );
    expect(() => plan(source, desired, { intentRules })).toThrow(/clash/);
  });

  test("desired-side unsupported with no same-key source fact does NOT abort", () => {
    const source = buildFactBase(baseFacts, []);
    const desired = buildFactBase(baseFacts, []);
    desired.diagnostics.push(unsupported("solo"));
    expect(() => plan(source, desired, { intentRules })).not.toThrow();
  });

  test("source-side unsupported with no same-key desired fact does NOT abort", () => {
    const source = buildFactBase(baseFacts, []);
    source.diagnostics.push(unsupported("solo"));
    const desired = buildFactBase(baseFacts, []);
    expect(() => plan(source, desired, { intentRules })).not.toThrow();
  });

  test("the steady state — the same unsupported key on BOTH sides — does NOT abort", () => {
    const source = buildFactBase(baseFacts, []);
    source.diagnostics.push(unsupported("parted"));
    const desired = buildFactBase(baseFacts, []);
    desired.diagnostics.push(unsupported("parted"));
    expect(() => plan(source, desired, { intentRules })).not.toThrow();
  });

  test("a desired-side unsupported diagnostic with NO key aborts (conservative)", () => {
    // A third-party handler predating the key-carrying context: the gate cannot
    // prove the source holds nothing under that key, so it refuses.
    const source = buildFactBase(baseFacts, []);
    const desired = buildFactBase(baseFacts, []);
    desired.diagnostics.push({
      code: INTENT_UNSUPPORTED,
      severity: "warning",
      message: "some intent is unreplayable",
      context: { ext: "pgmq", intentKind: "queue" },
    });
    expect(() => plan(source, desired, { intentRules })).toThrow(
      /cannot replay/i,
    );
  });
});
