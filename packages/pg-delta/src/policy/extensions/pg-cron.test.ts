/**
 * Unit tests for the pg_cron handler (docs/architecture/extension-intent.md
 * §3.2). No database — a fake `HandlerContext` returns canned rows keyed off
 * the SQL the handler issues. Covers: intent-fact shape + depends-edge
 * guarding, `jobOwnerAliases` capture normalization (CLI-1435), unnamed-job
 * and duplicate-jobname diagnostics (never reaching the FactBase), the
 * `intentKinds.job` create/drop SQL (including quote doubling for
 * jobname/command), and the `defaultJobOwner` username elision + its
 * third-role `INTENT_PRIVILEGED` warning.
 */
import { describe, expect, test } from "bun:test";
import { INTENT_PRIVILEGED, INTENT_UNKEYED } from "../../core/diagnostic.ts";
import { buildFactBase, type Fact } from "../../core/fact.ts";
import type { HandlerContext } from "../../extract/handler.ts";
import type { Row } from "../../extract/scope.ts";
import type { StableId } from "../../core/stable-id.ts";
import { makePgCronHandler, pgCronHandler } from "./pg-cron.ts";

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

  test("jobOwnerAliases rewrites a legacy owner on capture (CLI-1435)", async () => {
    const handler = makePgCronHandler({
      defaultJobOwner: "postgres",
      jobOwnerAliases: { supabase_read_only_user: "postgres" },
    });
    const ctx = fakeCtx([baseJob({ username: "supabase_read_only_user" })]);
    const current = buildFactBase([pgCronFact], []);

    const result = await handler.capture(ctx, current);

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.payload["username"]).toBe("postgres");
    // the alias resolves TO the default owner, so no privileged warning
    expect(result.diagnostics ?? []).toEqual([]);
  });

  test("jobOwnerAliases lookup checks only OWN keys — a role literally named 'constructor' is not shadowed by Object.prototype", async () => {
    const handler = makePgCronHandler({
      jobOwnerAliases: { supabase_read_only_user: "postgres" },
    });
    const ctx = fakeCtx([baseJob({ username: "constructor" })]);
    const current = buildFactBase([pgCronFact], []);

    const result = await handler.capture(ctx, current);

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.payload["username"]).toBe("constructor");
  });

  test("without jobOwnerAliases the captured username is left verbatim (the handler carries no platform strings)", async () => {
    const ctx = fakeCtx([baseJob({ username: "supabase_read_only_user" })]);
    const current = buildFactBase([pgCronFact], []);

    const result = await pgCronHandler.capture(ctx, current);

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.payload["username"]).toBe(
      "supabase_read_only_user",
    );
  });

  test("a third-role-owned job emits an INTENT_PRIVILEGED warning AND still becomes a fact", async () => {
    const handler = makePgCronHandler({ defaultJobOwner: "postgres" });
    const ctx = fakeCtx([
      baseJob({ jobname: "etl_nightly", username: "etl_runner" }),
    ]);
    const current = buildFactBase([pgCronFact], []);

    const result = await handler.capture(ctx, current);

    // warn + EMIT: the statement stays in the plan for a superuser executor
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.id).toEqual(jobIntentId("etl_nightly"));
    expect(result.diagnostics).toHaveLength(1);
    const diag = result.diagnostics?.[0];
    expect(diag?.code).toBe(INTENT_PRIVILEGED);
    expect(diag?.severity).toBe("warning");
    expect(diag?.message).toContain("etl_nightly");
    expect(diag?.message).toContain("etl_runner");
    expect(diag?.message).toContain("superuser");
    expect(diag?.context).toEqual({ ext: "pg_cron", intentKind: "job" });
  });

  test("no defaultJobOwner configured → no privileged warning (a raw executor is its own authority)", async () => {
    const ctx = fakeCtx([
      baseJob({ jobname: "etl_nightly", username: "etl_runner" }),
    ]);
    const current = buildFactBase([pgCronFact], []);

    const result = await pgCronHandler.capture(ctx, current);

    expect(result.facts).toHaveLength(1);
    expect(result.diagnostics ?? []).toEqual([]);
  });

  test("a job owned by the default owner emits no privileged warning", async () => {
    const handler = makePgCronHandler({ defaultJobOwner: "postgres" });
    const ctx = fakeCtx([baseJob({ username: "postgres" })]);
    const current = buildFactBase([pgCronFact], []);

    const result = await handler.capture(ctx, current);

    expect(result.facts).toHaveLength(1);
    expect(result.diagnostics ?? []).toEqual([]);
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

  test("create: renders select cron.schedule_in_database(...) with quoted literals", () => {
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
      `"select cron.schedule_in_database('nightly', '0 0 * * *', 'select 1', 'postgres', 'postgres', true)"`,
    );
  });

  test("create: replays database, username, and active via cron.schedule_in_database", () => {
    const fact: Fact = {
      id: jobIntentId("reports"),
      payload: {
        schedule: "0 0 * * *",
        command: "select 1",
        database: "analytics",
        username: "reporter",
        active: false,
      },
    };
    const actions = jobRule?.create(fact, undefined as never);
    expect(actions).toHaveLength(1);
    expect(actions?.[0]?.sql).toMatchInlineSnapshot(
      `"select cron.schedule_in_database('reports', '0 0 * * *', 'select 1', 'analytics', 'reporter', false)"`,
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
      `"select cron.schedule_in_database('bob''s job', '0 0 * * *', 'select ''hi'' from t where x = ''y''', 'postgres', 'postgres', true)"`,
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
    expect(
      actions?.[0]?.sql.startsWith("select cron.schedule_in_database("),
    ).toBe(true);
    expect(actions?.[0]?.sql).toMatchInlineSnapshot(
      `"select cron.schedule_in_database('dollar', '0 0 * * *', 'select ''$$not a dollar quote$$''', 'postgres', 'postgres', true)"`,
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

/**
 * pg_cron requires SUPERUSER for ANY non-NULL `username` argument — even one
 * naming the calling role. `NULL` means `current_user` and needs no privilege.
 * A profile that declares a default job owner also declares who executes the
 * plan, so a job owned by that role replays with an elided username and stays
 * applyable by a plain (non-superuser) connection.
 */
describe("makePgCronHandler: defaultJobOwner username elision", () => {
  const configuredRule = makePgCronHandler({ defaultJobOwner: "postgres" })
    .intentKinds?.["job"];
  const bareRule = pgCronHandler.intentKinds?.["job"];

  const jobFact = (username: string, database = "postgres"): Fact => ({
    id: jobIntentId("nightly"),
    payload: {
      schedule: "0 0 * * *",
      command: "select 1",
      database,
      username,
      active: true,
    },
  });

  test("create: a job owned by the default owner renders a bare NULL username", () => {
    const actions = configuredRule?.create(
      jobFact("postgres"),
      undefined as never,
    );
    expect(actions).toHaveLength(1);
    expect(actions?.[0]?.sql).toMatchInlineSnapshot(
      `"select cron.schedule_in_database('nightly', '0 0 * * *', 'select 1', 'postgres', NULL, true)"`,
    );
  });

  test("create: a job owned by a THIRD role keeps the explicit username literal", () => {
    const actions = configuredRule?.create(
      jobFact("etl_runner", "analytics"),
      undefined as never,
    );
    expect(actions?.[0]?.sql).toMatchInlineSnapshot(
      `"select cron.schedule_in_database('nightly', '0 0 * * *', 'select 1', 'analytics', 'etl_runner', true)"`,
    );
  });

  test("create: with NO defaultJobOwner configured nothing is elided (vanilla PG, superuser executor)", () => {
    const actions = bareRule?.create(jobFact("postgres"), undefined as never);
    expect(actions?.[0]?.sql).toMatchInlineSnapshot(
      `"select cron.schedule_in_database('nightly', '0 0 * * *', 'select 1', 'postgres', 'postgres', true)"`,
    );
  });

  test("payloadAttrs still carries username — elision is a RENDER decision, not a capture normalization", () => {
    expect(configuredRule?.payloadAttrs).toEqual([
      "schedule",
      "command",
      "database",
      "username",
      "active",
    ]);
  });
});
