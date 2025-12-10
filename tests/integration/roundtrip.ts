/**
 * Test configuration and utilities for pg-delta integration tests.
 */

import debug from "debug";
import type postgres from "postgres";
import { expect } from "vitest";
import { diffCatalogs } from "../../src/core/catalog.diff.ts";
import { type Catalog, extractCatalog } from "../../src/core/catalog.model.ts";
import type { Change } from "../../src/core/change.types.ts";
import type { PgDepend } from "../../src/core/depend.ts";
import {
  buildPlanScopeFingerprint,
  hashStableIds,
} from "../../src/core/fingerprint.ts";
import type { Integration } from "../../src/core/integrations/integration.types.ts";
import { applyPlan } from "../../src/core/plan/apply.ts";
import { createPlan } from "../../src/core/plan/create.ts";
import { sortChanges } from "../../src/core/sort/sort-changes.ts";

const debugTest = debug("pg-delta:test");
const debugDependencies = debug("pg-delta:dependencies");

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
  debugTest("mainCatalog: ");
  const mainCatalog = await extractCatalog(mainSession);
  debugTest("branchCatalog: ");
  const branchCatalog = await extractCatalog(branchSession);

  if (expectedMainDependencies && expectedBranchDependencies) {
    validateDependencies(
      mainCatalog,
      branchCatalog,
      expectedMainDependencies,
      expectedBranchDependencies,
    );
  }

  // Generate plan using core workflow
  const planResult = await createPlan(mainSession, branchSession, {
    integration,
  });
  if (!planResult) {
    return;
  }

  let { plan, sortedChanges } = planResult;
  const integrationFilter = integration?.filter;

  // Optional pre-sort for deterministic tie-breaking in tests
  if (sortChangesCallback) {
    sortedChanges = [...sortedChanges].sort(sortChangesCallback);
  }

  debugDependencies("\n==== Sorted Changes ====");
  for (let i = 0; i < sortedChanges.length; i++) {
    const change = sortedChanges[i];
    debugDependencies(
      "[%d] %s creates: %O requires: %O",
      i,
      change.constructor.name,
      change.creates,
      change.requires ?? [],
    );
  }
  debugDependencies("==== End Sorted Changes ====\n");

  if (expectedOperationOrder) {
    validateOperationOrder(sortedChanges, expectedOperationOrder);
  }

  const hasRoutineChanges = sortedChanges.some(
    (change) =>
      change.objectType === "procedure" || change.objectType === "aggregate",
  );
  const { hash: targetFingerprint, stableIds } = buildPlanScopeFingerprint(
    branchCatalog,
    sortedChanges,
  );
  const migrationSessionConfig = hasRoutineChanges
    ? ["SET check_function_bodies = false"]
    : [];

  const sqlStatements = plan.statements;
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

  debugTest("migrationScript: %s", migrationScript);

  // Apply migration using core apply
  const applyResult = await applyPlan(plan, mainSession, branchSession, {
    verifyPostApply: true,
  });
  if (applyResult.status !== "applied") {
    throw new Error(
      `Apply failed: ${applyResult.status} ${
        "message" in applyResult ? applyResult.message : ""
      }`,
    );
  }

  if (applyResult.warnings?.length) {
    const debugMainCatalogAfter = await extractCatalog(mainSession);
    const postApplyFingerprint = hashStableIds(
      debugMainCatalogAfter,
      stableIds,
    );
    console.error(
      "[roundtrip] apply warnings: %o\n[targetFingerprint=%s postApplyFingerprint=%s]",
      applyResult.warnings,
      targetFingerprint,
      postApplyFingerprint,
    );
    debugEnums("main-after", debugMainCatalogAfter);
    debugEnums("branch", branchCatalog);
  }

  // Extra fingerprint assertion to make enum drift visible in CI output
  if (applyResult.warnings?.length) {
    const debugMainCatalogAfter = await extractCatalog(mainSession);
    const postApplyFingerprint = hashStableIds(
      debugMainCatalogAfter,
      stableIds,
    );
    expect(postApplyFingerprint).toStrictEqual(targetFingerprint);
  } else {
    const debugMainCatalogAfter = await extractCatalog(mainSession);
    const postApplyFingerprint = hashStableIds(
      debugMainCatalogAfter,
      stableIds,
    );
    expect(postApplyFingerprint).toStrictEqual(targetFingerprint);
  }

  expect(applyResult.warnings ?? []).toEqual([]);

  await verifyNoRemainingChanges(
    mainSession,
    branchCatalog,
    integrationFilter,
    migrationScript,
  );
}

function debugEnums(label: string, catalog: Catalog) {
  const entries = Object.values(catalog.enums)
    .map((enumObj) => ({
      stableId: enumObj.stableId,
      snapshot: enumObj.stableSnapshot(),
    }))
    .sort((a, b) => a.stableId.localeCompare(b.stableId));

  console.error(
    "[roundtrip] %s enums (count=%d): %s",
    label,
    entries.length,
    JSON.stringify(entries, null, 2),
  );
}

async function verifyNoRemainingChanges(
  mainSession: postgres.Sql,
  branchCatalog: Catalog,
  integrationFilter: Integration["filter"] | undefined,
  migrationScript: string,
): Promise<void> {
  debugTest("mainCatalogAfter: ");
  const mainCatalogAfter = await extractCatalog(mainSession);

  // Verify semantic equality by diffing the catalogs again
  // This ensures the migration produced a database state identical to the target
  const changesAfter = diffCatalogs(mainCatalogAfter, branchCatalog);

  const filteredChangesAfter = integrationFilter
    ? changesAfter.filter((change) =>
        integrationFilter(
          { mainCatalog: mainCatalogAfter, branchCatalog },
          change,
        ),
      )
    : changesAfter;

  if (filteredChangesAfter.length === 0) {
    return;
  }

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

  const filteredMainDeps = Array.from(mainDependencies).filter(
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
  );
  const filteredBranchDeps = Array.from(branchDependencies).filter(
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
  );
  debugTest("mainDependencies: %O", filteredMainDeps);
  debugTest("branchDependencies: %O", filteredBranchDeps);

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
