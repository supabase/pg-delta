/**
 * Regression (PR #318 review): `schema export --profile supabase` extracts a
 * named pg_cron job as an `extensionIntent` fact, but `exportSqlFiles`' internal
 * `plan(∅ → fb)` must be given the profile's intent rules — otherwise the rule
 * resolver throws "no intent rule registered" and export fails instead of
 * writing files. Pins that `intentRules` is forwarded. Pure — no DB.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { buildIntentRuleIndex } from "../plan/rules.ts";
import { pgCronHandler } from "../policy/extensions/index.ts";
import { exportSqlFiles } from "./export-sql-files.ts";

const pgCron: StableId = { kind: "extension", name: "pg_cron" };
const jobId: StableId = {
  kind: "extensionIntent",
  ext: "pg_cron",
  intentKind: "job",
  key: "nightly_prune",
};

const fb = buildFactBase(
  [
    { id: { kind: "schema", name: "public" }, payload: {} },
    { id: pgCron, payload: { schema: "pg_catalog", relocatable: false } },
    {
      id: jobId,
      payload: {
        schedule: "0 0 * * *",
        command: "DELETE FROM public.audit_log",
        database: "postgres",
        username: "postgres",
        active: true,
      },
    },
  ],
  [{ from: jobId, to: pgCron, kind: "depends" }],
);

const intentRules = buildIntentRuleIndex([pgCronHandler]);

describe("schema export forwards intent rules to the internal plan()", () => {
  test("with intentRules, a named cron job exports as its replay SQL", () => {
    const dump = exportSqlFiles(fb, { layout: "by-object", intentRules })
      .map((f) => f.sql)
      .join("\n");
    expect(dump).toContain("cron.schedule('nightly_prune'");
  });

  test("WITHOUT intentRules, export throws the unregistered-rule error (the bug this guards)", () => {
    expect(() => exportSqlFiles(fb, { layout: "by-object" })).toThrow(
      /no intent rule registered/,
    );
  });
});
