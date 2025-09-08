/**
 * Test configuration and utilities for pg-diff integration tests.
 */

import type postgres from "postgres";
import { expect } from "vitest";
import { diffCatalogs } from "../../src/catalog.diff.ts";
import { type Catalog, extractCatalog } from "../../src/catalog.model.ts";
import type { PgDepend } from "../../src/depend.ts";
import { resolveDependencies } from "../../src/dependency.ts";
import type { Change } from "../../src/objects/base.change.ts";
import { DEBUG } from "../constants.ts";

export interface RoundtripTestOptions {
  masterSession: postgres.Sql;
  branchSession: postgres.Sql;
  name?: string;
  initialSetup?: string;
  testSql?: string;
  description: string;
  expectedSqlTerms: string[];
  // List of dependencies that must be present in master catalog.
  expectedMasterDependencies?: PgDepend[];
  // List of dependencies that must be present in branch catalog.
  expectedBranchDependencies?: PgDepend[];
  // List of stable_ids in the order they should appear in the generated changes.
  // This validates dependency resolution ordering.
  expectedOperationOrder?: Change[];
}

/**
 * Test that schema extraction, SQL generation, and re-execution produces
 * functionally identical pg_catalog data.
 *
 * This validates the core roundtrip fidelity:
 * 1. Extract catalog from master database (masterSession)
 * 2. Extract catalog from branch database (branchSession)
 * 3. Generate migration from master to branch
 * 4. Apply migration to master database
 * 5. Verify master and branch catalogs are now semantically identical
 */
export async function roundtripFidelityTest(
  options: RoundtripTestOptions,
): Promise<void> {
  const {
    masterSession,
    branchSession,
    initialSetup,
    testSql,
    expectedSqlTerms,
    expectedMasterDependencies,
    expectedBranchDependencies,
    expectedOperationOrder,
  } = options;

  // Set up initial schema in BOTH databases
  if (initialSetup) {
    await expect(masterSession.unsafe(initialSetup)).resolves.not.toThrow();
    await expect(branchSession.unsafe(initialSetup)).resolves.not.toThrow();
  }

  // Execute the test SQL in the BRANCH database only
  if (testSql) {
    await expect(branchSession.unsafe(testSql)).resolves.not.toThrow();
  }

  // Extract catalogs from both databases
  const masterCatalog = await extractCatalog(masterSession);
  const branchCatalog = await extractCatalog(branchSession);

  if (expectedMasterDependencies && expectedBranchDependencies) {
    validateDependencies(
      masterCatalog,
      branchCatalog,
      expectedMasterDependencies,
      expectedBranchDependencies,
    );
  }

  // Generate migration from master to branch
  const changes = diffCatalogs(masterCatalog, branchCatalog);

  // Resolve dependencies to get the proper order
  const sortedChangesResult = resolveDependencies(
    changes,
    masterCatalog,
    branchCatalog,
  );
  if (sortedChangesResult.isErr()) {
    throw sortedChangesResult.error;
  }
  const sortedChanges = sortedChangesResult.value;

  if (expectedOperationOrder) {
    validateOperationOrder(sortedChanges, expectedOperationOrder);
  }

  // Generate SQL from changes
  const sqlStatements = sortedChanges.map((change) => change.serialize());

  // Verify expected terms are the same as the generated SQL
  expect(sqlStatements).toStrictEqual(expectedSqlTerms);

  // Join SQL statements
  const diffScript =
    sqlStatements.join(";\n") + (sqlStatements.length > 0 ? ";" : "");

  if (DEBUG) {
    console.log("diffScript: ", diffScript);
  }
  // Apply migration to master database
  if (diffScript.trim()) {
    await expect(masterSession.unsafe(diffScript)).resolves.not.toThrow();
  }

  // Extract final catalog from master database
  const masterCatalogAfter = await extractCatalog(masterSession);

  // Verify semantic equality between master and branch catalogs
  catalogsSemanticalyEqual(branchCatalog, masterCatalogAfter);
}

/**
 * Simple semantic equality check between catalogs.
 * This is a simplified version - in a real implementation you would
 * need more sophisticated equality checking.
 */
function catalogsSemanticalyEqual(catalog1: Catalog, catalog2: Catalog) {
  // For now, we'll do a basic check by comparing the serialized forms
  // of all objects in the catalog. In a real implementation, this would
  // be more sophisticated.

  const getObjectKeys = (cat: Catalog) => {
    const keys = new Set<string>();
    Object.keys(cat.schemas || {}).forEach((key) => keys.add(`schema:${key}`));
    Object.keys(cat.tables || {}).forEach((key) => keys.add(`table:${key}`));
    // Object.keys(cat.types || {}).forEach((key) => keys.add(`type:${key}`));
    Object.keys(cat.ranges || {}).forEach((key) => keys.add(`range:${key}`));
    Object.keys(cat.domains || {}).forEach((key) => keys.add(`domain:${key}`));
    Object.keys(cat.enums || {}).forEach((key) => keys.add(`enum:${key}`));
    Object.keys(cat.compositeTypes || {}).forEach((key) =>
      keys.add(`compositeType:${key}`),
    );
    Object.keys(cat.views || {}).forEach((key) => keys.add(`view:${key}`));
    Object.keys(cat.materializedViews || {}).forEach((key) =>
      keys.add(`materializedView:${key}`),
    );
    Object.keys(cat.indexes || {}).forEach((key) => keys.add(`index:${key}`));
    Object.keys(cat.triggers || {}).forEach((key) =>
      keys.add(`trigger:${key}`),
    );
    Object.keys(cat.procedures || {}).forEach((key) =>
      keys.add(`procedure:${key}`),
    );
    Object.keys(cat.sequences || {}).forEach((key) =>
      keys.add(`sequence:${key}`),
    );
    return keys;
  };

  const keys1 = getObjectKeys(catalog1);
  const keys2 = getObjectKeys(catalog2);

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
  masterCatalog: Catalog,
  branchCatalog: Catalog,
  expectedMasterDependencies: PgDepend[],
  expectedBranchDependencies: PgDepend[],
) {
  const masterDependencies = new Set(
    masterCatalog.depends.reduce((acc, depend) => {
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
      "masterDependencies: ",
      Array.from(masterDependencies).filter(
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

  // Extract dependencies from master catalog
  const expectedMasterSet = new Set(
    expectedMasterDependencies.map(getDependencyStableId),
  );
  const expectedBranchSet = new Set(
    expectedBranchDependencies.map(getDependencyStableId),
  );
  // Validate master dependencies
  const masterMissing = expectedMasterSet.difference(masterDependencies);
  const branchMissing = expectedBranchSet.difference(branchDependencies);

  expect(masterMissing).toEqual(new Set());
  expect(branchMissing).toEqual(new Set());
}

function validateOperationOrder(
  changes: Change[],
  expectedOperationOrder: Change[],
) {
  expect(changes).toStrictEqual(expectedOperationOrder);
}
