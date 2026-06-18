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
 * Surface smoke test. Real generation/introspection coverage lands with the
 * implementations (PGMETA-106/107/108/110); for now this pins the public API
 * shape so the subpath exports and barrel stay wired up.
 */
describe("public API surface", () => {
  test("barrel re-exports introspection and generation entry points", () => {
    expect(typeof pkg.introspect).toBe("function");
    expect(typeof pkg.generateTypescript).toBe("function");
    expect(typeof pkg.generateGo).toBe("function");
    expect(typeof pkg.generatePython).toBe("function");
    expect(typeof pkg.generateSwift).toBe("function");
  });

  test("introspect rejects until implemented", () => {
    expect(() => introspect({ query: async () => ({ rows: [] }) })).toThrow(
      "introspect() is not implemented yet",
    );
  });

  test("synchronous generators throw until implemented", () => {
    const metadata = {
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
    expect(() => generateGo(metadata)).toThrow("not implemented yet");
    expect(() => generatePython(metadata)).toThrow("not implemented yet");
    expect(() => generateSwift(metadata)).toThrow("not implemented yet");
    expect(() => generateTypescript(metadata)).toThrow("not implemented yet");
  });
});
