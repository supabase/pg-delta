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
  sortGeneratorMetadata,
} from "../../src/generation/index.ts";
import { introspect } from "../../src/introspection/index.ts";
import type { GeneratorMetadata } from "../../src/types.ts";

/**
 * End-to-end parity gate: introspect the shared postgres-meta fixture DB, run
 * all four generators with their default options, and assert the output matches
 * the committed golden files in `expected/`.
 *
 * The metadata is passed through `sortGeneratorMetadata` first (as every
 * consumer must), so the golden files reflect the canonical, deterministic
 * ordering rather than the database's heap order. Content is byte-identical to
 * postgres-meta's CLI output; only the ordering of order-sensitive collections
 * (Go/Python/Swift emit tables/views in metadata order) is canonicalized — and
 * postgres-meta applies the same sort pass, so the two stay in lockstep.
 * postgres-meta's CLI prints with `console.log`, which appends exactly one
 * trailing newline to the generator's return value — hence the `+ "\n"` below.
 *
 * If a generator change is intended, regenerate the golden files from this
 * package and review the diff.
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
  metadata = sortGeneratorMetadata(await introspect(pool));
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
