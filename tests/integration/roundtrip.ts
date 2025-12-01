/**
 * Test configuration and utilities for pg-diff integration tests.
 */

import type postgres from "postgres";
import { expect } from "vitest";
import { diffCatalogs } from "../../src/catalog.diff.ts";
import { type Catalog, extractCatalog } from "../../src/catalog.model.ts";
import type { Change } from "../../src/change.types.ts";
import type { PgDepend } from "../../src/depend.ts";
import { base } from "../../src/integrations/base.ts";
import type { Integration } from "../../src/integrations/integration.types.ts";
import { sortChanges } from "../../src/sort/sort-changes.ts";
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
  // When defined, random sorting of changes is skipped to ensure deterministic order.
  expectedSqlTerms?: string[] | "same-as-test-sql";
  // List of dependencies that must be present in main catalog.
  expectedMainDependencies?: PgDepend[];
  // List of dependencies that must be present in branch catalog.
  expectedBranchDependencies?: PgDepend[];
  // List of stable_ids in the order they should appear in the generated changes.
  // This validates dependency resolution ordering.
  expectedOperationOrder?: Change[];
  // Integration to use for filtering and serialization
  integration?: Integration;
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
    integration,
  } = options;
  // Silent warnings from PostgreSQL such as subscriptions created without a slot.
  const sessionConfig = ["SET LOCAL client_min_messages = error"];
  // Set up initial schema in BOTH databases
  if (initialSetup) {
    await expect(
      mainSession.unsafe([...sessionConfig, initialSetup].join(";\n\n")),
    ).resolves.not.toThrow();
    await expect(
      branchSession.unsafe([...sessionConfig, initialSetup].join(";\n\n")),
    ).resolves.not.toThrow();
  }

  // Execute the test SQL in the BRANCH database only
  if (testSql) {
    await expect(
      branchSession.unsafe([...sessionConfig, testSql].join(";\n\n")),
    ).resolves.not.toThrow();
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

  if (process.env.DEPENDENCIES_DEBUG) {
    console.log("mainCatalog.depends: ");
    console.log(mainCatalog.depends);
    console.log("branchCatalog.depends: ");
    console.log(branchCatalog.depends);
  }

  // Randomize changes order (skip if expectedSqlTerms is defined for deterministic testing)
  if (!expectedSqlTerms) {
    changes = changes.sort(() => Math.random() - 0.5);
  }

  // Optional pre-sort to provide deterministic tie-breaking for the phased sort
  if (sortChangesCallback) {
    changes = changes.sort(sortChangesCallback);
    if (DEBUG) {
      // just print class names
      console.log(
        "sorted changes: ",
        changes.map((change) => change.constructor.name),
      );
    }
  }

  // Use integration for filtering and serialization
  const testIntegration = integration ?? base;
  const ctx = { mainCatalog, branchCatalog };

  // Apply filter if provided (filters out env-dependent changes)
  let filteredChanges = changes;
  const integrationFilter = testIntegration.filter;
  if (integrationFilter) {
    filteredChanges = filteredChanges.filter((change) =>
      integrationFilter(ctx, change),
    );
  }

  const sortedChanges = sortChanges(
    { mainCatalog, branchCatalog },
    filteredChanges,
  );

  if (process.env.DEPENDENCIES_DEBUG) {
    console.log("\n==== Sorted Changes ====");
    for (let i = 0; i < sortedChanges.length; i++) {
      const change = sortedChanges[i];
      console.log(
        `[${i}] ${change.constructor.name}`,
        `creates: ${JSON.stringify(change.creates)}`,
        `requires: ${JSON.stringify(change.requires ?? [])}`,
      );
    }
    console.log("==== End Sorted Changes ====\n");
  }

  if (expectedOperationOrder) {
    validateOperationOrder(sortedChanges, expectedOperationOrder);
  }

  const hasRoutineChanges = sortedChanges.some(
    (change) =>
      change.objectType === "procedure" || change.objectType === "aggregate",
  );
  const migrationSessionConfig = hasRoutineChanges
    ? ["SET check_function_bodies = false"]
    : [];

  const sqlStatements = sortedChanges.map((change) => {
    return testIntegration.serialize?.(ctx, change) ?? change.serialize();
  });
  const migrationScript = `${[...migrationSessionConfig, ...sqlStatements].join(
    ";\n\n",
  )};`;

  // Verify expected terms are the same as the generated SQL
  if (expectedSqlTerms) {
    if (expectedSqlTerms === "same-as-test-sql") {
      expect(migrationScript).toStrictEqual(testSql);
    } else {
      expect(sqlStatements).toStrictEqual(expectedSqlTerms);
    }
  }

  if (DEBUG) {
    console.log("migrationScript: ", migrationScript);
  }

  // Apply migration to main database
  if (migrationScript.trim()) {
    await runOrDump(
      () =>
        mainSession.unsafe([...sessionConfig, migrationScript].join(";\n\n")),
      {
        label: "migration",
        diffScript: migrationScript,
      },
    );
  }

  // Extract final catalog from main database
  if (DEBUG) {
    console.log("mainCatalogAfter: ");
  }
  const mainCatalogAfter = await extractCatalog(mainSession);

  // Verify semantic equality by diffing the catalogs again
  // This ensures the migration produced a database state identical to the target

  const changesAfter = diffCatalogs(mainCatalogAfter, branchCatalog);

  // Re-apply the filter to check for remaining changes (only changes that weren't filtered out)
  let filteredChangesAfter = changesAfter;
  if (integrationFilter) {
    const ctxAfter = { mainCatalog: mainCatalogAfter, branchCatalog };
    filteredChangesAfter = filteredChangesAfter.filter((change) =>
      integrationFilter(ctxAfter, change),
    );
  }

  if (filteredChangesAfter.length > 0) {
    // Sort the remaining changes for better debugging
    const sortedChangesAfter = sortChanges(
      { mainCatalog: mainCatalogAfter, branchCatalog },
      filteredChangesAfter,
    );

    const remainingSqlStatements = sortedChangesAfter.map((change) =>
      change.serialize(),
    );
    const remainingMigrationScript = remainingSqlStatements.join(";\n\n");

    // Build detailed error message
    const changeDetails = sortedChangesAfter.map((change, idx) => {
      const parts = [
        `${idx + 1}. ${change.constructor.name}`,
        `   Operation: ${change.operation}`,
        `   Object Type: ${change.objectType}`,
        `   Scope: ${change.scope || "object"}`,
      ];

      if (change.creates.length > 0) {
        parts.push(`   Creates: ${change.creates.join(", ")}`);
      }
      if (change.drops.length > 0) {
        parts.push(`   Drops: ${change.drops.join(", ")}`);
      }
      if (change.requires.length > 0) {
        parts.push(`   Requires: ${change.requires.join(", ")}`);
      }

      return parts.join("\n");
    });

    const errorMessage = [
      `Migration verification failed: Found ${changesAfter.length} remaining changes after migration`,
      "",
      "=== Remaining Changes ===",
      ...changeDetails,
      "",
      "=== SQL for Remaining Changes ===",
      remainingMigrationScript || "(no SQL generated)",
      "",
      "=== Original Migration Script ===",
      migrationScript || "(no migration script)",
    ].join("\n");

    throw new Error(errorMessage);
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
