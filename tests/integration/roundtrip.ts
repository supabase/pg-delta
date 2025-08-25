/**
 * Test configuration and utilities for pg-diff integration tests.
 */

import type postgres from "postgres";
import { expect } from "vitest";
import { diffCatalogs } from "../../src/catalog.diff.ts";
import { type Catalog, extractCatalog } from "../../src/catalog.model.ts";
import { resolveDependencies } from "../../src/dependency.ts";

export interface RoundtripTestOptions {
  masterSession: postgres.Sql;
  branchSession: postgres.Sql;
  initialSetup?: string;
  testSql?: string;
  description: string;
  expectedSqlTerms: string[];
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
  } = options;

  // Set up initial schema in BOTH databases
  if (initialSetup) {
    await masterSession.unsafe(initialSetup);
    await branchSession.unsafe(initialSetup);
  }

  // Execute the test SQL in the BRANCH database only
  if (testSql) {
    await branchSession.unsafe(testSql);
  }

  // Extract catalogs from both databases
  const masterCatalog = await extractCatalog(masterSession);
  const branchCatalog = await extractCatalog(branchSession);

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

  // Generate SQL from changes
  const sqlStatements = sortedChanges.map((change) => change.serialize());

  // Verify expected terms are the same as the generated SQL
  expect(sqlStatements).toStrictEqual(expectedSqlTerms);

  // Join SQL statements
  const diffScript =
    sqlStatements.join(";\n") + (sqlStatements.length > 0 ? ";" : "");

  // Apply migration to master database
  if (diffScript.trim()) {
    await masterSession.unsafe(diffScript);
  }

  // Extract final catalog from master database
  const masterCatalogAfter = await extractCatalog(masterSession);

  // Verify semantic equality between master and branch catalogs
  expect(catalogsSemanticalyEqual(branchCatalog, masterCatalogAfter)).toBe(
    true,
  );
}

/**
 * Simple semantic equality check between catalogs.
 * This is a simplified version - in a real implementation you would
 * need more sophisticated equality checking.
 */
function catalogsSemanticalyEqual(
  catalog1: Catalog,
  catalog2: Catalog,
): boolean {
  // For now, we'll do a basic check by comparing the serialized forms
  // of all objects in the catalog. In a real implementation, this would
  // be more sophisticated.

  const getObjectKeys = (cat: Catalog) => {
    const keys = new Set<string>();
    Object.keys(cat.schemas || {}).forEach((key) => keys.add(`schema:${key}`));
    Object.keys(cat.tables || {}).forEach((key) => keys.add(`table:${key}`));
    Object.keys(cat.types || {}).forEach((key) => keys.add(`type:${key}`));
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

  // Check if both catalogs have the same set of objects
  if (keys1.size !== keys2.size) {
    return false;
  }

  for (const key of keys1) {
    if (!keys2.has(key)) {
      return false;
    }
  }

  // Additional checks could be added here for object content equality
  return true;
}
