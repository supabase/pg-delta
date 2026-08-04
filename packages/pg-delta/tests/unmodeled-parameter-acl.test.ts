/**
 * `pg_parameter_acl` (PostgreSQL 15+) backs `GRANT SET ON PARAMETER` /
 * `GRANT ALTER SYSTEM ON PARAMETER`. It is not modeled as a fact by the v1
 * engine (see COVERAGE.md), so — per the completeness floor in
 * `src/extract/unmodeled.ts` — a user-created parameter ACL MUST surface as an
 * `unmodeled_kind` diagnostic, never be silently dropped.
 *
 * `pg_parameter_acl` is a SHARED (cluster-wide) catalog, and the test cluster
 * is a shared singleton across test files — this test revokes the grant and
 * drops its role in a `finally` so the ACL never leaks into another test's
 * extraction.
 */
import { describe, expect, test } from "bun:test";
import { extract, type ExtractResult } from "../src/extract/extract.ts";
import { createTestDb } from "./containers.ts";

const PG_MAJOR = Number(
  /postgres:(\d+)/.exec(
    process.env["PGDELTA_TEST_IMAGE"] ?? "postgres:17-alpine",
  )?.[1] ?? "17",
);

describe.skipIf(PG_MAJOR < 15)(
  "extract: unmodeled pg_parameter_acl detection",
  () => {
    test("a user parameter ACL grant is reported, not silently dropped", async () => {
      const db = await createTestDb("param_acl");
      const roleName = `param_acl_role_${db.name}`;
      try {
        await db.pool.query(`CREATE ROLE ${roleName}`);
        try {
          await db.pool.query(`GRANT SET ON PARAMETER work_mem TO ${roleName}`);

          const result: ExtractResult = await extract(db.pool);
          const d = result.diagnostics.find(
            (diag) =>
              diag.code === "unmodeled_kind" &&
              diag.context?.["kind"] === "parameter ACL",
          );

          expect(d).toBeDefined();
          expect(d?.severity).toBe("warning");
          expect(
            ((d?.context?.["samples"] ?? []) as string[]).join(" "),
          ).toContain("work_mem");
        } finally {
          await db.pool.query(
            `REVOKE SET ON PARAMETER work_mem FROM ${roleName}`,
          );
          await db.pool.query(`DROP ROLE ${roleName}`);
        }
      } finally {
        await db.drop();
      }
    }, 120_000);
  },
);
