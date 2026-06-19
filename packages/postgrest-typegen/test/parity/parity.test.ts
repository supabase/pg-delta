import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { Wait } from "testcontainers";

import {
  generateGo,
  generatePython,
  generateSwift,
  generateTypescript,
} from "../../src/generation/index.ts";
import { introspect } from "../../src/introspection/index.ts";
import type { GeneratorMetadata } from "../../src/types.ts";

/**
 * End-to-end parity gate: introspect the shared postgres-meta fixture DB, run
 * all four generators with their default options, and assert the output matches
 * the committed golden files in `expected/`.
 *
 * The golden files were captured verbatim from the current postgres-meta CLI
 * (`PG_META_DB_URL=... npm run gen:types:{typescript,go,python,swift}`) run
 * against the same fixtures on `postgres:15-alpine`, and verified byte-identical
 * to this package's output. postgres-meta's CLI prints with `console.log`, which
 * appends exactly one trailing newline to the generator's return value — hence
 * the `+ "\n"` below. See the PGMETA-111 commit/PR for the capture procedure.
 *
 * If a generator change is intended, re-capture the golden files from
 * postgres-meta (or regenerate from this package) and review the diff.
 */
const FIXTURE_DIR = join(import.meta.dir, "..", "introspection", "fixtures");
const EXPECTED_DIR = join(import.meta.dir, "expected");
const golden = (name: string) => readFileSync(join(EXPECTED_DIR, name), "utf8");

let container: StartedPostgreSqlContainer;
let pool: Pool;
let metadata: GeneratorMetadata;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:15-alpine")
    .withUsername("postgres")
    .withPassword("postgres")
    .withDatabase("postgres")
    .withWaitStrategy(Wait.forHealthCheck())
    .withStartupTimeout(120_000)
    .start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await pool.query(readFileSync(join(FIXTURE_DIR, "00-init.sql"), "utf8"));
  await pool.query(readFileSync(join(FIXTURE_DIR, "01-memes.sql"), "utf8"));
  metadata = await introspect(pool);
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe("generator parity vs postgres-meta CLI", () => {
  test("typescript", async () => {
    expect((await generateTypescript(metadata)) + "\n").toBe(
      golden("typescript.txt"),
    );
  });

  test("go", () => {
    expect(generateGo(metadata) + "\n").toBe(golden("go.txt"));
  });

  test("python", () => {
    expect(generatePython(metadata) + "\n").toBe(golden("python.txt"));
  });

  test("swift", () => {
    expect(generateSwift(metadata) + "\n").toBe(golden("swift.txt"));
  });
});
