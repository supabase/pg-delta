/**
 * Unit tests for the pg_cron handler (docs/architecture/extension-intent.md
 * §3.2). No database — a fake `HandlerContext` returns canned rows keyed off
 * the SQL the handler issues. Covers: intent-fact shape + depends-edge
 * guarding, `supabase_read_only_user` → `postgres` normalization (CLI-1435),
 * unnamed-job and duplicate-jobname diagnostics (never reaching the
 * FactBase), and the `intentKinds.job` create/drop SQL (including quote
 * doubling for jobname/command).
 */
import { describe, expect, test } from "bun:test";
import { INTENT_UNKEYED } from "../../core/diagnostic.ts";
import { buildFactBase, type Fact } from "../../core/fact.ts";
import type { HandlerContext } from "../../extract/handler.ts";
import type { Row } from "../../extract/scope.ts";
import type { StableId } from "../../core/stable-id.ts";
import { pgCronHandler } from "./pg-cron.ts";

const PG_CRON: StableId = { kind: "extension", name: "pg_cron" };
const PUBLIC_SCHEMA: StableId = { kind: "schema", name: "public" };
const pgCronFact: Fact = { id: PG_CRON, payload: {} };
const publicSchemaFact: Fact = { id: PUBLIC_SCHEMA, payload: {} };

interface JobRow {
  jobid: number;
  jobname: string | null;
  schedule: string;
  command: string;
  database: string;
  username: string;
  active: boolean;
}

/** Build a fake ctx: detect() query returns the extension's namespace (or no
 *  rows when not installed); any other query returns the supplied job rows. */
function fakeCtx(jobs: JobRow[], installed = true): HandlerContext {
  return {
    query: async (sql: string): Promise<Row[]> => {
      if (/pg_extension/i.test(sql)) {
        return installed ? [{ schema: "pg_catalog" }] : [];
      }
      if (/cron\.job/i.test(sql)) {
        return jobs as unknown as Row[];
      }
      throw new Error(`fakeCtx: unexpected query: ${sql}`);
    },
  };
}

const baseJob = (overrides: Partial<JobRow>): JobRow => ({
  jobid: 1,
  jobname: "nightly",
  schedule: "0 0 * * *",
  command: "select 1",
  database: "postgres",
  username: "postgres",
  active: true,
  ...overrides,
});

const jobIntentId = (key: string): StableId => ({
  kind: "extensionIntent",
  ext: "pg_cron",
  intentKind: "job",
  key,
});

describe("pgCronHandler.capture", () => {
  test("not installed → no facts, no edges", async () => {
    const ctx = fakeCtx([], false);
    const current = buildFactBase([], []);
    const result = await pgCronHandler.capture(ctx, current);
    expect(result.facts).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  test("two named jobs → two intent facts with correct ids + payloads + depends edges", async () => {
    const jobs = [
      baseJob({ jobid: 1, jobname: "nightly", schedule: "0 0 * * *" }),
      baseJob({ jobid: 2, jobname: "hourly", schedule: "0 * * * *" }),
    ];
    const ctx = fakeCtx(jobs);
    const current = buildFactBase([pgCronFact], []);

    const result = await pgCronHandler.capture(ctx, current);

    expect(result.facts).toHaveLength(2);
    const nightly = result.facts.find(
      (f) => (f.id as { key: string }).key === "nightly",
    );
    expect(nightly?.id).toEqual(jobIntentId("nightly"));
    expect(nightly?.payload).toEqual({
      schedule: "0 0 * * *",
      command: "select 1",
      database: "postgres",
      username: "postgres",
      active: true,
    });
    // jobname must not leak into the payload (it's the key)
    expect(nightly?.payload).not.toHaveProperty("jobname");

    expect(result.edges).toHaveLength(2);
    expect(result.edges).toContainEqual({
      from: jobIntentId("nightly"),
      to: PG_CRON,
      kind: "depends",
    });
    expect(result.edges).toContainEqual({
      from: jobIntentId("hourly"),
      to: PG_CRON,
      kind: "depends",
    });
    expect(result.diagnostics ?? []).toEqual([]);
  });

  test("depends edge is guarded by current.has(pg_cron) — omitted when the extension fact is absent", async () => {
    const ctx = fakeCtx([baseJob({})]);
    const currentWithoutExtension = buildFactBase([publicSchemaFact], []);

    const result = await pgCronHandler.capture(ctx, currentWithoutExtension);

    expect(result.facts).toHaveLength(1);
    expect(result.edges).toEqual([]);
  });

  test("supabase_read_only_user is normalized to postgres (CLI-1435)", async () => {
    const ctx = fakeCtx([baseJob({ username: "supabase_read_only_user" })]);
    const current = buildFactBase([pgCronFact], []);

    const result = await pgCronHandler.capture(ctx, current);

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.payload["username"]).toBe("postgres");
  });

  test("unnamed job (null jobname) → no fact, one INTENT_UNKEYED diagnostic", async () => {
    const longCommand =
      "delete from public.some_very_long_table_name_here where created_at < now() - interval '1 day'";
    const ctx = fakeCtx([
      baseJob({ jobid: 42, jobname: null, command: longCommand }),
    ]);
    const current = buildFactBase([pgCronFact], []);

    const result = await pgCronHandler.capture(ctx, current);

    expect(result.facts).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    const diag = result.diagnostics?.[0];
    expect(diag?.code).toBe(INTENT_UNKEYED);
    expect(diag?.severity).toBe("warning");
    expect(diag?.message).toContain("42");
    expect(diag?.message).toContain("has no jobname");
    expect(diag?.context).toEqual({ ext: "pg_cron", intentKind: "job" });
  });

  test("unnamed job (empty-string jobname) → no fact, one INTENT_UNKEYED diagnostic", async () => {
    const ctx = fakeCtx([baseJob({ jobid: 7, jobname: "" })]);
    const current = buildFactBase([pgCronFact], []);

    const result = await pgCronHandler.capture(ctx, current);

    expect(result.facts).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics?.[0]?.code).toBe(INTENT_UNKEYED);
  });

  test("duplicate jobname (two rows, different usernames) → no facts, one diagnostic naming the collision", async () => {
    const jobs = [
      baseJob({ jobid: 1, jobname: "nightly", username: "postgres" }),
      baseJob({
        jobid: 2,
        jobname: "nightly",
        username: "supabase_read_only_user",
      }),
    ];
    const ctx = fakeCtx(jobs);
    const current = buildFactBase([pgCronFact], []);

    const result = await pgCronHandler.capture(ctx, current);

    expect(result.facts).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    const diag = result.diagnostics?.[0];
    expect(diag?.code).toBe(INTENT_UNKEYED);
    expect(diag?.severity).toBe("warning");
    expect(diag?.message).toContain("nightly");
    expect(diag?.context).toEqual({ ext: "pg_cron", intentKind: "job" });

    // never reaches the FactBase (which would throw on a duplicate id)
    expect(() =>
      buildFactBase([pgCronFact, ...result.facts], result.edges),
    ).not.toThrow();
  });

  test("duplicate jobname mixed with a distinct, valid job → only the distinct job becomes a fact", async () => {
    const jobs = [
      baseJob({ jobid: 1, jobname: "nightly", username: "postgres" }),
      baseJob({ jobid: 2, jobname: "nightly", username: "postgres" }),
      baseJob({ jobid: 3, jobname: "hourly" }),
    ];
    const ctx = fakeCtx(jobs);
    const current = buildFactBase([pgCronFact], []);

    const result = await pgCronHandler.capture(ctx, current);

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.id).toEqual(jobIntentId("hourly"));
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics?.[0]?.message).toContain("nightly");
  });
});

describe("pgCronHandler.intentKinds.job", () => {
  const jobRule = pgCronHandler.intentKinds?.["job"];

  test("payloadAttrs matches the §3.2 payload shape", () => {
    expect(jobRule?.payloadAttrs).toEqual([
      "schedule",
      "command",
      "database",
      "username",
      "active",
    ]);
  });

  test("create: renders select cron.schedule(...) with quoted literals", () => {
    const fact: Fact = {
      id: jobIntentId("nightly"),
      payload: {
        schedule: "0 0 * * *",
        command: "select 1",
        database: "postgres",
        username: "postgres",
        active: true,
      },
    };
    const actions = jobRule?.create(fact, undefined as never);
    expect(actions).toHaveLength(1);
    expect(actions?.[0]?.sql).toMatchInlineSnapshot(
      `"select cron.schedule('nightly', '0 0 * * *', 'select 1')"`,
    );
  });

  test("create: doubles embedded single quotes in jobname, schedule, and command", () => {
    const fact: Fact = {
      id: jobIntentId("bob's job"),
      payload: {
        schedule: "0 0 * * *",
        command: "select 'hi' from t where x = 'y'",
        database: "postgres",
        username: "postgres",
        active: true,
      },
    };
    const actions = jobRule?.create(fact, undefined as never);
    expect(actions?.[0]?.sql).toMatchInlineSnapshot(
      `"select cron.schedule('bob''s job', '0 0 * * *', 'select ''hi'' from t where x = ''y''')"`,
    );
  });

  test("create: a command containing $$ is rendered as a plain quoted literal (never dollar-quoted, which would collide)", () => {
    const fact: Fact = {
      id: jobIntentId("dollar"),
      payload: {
        schedule: "0 0 * * *",
        command: "select '$$not a dollar quote$$'",
        database: "postgres",
        username: "postgres",
        active: true,
      },
    };
    const actions = jobRule?.create(fact, undefined as never);
    // the whole statement is never wrapped in $$ ... $$ dollar-quoting
    expect(actions?.[0]?.sql.startsWith("select cron.schedule(")).toBe(true);
    expect(actions?.[0]?.sql).toMatchInlineSnapshot(
      `"select cron.schedule('dollar', '0 0 * * *', 'select ''$$not a dollar quote$$''')"`,
    );
  });

  test("drop: renders select cron.unschedule(...) with dataLoss none", () => {
    const fact: Fact = {
      id: jobIntentId("nightly"),
      payload: {
        schedule: "0 0 * * *",
        command: "select 1",
        database: "postgres",
        username: "postgres",
        active: true,
      },
    };
    const action = jobRule?.drop(fact);
    expect(action?.dataLoss).toBe("none");
    expect(action?.sql).toMatchInlineSnapshot(
      `"select cron.unschedule('nightly')"`,
    );
  });

  test("drop: doubles embedded single quotes in jobname", () => {
    const fact: Fact = {
      id: jobIntentId("bob's job"),
      payload: {
        schedule: "0 0 * * *",
        command: "select 1",
        database: "postgres",
        username: "postgres",
        active: true,
      },
    };
    const action = jobRule?.drop(fact);
    expect(action?.sql).toMatchInlineSnapshot(
      `"select cron.unschedule('bob''s job')"`,
    );
  });
});
