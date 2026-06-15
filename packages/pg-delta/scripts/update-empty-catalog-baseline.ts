/**
 * Update the empty-catalogs baseline by exporting the catalog from a fresh
 * Postgres testcontainer.
 *
 * The baseline JSON is used as the "empty database" reference for declarative
 * export and plan commands when comparing against a live DB. This script
 * ensures the baseline matches the exact catalog of a vanilla Postgres
 * (Alpine) instance so diffs are stable and reproducible.
 *
 * The PG 14 baseline is a separate fixture because PG 15 changed the default
 * `public` schema ACL/owner; PG 15 and 16 share one fixture, and PG 17 patches
 * it in-memory (see `getPg17Baseline` in catalog.model.ts).
 *
 * Usage (from package root):
 *   bun run update-empty-baseline                          # PG 15 (default)
 *   PGDELTA_BASELINE_PG_VERSION=14 bun run update-empty-baseline
 *
 * Requirements: Docker running (testcontainers starts the matching
 * postgres:<minor>-alpine container). The script writes to
 * src/core/fixtures/empty-catalogs/ and then exits; container stop is capped so
 * the process does not hang.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractCatalog } from "../src/core/catalog.model.ts";
import {
  serializeCatalog,
  stringifyCatalogSnapshot,
} from "../src/core/catalog.snapshot.ts";
import { createPool, endPool } from "../src/core/postgres-config.ts";
import { POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG } from "../tests/constants.ts";
import { PostgresAlpineContainer } from "../tests/postgres-alpine.ts";

/** Postgres major version used for the baseline (must match fixture naming). */
const PG_VERSION = (
  process.env.PGDELTA_BASELINE_PG_VERSION
    ? Number(process.env.PGDELTA_BASELINE_PG_VERSION)
    : 15
) as keyof typeof POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG;

/** Output path relative to package root; shared by declarative/plan code. */
const OUTPUT_RELATIVE =
  PG_VERSION === 14
    ? "src/core/fixtures/empty-catalogs/postgres-14-baseline.json"
    : "src/core/fixtures/empty-catalogs/postgres-15-16-baseline.json";

const pkgRoot = join(import.meta.dir, "..");
const outputPath = join(pkgRoot, OUTPUT_RELATIVE);

/** Same image as integration tests for consistency. */
const image = `postgres:${POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG[PG_VERSION]}`;

console.log(`Starting Postgres ${PG_VERSION} container (${image})...`);
const container = await new PostgresAlpineContainer(image).start();

try {
  const uri = container.getConnectionUri();
  const pool = createPool(uri, {
    onError: (err: Error & { code?: string }) => {
      if (err.code !== "57P01") console.error("Pool error:", err);
    },
  });

  try {
    console.log("Exporting catalog...");
    const catalog = await extractCatalog(pool);
    const snapshot = serializeCatalog(catalog);
    const json = stringifyCatalogSnapshot(snapshot);
    await writeFile(outputPath, json, "utf-8");
    console.log(`Done. Baseline written to ${OUTPUT_RELATIVE}`);
  } finally {
    await endPool(pool);
  }
} finally {
  // Don't block on stop(); Docker's graceful shutdown can hang. Give it a short
  // timeout then exit so the process doesn't hang.
  const stopTimeoutMs = 5_000;
  await Promise.race([
    container.stop(),
    new Promise((r) => setTimeout(r, stopTimeoutMs)),
  ]);
  process.exit(0);
}
