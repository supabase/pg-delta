import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Change } from "../change.types.ts";
import { loadDeclarativeSchema } from "../declarative-apply/discover-sql.ts";
import { disambiguateCaseCollisions, groupChangesByFile } from "./grouper.ts";

// ============================================================================
// Helpers – minimal Change stubs
// ============================================================================

/** Minimal table change stub. */
function tableChange(opts: { schema: string; name: string }): Change {
  return {
    objectType: "table",
    operation: "create",
    scope: "object",
    table: {
      schema: opts.schema,
      name: opts.name,
      is_partition: false,
      parent_name: null,
      parent_schema: null,
    },
    serialize: () => `CREATE TABLE "${opts.schema}"."${opts.name}" ()`,
  } as unknown as Change;
}

/** All paths in a group list, for assertions. */
function paths(groups: ReturnType<typeof groupChangesByFile>): string[] {
  return groups.map((group) => group.path);
}

// ============================================================================
// disambiguateCaseCollisions
// ============================================================================

describe("disambiguateCaseCollisions", () => {
  test("returns an empty map when no paths collide", () => {
    const renames = disambiguateCaseCollisions([
      "schemas/public/tables/users.sql",
      "schemas/public/tables/orders.sql",
      "schemas/public/views/users.sql",
    ]);
    expect(renames.size).toBe(0);
  });

  test("renames every member of a case-colliding set", () => {
    const renames = disambiguateCaseCollisions([
      "schemas/public/tables/Users.sql",
      "schemas/public/tables/users.sql",
      "schemas/public/tables/orders.sql",
    ]);
    expect(renames.size).toBe(2);
    expect(renames.has("schemas/public/tables/Users.sql")).toBe(true);
    expect(renames.has("schemas/public/tables/users.sql")).toBe(true);
    // Non-colliding path untouched.
    expect(renames.has("schemas/public/tables/orders.sql")).toBe(false);
  });

  test("renamed paths keep the .sql extension and original casing", () => {
    const renames = disambiguateCaseCollisions([
      "schemas/public/tables/Users.sql",
      "schemas/public/tables/users.sql",
    ]);
    const renamed = renames.get("schemas/public/tables/Users.sql");
    expect(renamed).toMatch(
      /^schemas\/public\/tables\/Users-[0-9a-f]{8}\.sql$/,
    );
  });

  test("renames are deterministic and independent of input order", () => {
    const forward = disambiguateCaseCollisions([
      "schemas/public/tables/Users.sql",
      "schemas/public/tables/users.sql",
    ]);
    const backward = disambiguateCaseCollisions([
      "schemas/public/tables/users.sql",
      "schemas/public/tables/Users.sql",
    ]);
    expect(forward.get("schemas/public/tables/Users.sql")).toBe(
      backward.get("schemas/public/tables/Users.sql") as string,
    );
    expect(forward.get("schemas/public/tables/users.sql")).toBe(
      backward.get("schemas/public/tables/users.sql") as string,
    );
  });

  test("detects collisions across directory segments (schema case twins)", () => {
    const renames = disambiguateCaseCollisions([
      "schemas/Public/tables/users.sql",
      "schemas/public/tables/users.sql",
    ]);
    expect(renames.size).toBe(2);
    const values = [...renames.values()].map((p) => p.toLowerCase());
    expect(new Set(values).size).toBe(2);
  });
});

// ============================================================================
// groupChangesByFile – case-twin handling
// ============================================================================

describe("groupChangesByFile case-insensitive collisions", () => {
  test("case-twin tables map to case-insensitively distinct paths", () => {
    const groups = groupChangesByFile([
      tableChange({ schema: "public", name: "Users" }),
      tableChange({ schema: "public", name: "users" }),
    ]);

    expect(groups).toHaveLength(2);
    const [first, second] = paths(groups);
    expect(first).not.toBe(second);
    expect((first as string).toLowerCase()).not.toBe(
      (second as string).toLowerCase(),
    );
  });

  test("non-colliding tables keep their current paths", () => {
    const groups = groupChangesByFile([
      tableChange({ schema: "public", name: "users" }),
      tableChange({ schema: "public", name: "orders" }),
    ]);

    expect(paths(groups).sort()).toEqual([
      "schemas/public/tables/orders.sql",
      "schemas/public/tables/users.sql",
    ]);
  });

  test("a collision does not rename unrelated files", () => {
    const groups = groupChangesByFile([
      tableChange({ schema: "public", name: "Users" }),
      tableChange({ schema: "public", name: "users" }),
      tableChange({ schema: "public", name: "orders" }),
    ]);

    expect(paths(groups)).toContain("schemas/public/tables/orders.sql");
    expect(paths(groups)).not.toContain("schemas/public/tables/users.sql");
    expect(paths(groups)).not.toContain("schemas/public/tables/Users.sql");
  });

  test("renamed paths are stable across export runs and input order", () => {
    const groups = groupChangesByFile([
      tableChange({ schema: "public", name: "Users" }),
      tableChange({ schema: "public", name: "users" }),
    ]);
    const reversed = groupChangesByFile([
      tableChange({ schema: "public", name: "users" }),
      tableChange({ schema: "public", name: "Users" }),
    ]);

    expect(paths(groups).sort()).toEqual(paths(reversed).sort());
  });

  test("case-twin exports survive a write to a real filesystem", async () => {
    // On case-insensitive filesystems (APFS/NTFS) `Users.sql` and `users.sql`
    // are one physical file; without disambiguation the second write silently
    // overwrites the first (issue #365). This reproduces the CLI write loop.
    const groups = groupChangesByFile([
      tableChange({ schema: "public", name: "Users" }),
      tableChange({ schema: "public", name: "users" }),
      tableChange({ schema: "public", name: "orders" }),
    ]);

    const outDir = await mkdtemp(path.join(tmpdir(), "pg-delta-export-"));
    try {
      for (const group of groups) {
        const filePath = path.join(outDir, group.path);
        await mkdir(path.dirname(filePath), { recursive: true });
        const sql = group.changes
          .map((change) => change.serialize())
          .join("\n");
        await writeFile(filePath, sql);
      }

      // Every manifest entry must exist as its own physical file.
      const tablesDir = path.join(outDir, "schemas", "public", "tables");
      const onDisk = await readdir(tablesDir);
      expect(onDisk.length).toBe(groups.length);

      // Reimport: discovery must find one entry per exported object, and no
      // object's DDL may have been overwritten.
      const entries = await loadDeclarativeSchema(outDir);
      expect(entries).toHaveLength(groups.length);
      const allSql = entries.map((entry) => entry.sql).join("\n");
      expect(allSql).toContain('CREATE TABLE "public"."Users" ()');
      expect(allSql).toContain('CREATE TABLE "public"."users" ()');
      expect(allSql).toContain('CREATE TABLE "public"."orders" ()');
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
