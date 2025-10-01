/**
 * Test configuration and utilities for pg-diff integration tests.
 */

import type postgres from "postgres";
import { expect } from "vitest";
import { diffCatalogs } from "../../src/catalog.diff.ts";
import { type Catalog, extractCatalog } from "../../src/catalog.model.ts";
import type { PgDepend } from "../../src/depend.ts";
import type { Change } from "../../src/objects/base.change.ts";
import { pgDumpSort } from "../../src/sort/global-sort.ts";
import { applyRefinements } from "../../src/sort/refined-sort.ts";
import { sortChangesByRules } from "../../src/sort/sort-utils.ts";
import { DEBUG } from "../constants.ts";

interface RoundtripTestOptions {
  mainSession: postgres.Sql;
  branchSession: postgres.Sql;
  name?: string;
  initialSetup?: string;
  testSql?: string;
  description?: string;
  // Forcing the changes order to be deterministic.
  sortChangesCallback?: (a: Change, b: Change) => number;
  // List of terms that must appear in the generated SQL.
  // If not provided, we expect the generated SQL to match the testSql.
  expectedSqlTerms?: string[] | "same-as-test-sql";
  // List of dependencies that must be present in main catalog.
  expectedMainDependencies?: PgDepend[];
  // List of dependencies that must be present in branch catalog.
  expectedBranchDependencies?: PgDepend[];
  // List of stable_ids in the order they should appear in the generated changes.
  // This validates dependency resolution ordering.
  expectedOperationOrder?: Change[];
}

async function runOrDump(
  action: () => Promise<unknown>,
  opts: { label?: string; diffScript?: string },
) {
  try {
    await action();
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const lbl = opts.label ?? "Context";
    const dump = opts.diffScript
      ? `\n\n==== ${lbl} diffScript (failed to apply) ====\n${opts.diffScript}\n==== end ====\n`
      : "";
    err.message += dump;
    throw err;
  }
}

/**
 * Test that schema extraction, SQL generation, and re-execution produces
 * functionally identical pg_catalog data.
 *
 * This validates the core roundtrip fidelity:
 * 1. Extract catalog from main database (mainSession)
 * 2. Extract catalog from branch database (branchSession)
 * 3. Generate migration from main to branch
 * 4. Apply migration to main database
 * 5. Verify main and branch catalogs are now semantically identical
 */
export async function roundtripFidelityTest(
  options: RoundtripTestOptions,
): Promise<void> {
  const {
    mainSession,
    branchSession,
    initialSetup,
    testSql,
    expectedSqlTerms,
    expectedMainDependencies,
    expectedBranchDependencies,
    expectedOperationOrder,
    sortChangesCallback,
  } = options;

  // Set up initial schema in BOTH databases
  if (initialSetup) {
    await expect(mainSession.unsafe(initialSetup)).resolves.not.toThrow();
    await expect(branchSession.unsafe(initialSetup)).resolves.not.toThrow();
  }

  // Execute the test SQL in the BRANCH database only
  if (testSql) {
    await expect(branchSession.unsafe(testSql)).resolves.not.toThrow();
  }

  // Extract catalogs from both databases
  if (DEBUG) {
    console.log("mainCatalog: ");
  }
  const mainCatalog = await extractCatalog(mainSession);
  if (DEBUG) {
    console.log("branchCatalog: ");
  }
  const branchCatalog = await extractCatalog(branchSession);

  if (expectedMainDependencies && expectedBranchDependencies) {
    validateDependencies(
      mainCatalog,
      branchCatalog,
      expectedMainDependencies,
      expectedBranchDependencies,
    );
  }

  // Generate migration from main to branch
  let changes = diffCatalogs(mainCatalog, branchCatalog);

  if (sortChangesCallback) {
    changes = changes.sort(sortChangesCallback);
  }

  const globallySortedChanges = sortChangesByRules(changes, pgDumpSort);
  const sortedChanges = applyRefinements(
    {
      mainCatalog,
      branchCatalog,
    },
    globallySortedChanges,
  );

  if (expectedOperationOrder) {
    validateOperationOrder(sortedChanges, expectedOperationOrder);
  }

  // Generate SQL from changes
  const sqlStatements = sortedChanges.map((change) => change.serialize());

  // Join SQL statements
  const diffScript =
    sqlStatements.join(";\n\n") + (sqlStatements.length > 0 ? ";" : "");

  // Verify expected terms are the same as the generated SQL
  if (expectedSqlTerms) {
    if (expectedSqlTerms === "same-as-test-sql") {
      expect(diffScript).toStrictEqual(testSql);
    } else {
      expect(sqlStatements).toStrictEqual(expectedSqlTerms);
    }
  }

  if (DEBUG) {
    console.log("diffScript: ", diffScript);
  }
  // Apply migration to main database
  if (diffScript.trim()) {
    await runOrDump(() => mainSession.unsafe(diffScript), {
      label: "migration",
      diffScript,
    });
  }

  // Extract final catalog from main database
  if (DEBUG) {
    console.log("mainCatalogAfter: ");
  }
  const mainCatalogAfter = await extractCatalog(mainSession);

  // Verify semantic equality between main and branch catalogs
  catalogsSemanticalyEqual(branchCatalog, mainCatalogAfter);
}

/**
 * Simple semantic equality check between catalogs.
 * This is a simplified version - in a real implementation you would
 * need more sophisticated equality checking.
 */
export function catalogsSemanticalyEqual(catalog1: Catalog, catalog2: Catalog) {
  // For now, we'll do a basic check by comparing the serialized forms
  // of all objects in the catalog. In a real implementation, this would
  // be more sophisticated.

  const getObjectKeys = (cat: Catalog) => {
    const keys = new Set<string>();
    for (const key of Object.keys(cat)) {
      // Skip depends introspection results
      if (key === "depends") {
        continue;
      }

      for (const subKey of Object.keys(cat[key as keyof Catalog] || {})) {
        keys.add(`${key}:${subKey}`);
      }
    }
    return keys;
  };

  const keys1 = getObjectKeys(catalog1);
  const keys2 = getObjectKeys(catalog2);

  if (process.env.DEBUG) {
    console.log(keys1.difference(keys2));
  }

  // Check if both catalogs have the same set of keys
  expect(keys2).toEqual(keys1);

  // Check if both catalogs have the same set of objects
  for (const key of keys1) {
    expect(catalog2[key as keyof Catalog]).toEqual(
      catalog1[key as keyof Catalog],
    );
  }
}

function getDependencyStableId(depend: PgDepend): string {
  return `${depend.dependent_stable_id} -> ${depend.referenced_stable_id} :: ${depend.deptype}`;
}

function validateDependencies(
  mainCatalog: Catalog,
  branchCatalog: Catalog,
  expectedMainDependencies: PgDepend[],
  expectedBranchDependencies: PgDepend[],
) {
  const mainDependencies = new Set(
    mainCatalog.depends.reduce((acc, depend) => {
      if (
        !depend.dependent_stable_id.startsWith("unknown") &&
        !depend.referenced_stable_id.startsWith("unknown")
      ) {
        acc.add(getDependencyStableId(depend));
      }
      return acc;
    }, new Set<string>()),
  );
  const branchDependencies = new Set(
    branchCatalog.depends.reduce((acc, depend) => {
      if (
        !depend.dependent_stable_id.startsWith("unknown") &&
        !depend.referenced_stable_id.startsWith("unknown")
      ) {
        acc.add(getDependencyStableId(depend));
      }
      return acc;
    }, new Set<string>()),
  );

  if (DEBUG) {
    console.log(
      "mainDependencies: ",
      Array.from(mainDependencies).filter(
        (dep) =>
          !dep.includes("pg_") &&
          !dep.includes("information_schema") &&
          !dep.includes("pg_toast") &&
          !dep.includes("storage") &&
          !dep.includes("auth") &&
          !dep.includes("secrets") &&
          !dep.includes("vault") &&
          !dep.includes("extensions") &&
          !dep.includes("realtime") &&
          !dep.includes("graphql") &&
          !dep.includes("defaultAcl"),
      ),
    );
    console.log(
      "branchDependencies: ",
      Array.from(branchDependencies).filter(
        (dep) =>
          !dep.includes("pg_") &&
          !dep.includes("information_schema") &&
          !dep.includes("pg_toast") &&
          !dep.includes("storage") &&
          !dep.includes("auth") &&
          !dep.includes("secrets") &&
          !dep.includes("vault") &&
          !dep.includes("extensions") &&
          !dep.includes("realtime") &&
          !dep.includes("graphql") &&
          !dep.includes("defaultAcl"),
      ),
    );
  }

  // Extract dependencies from main catalog
  const expectedMainSet = new Set(
    expectedMainDependencies.map(getDependencyStableId),
  );
  const expectedBranchSet = new Set(
    expectedBranchDependencies.map(getDependencyStableId),
  );
  // Validate main dependencies
  const mainMissing = expectedMainSet.difference(mainDependencies);
  const branchMissing = expectedBranchSet.difference(branchDependencies);

  expect(mainMissing).toEqual(new Set());
  expect(branchMissing).toEqual(new Set());
}

function validateOperationOrder(
  changes: Change[],
  expectedOperationOrder: Change[],
) {
  expect(changes).toStrictEqual(expectedOperationOrder);
}
