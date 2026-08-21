/**
 * Stages 3–4: reorderOnFailure after default order sticks.
 */
import { describe, expect, test } from "bun:test";
import {
  loadSqlFiles,
  ShadowLoadError,
} from "../src/frontends/load-sql-files.ts";
import {
  analyzeForShadow,
  attachReorderPredecessors,
  classesByFileFromAnalyzed,
  preorderFilesByKind,
  splitAndReorderFile,
} from "../src/frontends/sql-order.ts";
import { createTestDb } from "./containers.ts";

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

const MIXED_ADD_THEN_TABLE = [
  { name: "00_pub.sql", sql: "CREATE PUBLICATION p;" },
  {
    name: "01_mixed.sql",
    sql: "ALTER PUBLICATION p ADD TABLE public.t;\nCREATE TABLE public.t (id integer);",
  },
];

describe("loadSqlFiles — reorderOnFailure", () => {
  test("statement-kind unblocks ADD-then-CREATE TABLE and warns", async () => {
    const shadow = await createTestDb("rof_stmt");
    try {
      const analyzed = await analyzeForShadow(MIXED_ADD_THEN_TABLE);
      const originalSqlByName = new Map(
        MIXED_ADD_THEN_TABLE.map((file) => [file.name, file.sql]),
      );
      const warnings: string[] = [];
      let fileKindCalls = 0;
      const result = await loadSqlFiles(MIXED_ADD_THEN_TABLE, shadow.pool, {
        connectionReuse: "keep",
        reorderOnFailure: true,
        onWarning: (m) => warnings.push(m),
        enrichLoadAssistFailures: (failures) =>
          attachReorderPredecessors(failures, analyzed, originalSqlByName),
        reorderFilesByKind: (pending) => {
          fileKindCalls++;
          return preorderFilesByKind(
            pending,
            classesByFileFromAnalyzed(analyzed),
          );
        },
        splitFileByKind: (file) => splitAndReorderFile(file, analyzed),
      });
      expect(fileKindCalls).toBe(1);
      expect(
        result.factBase.has({ kind: "table", schema: "public", name: "t" }),
      ).toBe(true);
      expect(
        result.diagnostics.some((d) => d.code === "reorder_on_failure"),
      ).toBe(true);
      const reorder = result.diagnostics.find(
        (d) => d.code === "reorder_on_failure",
      );
      expect(reorder?.message).toMatchInlineSnapshot(`
        "Default load order stuck; reordered (statement-kind).
          move 01_mixed.sql:1 ALTER PUBLICATION p ADD TABLE public.t
          after 01_mixed.sql:2 CREATE TABLE public.t (id integer);
        loadOrder cannot fix same-file order — edit or split the file."
      `);
      expect(warnings.join("\n")).toEqual(reorder?.message ?? "");
      expect(reorder?.context).toMatchInlineSnapshot(`
        {
          "failures": [
            {
              "after": {
                "excerpt": "CREATE TABLE public.t (id integer);",
                "file": "01_mixed.sql",
                "line": 2,
              },
              "error": "relation "public.t" does not exist",
              "excerpt": "ALTER PUBLICATION p ADD TABLE public.t",
              "file": "01_mixed.sql",
              "line": 1,
            },
          ],
          "files": [
            "01_mixed.sql",
          ],
          "kind": "statement-kind",
        }
      `);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("reorderOnFailure false stays stuck with no warning", async () => {
    const shadow = await createTestDb("rof_off");
    try {
      const err = await captureError(
        loadSqlFiles(MIXED_ADD_THEN_TABLE, shadow.pool, {
          connectionReuse: "keep",
          reorderOnFailure: false,
        }),
      );
      expect(err).toBeInstanceOf(ShadowLoadError);
      expect(
        (err as ShadowLoadError).details.some(
          (d) => d.code === "stuck_statement",
        ),
      ).toBe(true);
      expect(
        (err as ShadowLoadError).details.some(
          (d) => d.code === "reorder_on_failure",
        ),
      ).toBe(false);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("caller order is preserved: table before publication is one round", async () => {
    const shadow = await createTestDb("rof_order");
    try {
      let fileKindCalls = 0;
      const result = await loadSqlFiles(
        [
          {
            name: "public/tables/t.sql",
            sql: "CREATE TABLE public.t (id integer); CREATE PUBLICATION p;",
          },
          {
            name: "_cluster/publications.sql",
            sql: "ALTER PUBLICATION p ADD TABLE public.t;",
          },
        ],
        shadow.pool,
        {
          connectionReuse: "keep",
          reorderOnFailure: true,
          reorderFilesByKind: (pending) => {
            fileKindCalls++;
            return pending;
          },
        },
      );
      expect(result.rounds).toBe(1);
      expect(fileKindCalls).toBe(0);
      expect(
        result.diagnostics.some((d) => d.code === "reorder_on_failure"),
      ).toBe(false);
      expect(
        result.factBase.has({ kind: "table", schema: "public", name: "t" }),
      ).toBe(true);
    } finally {
      await shadow.drop();
    }
  }, 60_000);
});
