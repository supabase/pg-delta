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

  test("the reservation is case-INSENSITIVE (APFS/NTFS fold one directory)", () => {
    // `_CUSTOM/schema.sql` and `_custom/…` are ONE physical file on a
    // case-insensitive filesystem, so an exact-case reservation puts exported
    // schema content inside the reserved hand-authored directory: nothing
    // detects it (no exported action path lives under `_custom/`, so the
    // case-collision fold never sees a collision) and `writeExportFiles`
    // classifies a hand-authored `_custom/schema.sql` as an UPDATE and
    // overwrites it. Every case variant escapes instead, preserving its own
    // spelling after the `%5F`.
    // (`_CUSTOM` and `_Cluster` are not case twins of EACH OTHER, so this
    // isolates the reservation from the separate case-collision fold.)
    const flat = names(schemaFacts("_CUSTOM", "_Cluster"));
    expect(flat).toContain("%5FCUSTOM/schema.sql");
    expect(flat).toContain("%5FCluster/schema.sql");
    expect(flat).toContain("%5FCluster/tables/t.sql");
    // no emitted path may land in a reserved root under case folding
    const roots = flat.map((n) => n.split("/")[0]?.toLowerCase());
    expect(roots).not.toContain("_custom");
    expect(roots).not.toContain("_cluster");
    // each case variant keeps its own spelling → distinct objects stay distinct
    expect(names(schemaFacts("_custom"))).toContain("%5Fcustom/schema.sql");
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
