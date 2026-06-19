import { describe, expect, test } from "bun:test";

import * as pkg from "../src/index.ts";
import {
  generateGo,
  generatePython,
  generateSwift,
  generateTypescript,
} from "../src/generation/index.ts";
import { introspect } from "../src/introspection/index.ts";

/**
 * Surface smoke test. It pins the public API shape so the subpath exports and
 * barrel stay wired up. All four generators (PGMETA-106/107) and `introspect`
 * (PGMETA-108/109/110) are implemented; the focused behavior lives in
 * `test/generation/` and `test/introspection/`.
 */
describe("public API surface", () => {
  test("barrel re-exports introspection and generation entry points", () => {
    expect(typeof pkg.introspect).toBe("function");
    expect(typeof pkg.generateTypescript).toBe("function");
    expect(typeof pkg.generateGo).toBe("function");
    expect(typeof pkg.generatePython).toBe("function");
    expect(typeof pkg.generateSwift).toBe("function");
  });

  test("introspect assembles an empty GeneratorMetadata from empty results", async () => {
    const metadata = await introspect({ query: async () => ({ rows: [] }) });
    expect(Object.keys(metadata).sort()).toEqual([
      "columns",
      "foreignTables",
      "functions",
      "materializedViews",
      "relationships",
      "schemas",
      "tables",
      "types",
      "views",
    ]);
    expect(metadata.tables).toEqual([]);
    expect(metadata.relationships).toEqual([]);
  });

  const emptyMetadata = {
    schemas: [],
    tables: [],
    foreignTables: [],
    views: [],
    materializedViews: [],
    columns: [],
    relationships: [],
    functions: [],
    types: [],
  };

  test("implemented generators produce output for empty metadata", async () => {
    expect(generateGo(emptyMetadata)).toContain("package database");
    expect(generatePython(emptyMetadata)).toContain(
      "from pydantic import BaseModel",
    );
    expect(generateSwift(emptyMetadata)).toContain("import Foundation");
    expect(await generateTypescript(emptyMetadata)).toContain(
      "export type Database",
    );
  });
});
