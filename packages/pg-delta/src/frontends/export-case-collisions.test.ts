/**
 * Export paths that differ only by case ("case twins", e.g. `Users.sql` vs
 * `users.sql`) are one physical file on the default macOS (APFS) and Windows
 * (NTFS) filesystems: the second write silently overwrites the first, an
 * object vanishes from the export, and apply wedges on its dependents
 * (issue #365). Exports are portable artifacts — written on Linux, checked
 * out on APFS — so collisions must be prevented at write time on EVERY
 * platform: every path segment folds to a CANONICAL spelling (the
 * lexicographically smallest spelling actually present), so case-twin files
 * merge into one shared file and every descendant of case-twin directories
 * agrees on the parent's casing. Each segment's canonical spelling is one a
 * member actually uses. Pure — no DB.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import { foldCaseCollidingPaths } from "./export-case-collisions.ts";
import { exportSqlFiles, type ExportOptions } from "./export-sql-files.ts";

function names(files: { name: string; sql: string }[]): string[] {
  return files.map((f) => f.name);
}

function expectCaseInsensitivelyUnique(paths: string[]): void {
  const folded = paths.map((p) => p.toLowerCase());
  expect(new Set(folded).size).toBe(paths.length);
}

describe("foldCaseCollidingPaths", () => {
  test("no collisions → empty map (every path keeps its own file)", () => {
    const folds = foldCaseCollidingPaths([
      "schemas/public/tables/users.sql",
      "schemas/public/tables/orders.sql",
      "schemas/public/views/users.sql", // same basename, different dir — fine
    ]);
    expect(folds.size).toBe(0);
  });

  test("colliding twins fold to the lexicographically-smallest member", () => {
    const folds = foldCaseCollidingPaths([
      "schemas/public/tables/Users.sql",
      "schemas/public/tables/users.sql",
      "schemas/public/tables/orders.sql",
    ]);
    // "Users.sql" < "users.sql" — the canonical member keeps its own path
    // (identity → absent from the map); the other twin folds onto it.
    expect(folds.has("schemas/public/tables/Users.sql")).toBe(false);
    expect(folds.get("schemas/public/tables/users.sql")).toBe(
      "schemas/public/tables/Users.sql",
    );
    // bystander untouched
    expect(folds.has("schemas/public/tables/orders.sql")).toBe(false);
  });

  test("the fold target is always a member — never a synthesized path", () => {
    // No all-lowercase member: folding to a synthesized "users.sql" could
    // silently overwrite a hand-authored file at that path (PR #368 review).
    const folds = foldCaseCollidingPaths([
      "schemas/public/tables/Users.sql",
      "schemas/public/tables/USERS.sql",
    ]);
    expect(folds.has("schemas/public/tables/USERS.sql")).toBe(false);
    expect(folds.get("schemas/public/tables/Users.sql")).toBe(
      "schemas/public/tables/USERS.sql",
    );
  });

  test("a lone twin keeps its spelling; adding the other merges INTO it", () => {
    // no-churn guarantee (PR #368 review): a singleton is never rewritten,
    // and the merge lands on the pre-existing spelling when it sorts first.
    expect(
      foldCaseCollidingPaths(["schemas/public/tables/Users.sql"]).size,
    ).toBe(0);
    const folds = foldCaseCollidingPaths([
      "schemas/public/tables/Users.sql",
      "schemas/public/tables/users.sql",
    ]);
    expect(folds.has("schemas/public/tables/Users.sql")).toBe(false);
  });

  test("folding is independent of input order", () => {
    const forward = foldCaseCollidingPaths([
      "schemas/public/tables/Users.sql",
      "schemas/public/tables/users.sql",
    ]);
    const backward = foldCaseCollidingPaths([
      "schemas/public/tables/users.sql",
      "schemas/public/tables/Users.sql",
    ]);
    expect(Object.fromEntries(forward)).toEqual(Object.fromEntries(backward));
  });

  test("descendants of case-twin directories fold to one casing", () => {
    // Schema case twins with DIFFERENT object sets (PR #368 review): the
    // singleton table under `app` must agree with the canonical `App`
    // directory casing, or the manifest and the physical APFS tree disagree
    // and the next re-export refuses ("unmanaged" false positive).
    const folds = foldCaseCollidingPaths([
      "schemas/App/schema.sql",
      "schemas/app/schema.sql",
      "schemas/App/tables/a.sql",
      "schemas/app/tables/b.sql",
    ]);
    expect(folds.get("schemas/app/schema.sql")).toBe("schemas/App/schema.sql");
    // no exact-path peer, but the parent directory is case-colliding
    expect(folds.get("schemas/app/tables/b.sql")).toBe(
      "schemas/App/tables/b.sql",
    );
    expect(folds.has("schemas/App/tables/a.sql")).toBe(false);
  });

  test("multi-segment divergence composes a synthesized destination", () => {
    // Case twins in TWO segments with opposite lexical winners: per-segment
    // canonicalization composes `schemas/App/tables/FOO.sql`, a path that is
    // NEITHER member. Directory-casing consistency requires this composition
    // (a whole-path member would re-split the `App`/`app` tree). The export
    // owns every destination it writes — see the PR #368 triage section in
    // docs/roadmap/pg-delta-next-follow-ups.md.
    const folds = foldCaseCollidingPaths([
      "schemas/App/tables/foo.sql",
      "schemas/app/tables/FOO.sql",
    ]);
    expect(folds.get("schemas/App/tables/foo.sql")).toBe(
      "schemas/App/tables/FOO.sql",
    );
    expect(folds.get("schemas/app/tables/FOO.sql")).toBe(
      "schemas/App/tables/FOO.sql",
    );
  });

  test("duplicate mentions of one path are not a collision", () => {
    const folds = foldCaseCollidingPaths([
      "schemas/public/tables/users.sql",
      "schemas/public/tables/users.sql",
    ]);
    expect(folds.size).toBe(0);
  });

  test("merges and casing rewrites are reported through onWarning", () => {
    const warnings: string[] = [];
    foldCaseCollidingPaths(
      [
        "schemas/public/tables/Users.sql",
        "schemas/public/tables/users.sql",
        "schemas/public/tables/orders.sql",
      ],
      (message) => warnings.push(message),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("schemas/public/tables/Users.sql");
    expect(warnings[0]).toContain("schemas/public/tables/users.sql");
    expect(warnings[0]).not.toContain("orders.sql");
  });
});

// end-to-end through exportSqlFiles: case-twin objects must share one file —
// never two paths that are one physical file on a case-insensitive filesystem.
describe("exportSqlFiles merges case-colliding paths into one file", () => {
  const facts: Fact[] = [
    { id: { kind: "schema", name: "public" }, payload: {} },
    {
      id: { kind: "table", schema: "public", name: "Users" },
      parent: { kind: "schema", name: "public" },
      payload: { persistence: "p" },
    },
    {
      id: { kind: "table", schema: "public", name: "users" },
      parent: { kind: "schema", name: "public" },
      payload: { persistence: "p" },
    },
    {
      id: { kind: "table", schema: "public", name: "orders" },
      parent: { kind: "schema", name: "public" },
      payload: { persistence: "p" },
    },
  ];

  for (const layout of ["by-object", "grouped"] as const) {
    test(`case-twin tables share the canonical member file (${layout})`, () => {
      const options: ExportOptions = { layout };
      const files = exportSqlFiles(buildFactBase(facts, []), options);
      expectCaseInsensitivelyUnique(names(files));
      // both twins' DDL lands in ONE shared file at the canonical member path
      const merged = files.find(
        (f) => f.name === "schemas/public/tables/Users.sql",
      );
      expect(merged?.sql).toContain(`"Users"`);
      expect(merged?.sql).toContain(`"users"`);
      expect(names(files)).not.toContain("schemas/public/tables/users.sql");
      // bystander untouched
      expect(names(files)).toContain("schemas/public/tables/orders.sql");
    });
  }

  test("export names are stable across runs and fact order", () => {
    const forward = exportSqlFiles(buildFactBase(facts, []));
    const backward = exportSqlFiles(buildFactBase([...facts].reverse(), []));
    expect(names(forward).sort()).toEqual(names(backward).sort());
  });

  test("identifier dots are encoded — the .sql/.fk.sql namespace is reserved", () => {
    // A table literally named "Foo.fk" must NOT export to `Foo.fk.sql`: that
    // name case-folds into another table's cyclic-FK split file (`foo.fk.sql`,
    // post-data isolation the loader depends on) and wrongly receives the FK
    // split header today (PR #368 review). Dots in identifiers are encoded
    // (`Foo%2Efk.sql`), so no identifier can spoof the literal `.sql` or
    // `.fk.sql` suffixes and no directory segment can ever end in `.sql`
    // (which also rules out file-vs-directory prefix conflicts from group
    // names like "schema.sql").
    const dotted: Fact[] = [
      { id: { kind: "schema", name: "public" }, payload: {} },
      {
        id: { kind: "table", schema: "public", name: "Foo.fk" },
        parent: { kind: "schema", name: "public" },
        payload: { persistence: "p" },
      },
    ];
    const files = exportSqlFiles(buildFactBase(dotted, []));
    const table = files.find((f) => f.name.includes("Foo"));
    expect(table?.name).toBe("schemas/public/tables/Foo%2Efk.sql");
    // no spoofed split-file header on an ordinary table file
    expect(table?.sql).not.toContain("reference cycle");
  });

  test("grouped-layout segments stay within the 255-byte component limit", () => {
    // Group names come from user config and are UNBOUNDED (unlike 63-byte
    // identifiers): a dot-rich group name grows ~3x under dot encoding and
    // overflowed the per-component limit — mkdir/write failed ENAMETOOLONG
    // (PR #368 review). Every seg()-encoded component clamps deterministically.
    const dottedGroup = `a${".a".repeat(70)}`; // 141 chars, 70 dots → 281 encoded
    const facts: Fact[] = [
      { id: { kind: "schema", name: "public" }, payload: {} },
      {
        id: { kind: "table", schema: "public", name: "widgets" },
        parent: { kind: "schema", name: "public" },
        payload: { persistence: "p" },
      },
    ];
    for (const mode of ["subdirectory", "single-file"] as const) {
      const files = exportSqlFiles(buildFactBase(facts, []), {
        layout: "grouped",
        grouping: {
          mode,
          groupPatterns: [{ pattern: "^widgets$", name: dottedGroup }],
        },
      });
      const grouped = files.filter((f) => f.name.includes("a%2Ea"));
      expect(grouped.length).toBeGreaterThan(0);
      for (const file of files) {
        for (const segment of file.name.split("/")) {
          expect(Buffer.byteLength(segment)).toBeLessThanOrEqual(255);
        }
      }
    }
  });

  test("ordered-layout names stay within the 255-byte filename limit", () => {
    // Dot encoding can TRIPLE a dot-heavy identifier's length; the ordered
    // layout flattens the whole path into ONE filename component, so two
    // 63-byte identifiers full of dots overflowed the common 255-byte limit
    // and the write failed ENAMETOOLONG (PR #368 review). Over-long names
    // clamp to a deterministic truncate+hash tail — ordered names are
    // positional and renumber on every export, so no stability is lost.
    const dotted = `v${".b".repeat(31)}`; // 63 chars, 31 dots
    const facts: Fact[] = [
      { id: { kind: "schema", name: dotted }, payload: {} },
      {
        id: { kind: "table", schema: dotted, name: dotted },
        parent: { kind: "schema", name: dotted },
        payload: { persistence: "p" },
      },
    ];
    const files = exportSqlFiles(buildFactBase(facts, []), {
      layout: "ordered",
    });
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(Buffer.byteLength(file.name)).toBeLessThanOrEqual(255);
      expect(file.name.endsWith(".sql")).toBe(true);
    }
    // clamping is deterministic across runs
    const again = exportSqlFiles(buildFactBase(facts, []), {
      layout: "ordered",
    });
    expect(names(again)).toEqual(names(files));
  });
});
