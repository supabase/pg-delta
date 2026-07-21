/** Corpus loader (stage 0): one directory per scenario, a.sql + b.sql. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface ScenarioMeta {
  /** Cluster-level state differs (roles/memberships/default privileges):
   *  each side gets its own freshly started cluster. */
  isolatedCluster?: boolean;
  /** Minimum PostgreSQL major version this scenario's DDL needs. */
  minVersion?: number;
}

export interface Scenario {
  name: string;
  a: string;
  b: string;
  seed?: string;
  seedB?: string;
  meta: ScenarioMeta;
}

const CORPUS_DIR = new URL("../corpus", import.meta.url).pathname;

/** Narrow the corpus while iterating:
 *  - PGDELTA_NEXT_ONLY: comma-separated scenario-name substrings
 *  - PGDELTA_NEXT_SHARD: "i/n" (0-based) — deterministic slice for parallel runs
 *  Both are dev/CI conveniences; an unset env runs everything. */
function selectScenarios(names: string[]): string[] {
  const only = process.env["PGDELTA_NEXT_ONLY"];
  let selected = names;
  if (only) {
    const patterns = only
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    selected = selected.filter((n) => patterns.some((p) => n.includes(p)));
  }
  const shard = process.env["PGDELTA_NEXT_SHARD"];
  if (shard) {
    const match = /^(\d+)\/(\d+)$/.exec(shard);
    if (!match)
      throw new Error(`PGDELTA_NEXT_SHARD must be "i/n", got "${shard}"`);
    const [index, total] = [Number(match[1]), Number(match[2])];
    if (index >= total)
      throw new Error(`shard index ${index} out of range for total ${total}`);
    selected = selected.filter((_, i) => i % total === index);
  }
  return selected;
}

export function loadCorpus(): Scenario[] {
  const names = readdirSync(CORPUS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return selectScenarios(names).map((name) => {
    const dir = join(CORPUS_DIR, name);
    const seedPath = join(dir, "seed.sql");
    const seedBPath = join(dir, "seed-b.sql");
    const metaPath = join(dir, "meta.json");
    return {
      name,
      a: readFileSync(join(dir, "a.sql"), "utf8"),
      b: readFileSync(join(dir, "b.sql"), "utf8"),
      ...(existsSync(seedPath) ? { seed: readFileSync(seedPath, "utf8") } : {}),
      ...(existsSync(seedBPath)
        ? { seedB: readFileSync(seedBPath, "utf8") }
        : {}),
      meta: existsSync(metaPath)
        ? (JSON.parse(readFileSync(metaPath, "utf8")) as ScenarioMeta)
        : {},
    };
  });
}
