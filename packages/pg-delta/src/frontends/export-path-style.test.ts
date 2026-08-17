/**
 * `pathStyle` decides the two ROOT segments of every export path, orthogonally
 * to `layout`. These are pure fact-base → path assertions (no database): the
 * end-to-end coverage lives in tests/export-layout.test.ts and
 * tests/export.test.ts (round-trip through the escape).
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import { CUSTOM_DIR_NAME } from "./custom-dir.ts";
import { exportSqlFiles, RESERVED_ROOT_SEGMENTS } from "./export-sql-files.ts";

const schemaFacts = (...schemas: string[]): Fact[] =>
  schemas.flatMap((name): Fact[] => [
    { id: { kind: "schema", name }, payload: {} },
    {
      id: { kind: "table", schema: name, name: "t" },
      parent: { kind: "schema", name },
      payload: { persistence: "p" },
    },
  ]);

const names = (facts: Fact[], options?: Parameters<typeof exportSqlFiles>[1]) =>
  exportSqlFiles(buildFactBase(facts, []), options).map((f) => f.name);

describe("export path style", () => {
  test("flat is the default: schema dirs at the root", () => {
    const flat = names(schemaFacts("app"));
    expect(flat).toContain("app/schema.sql");
    expect(flat).toContain("app/tables/t.sql");
    expect(flat.some((n) => n.startsWith("schemas/"))).toBe(false);
    expect(names(schemaFacts("app"), { pathStyle: "flat" })).toEqual(flat);
  });

  test('"nested" keeps the historical schemas/ wrapper', () => {
    const nested = names(schemaFacts("app"), { pathStyle: "nested" });
    expect(nested).toContain("schemas/app/schema.sql");
    expect(nested).toContain("schemas/app/tables/t.sql");
  });

  test("reserved root names escape their leading underscore under flat", () => {
    const flat = names(schemaFacts("_cluster", "_custom", "_foo"));
    expect(flat).toContain("%5Fcluster/schema.sql");
    expect(flat).toContain("%5Fcustom/schema.sql");
    // an ordinary underscore-prefixed schema is untouched
    expect(flat).toContain("_foo/schema.sql");
    // …and the escape is injective: `%` is itself percent-encoded, so no
    // other identifier can produce the escaped spelling.
    expect(names(schemaFacts("%5Fcluster"))).toContain(
      "%255Fcluster/schema.sql",
    );
  });

  test("nested reserves nothing — the schemas/ wrapper separates namespaces", () => {
    const nested = names(schemaFacts("_cluster", "_custom"), {
      pathStyle: "nested",
    });
    expect(nested).toContain("schemas/_cluster/schema.sql");
    expect(nested).toContain("schemas/_custom/schema.sql");
  });

  test("the reserved set agrees with the _custom directory contract", () => {
    // export-sql-files.ts keeps the name as a literal so the pure path layer
    // does not import the fs-touching custom-dir module; this pins them equal.
    expect(RESERVED_ROOT_SEGMENTS.has(CUSTOM_DIR_NAME)).toBe(true);
  });
});
