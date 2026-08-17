import { describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { publishSquashOutput } from "./publish.ts";
import type { SquashResult } from "../model/index.ts";

const failed = (): SquashResult => ({
  files: [
    { name: "0001_squashed.sql", sql: "CREATE TABLE leaked (id int);\n" },
  ],
  manifest: [],
  proof: {
    equal: false,
    originalRootHash: "a",
    candidateRootHash: "b",
    ledgerEqual: false,
    tables: [],
  },
  diagnostics: [{ code: "repair-split", message: "gave up" }],
});

const proven = (): SquashResult => ({
  files: [
    {
      name: "0001_squashed.sql",
      sql: "-- pg-squash: from a.sql\nCREATE TABLE t (id int);\n",
    },
  ],
  manifest: [],
  proof: {
    equal: true,
    originalRootHash: "h",
    candidateRootHash: "h",
    ledgerEqual: true,
    tables: [],
  },
  diagnostics: [],
});

describe("publishSquashOutput", () => {
  test("does not write SQL when the proof is not equal, and clears leftovers", async () => {
    const out = await mkdtemp(join(tmpdir(), "pgsquash-pub-"));
    await writeFile(
      join(out, "0003_squashed.sql"),
      "CREATE TABLE old (id int);\n",
    );
    await writeFile(join(out, "manifest.json"), "{}\n");
    const published = await publishSquashOutput(out, 2, failed());
    expect(published.proofEqual).toBe(false);
    expect(published.publishedSql).toBe(false);
    const names = (await readdir(out)).sort();
    expect(names).toEqual(["README.md", "diagnostics.json", "proof.json"]);
    const proof = JSON.parse(
      await readFile(join(out, "proof.json"), "utf8"),
    ) as {
      equal: boolean;
    };
    expect(proof.equal).toBe(false);
  });

  test("replaces leftover squashed SQL on a successful rerun", async () => {
    const out = await mkdtemp(join(tmpdir(), "pgsquash-pub-"));
    await mkdir(out, { recursive: true });
    await writeFile(
      join(out, "0003_squashed.sql"),
      "CREATE TABLE leftover (id int);\n",
    );
    await writeFile(
      join(out, "0001_squashed.sql"),
      "CREATE TABLE stale (id int);\n",
    );
    const published = await publishSquashOutput(out, 3, proven());
    expect(published.proofEqual).toBe(true);
    const names = (await readdir(out)).sort();
    expect(names).toEqual([
      "0001_squashed.sql",
      "README.md",
      "manifest.json",
      "proof.json",
    ]);
    const sql = await readFile(join(out, "0001_squashed.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE t");
    expect(sql).not.toContain("leftover");
  });
});
