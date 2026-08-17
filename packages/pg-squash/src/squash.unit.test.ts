import { describe, expect, test } from "bun:test";
import { nextMidpointSplit, planSquash } from "./plan.ts";

describe("planSquash", () => {
  test("merges consecutive CREATE TABLE files into one output", async () => {
    const chain = [
      { name: "0001_a.sql", sql: "CREATE TABLE a (id int);" },
      { name: "0002_b.sql", sql: "CREATE TABLE b (id int);" },
      { name: "0003_c.sql", sql: "CREATE TABLE c (id int);" },
    ];
    const planned = await planSquash(chain, 17);
    expect(planned.refused).toBe(false);
    expect(planned.files).toHaveLength(1);
    expect(planned.files[0]?.name).toBe("0001_squashed.sql");
    expect(planned.files[0]?.sql).toContain("BEGIN;");
    expect(planned.files[0]?.sql).toContain("CREATE TABLE a");
    expect(planned.files[0]?.sql).toContain("CREATE TABLE c");
    expect(planned.files[0]?.sql).toContain("COMMIT;");
  });

  test("keeps CREATE INDEX CONCURRENTLY in its own barrier file", async () => {
    const planned = await planSquash(
      [
        { name: "0001_t.sql", sql: "CREATE TABLE t (id int);" },
        {
          name: "0002_idx.sql",
          sql: "CREATE INDEX CONCURRENTLY t_id ON t (id);",
        },
      ],
      17,
    );
    expect(planned.files).toHaveLength(2);
    expect(planned.files[1]?.sql).toContain("-- pg-delta: transaction=false");
  });

  test("records refused CREATE DATABASE", async () => {
    const planned = await planSquash(
      [{ name: "0001_db.sql", sql: "CREATE DATABASE nope;" }],
      17,
    );
    expect(planned.refused).toBe(true);
    expect(
      planned.diagnostics.some((d) => d.code === "refused-statement"),
    ).toBe(true);
  });

  test("100 CREATE TABLE files pack to 1 output file", async () => {
    const chain = Array.from({ length: 100 }, (_, i) => ({
      name: `${String(i + 1).padStart(4, "0")}_t.sql`,
      sql: `CREATE TABLE t_${i} (id int);`,
    }));
    const planned = await planSquash(chain, 17);
    expect(planned.files).toHaveLength(1);
  });

  test("splitBefore flushes a new transaction at the named statement", async () => {
    const planned = await planSquash(
      [
        { name: "0001_a.sql", sql: "CREATE TABLE a (id int);" },
        { name: "0002_b.sql", sql: "CREATE TABLE b (id int);" },
      ],
      17,
      { splitBefore: new Set(["0002_b.sql:0"]) },
    );
    expect(planned.files).toHaveLength(2);
  });

  test("nextMidpointSplit skips the first key and already-split keys", () => {
    expect(nextMidpointSplit(["a:0", "b:0", "c:0"], new Set())).toBe("b:0");
    expect(nextMidpointSplit(["a:0"], new Set())).toBeUndefined();
    expect(nextMidpointSplit(["a:0", "b:0"], new Set(["b:0"]))).toBeUndefined();
  });
});
