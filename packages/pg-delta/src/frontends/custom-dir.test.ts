/**
 * The reserved `_custom/` directory (docs/architecture/custom-folder.md §2).
 *
 * `isCustomPath` is the single predicate every export-side surface (pruner,
 * unmanaged scan, write guard) keys on, so it must recognize the ROOT-level
 * `_custom` segment only — a nested `schemas/app/_custom/x.sql` is an ordinary
 * managed path, and a `_customer/` sibling must not be swept in by a prefix
 * match. `scaffoldCustomReadme` creates the folder + README once and never
 * overwrites an operator's edits. No DB.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CUSTOM_DIR_NAME,
  CUSTOM_README_TEMPLATE,
  isCustomPath,
  scaffoldCustomReadme,
} from "./custom-dir.ts";

describe("isCustomPath", () => {
  test("matches the reserved root directory and everything under it", () => {
    expect(CUSTOM_DIR_NAME).toBe("_custom");
    expect(isCustomPath("_custom")).toBe(true);
    expect(isCustomPath("_custom/text-search.sql")).toBe(true);
    expect(isCustomPath("_custom/nested/deep/seed.sql")).toBe(true);
    // platform separators (readdirSync on win32 / path.join output)
    expect(isCustomPath("_custom\\text-search.sql")).toBe(true);
  });

  test("does not match a prefix sibling or a nested _custom", () => {
    expect(isCustomPath("_customer/x.sql")).toBe(false);
    expect(isCustomPath("_custom.sql")).toBe(false);
    expect(isCustomPath("schemas/app/_custom/x.sql")).toBe(false);
    expect(isCustomPath("schemas/app/tables/t.sql")).toBe(false);
    expect(isCustomPath("")).toBe(false);
  });
});

describe("scaffoldCustomReadme", () => {
  test("creates _custom/README.md with the documented contract", () => {
    const root = mkdtempSync(join(tmpdir(), "pgd-customdir-"));
    expect(scaffoldCustomReadme(root)).toBe(true);
    const readme = join(root, "_custom", "README.md");
    expect(existsSync(readme)).toBe(true);
    const body = readFileSync(readme, "utf8");
    expect(body).toBe(CUSTOM_README_TEMPLATE);
    // the contract the folder promises must be spelled out in the scaffold
    expect(body).toContain("preserved across");
    expect(body).toContain("pgdelta-migration");
    expect(body).toContain("NOT executed against your target database");
  });

  test("never overwrites an existing README (operator edits survive)", () => {
    const root = mkdtempSync(join(tmpdir(), "pgd-customdir-keep-"));
    mkdirSync(join(root, "_custom"), { recursive: true });
    writeFileSync(join(root, "_custom", "README.md"), "# mine\n", "utf8");
    expect(scaffoldCustomReadme(root)).toBe(false);
    expect(readFileSync(join(root, "_custom", "README.md"), "utf8")).toBe(
      "# mine\n",
    );
  });
});
