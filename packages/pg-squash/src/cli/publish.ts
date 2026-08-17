import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { SquashResult } from "../model/index.ts";

const SQUASHED_SQL = /^[0-9]+_squashed\.sql$/;
const META_FILES = new Set([
  "manifest.json",
  "proof.json",
  "README.md",
  "diagnostics.json",
]);

const isProofEqual = (proof: unknown): boolean =>
  typeof proof === "object" &&
  proof !== null &&
  "equal" in proof &&
  proof.equal === true;

const unlinkIfExists = async (path: string): Promise<void> => {
  await unlink(path).catch(() => {});
};

/** Remove previously published apply SQL and squash metadata from `--out`. */
const clearPublishedOutput = async (out: string): Promise<void> => {
  const names = await readdir(out).catch(() => [] as string[]);
  for (const name of names) {
    if (SQUASHED_SQL.test(name) || META_FILES.has(name)) {
      await unlinkIfExists(join(out, name));
    }
  }
};

const moveInto = async (fromDir: string, toDir: string): Promise<void> => {
  const names = await readdir(fromDir);
  for (const name of names) {
    const from = join(fromDir, name);
    const to = join(toDir, name);
    try {
      await rename(from, to);
    } catch {
      await writeFile(to, await readFile(from));
      await unlinkIfExists(from);
    }
  }
};

type PublishResult = {
  proofEqual: boolean;
  publishedSql: boolean;
};

/**
 * Publish a squash result to `--out`.
 *
 * Proven chains replace the directory's `*_squashed.sql` plus metadata.
 * Failed proofs write `proof.json` / `diagnostics.json` / `README.md` only
 * and delete leftover apply SQL so a per-file runner cannot pick them up.
 */
export const publishSquashOutput = async (
  out: string,
  chainLength: number,
  result: SquashResult,
): Promise<PublishResult> => {
  const proofEqual = isProofEqual(result.proof);
  await mkdir(out, { recursive: true });

  if (!proofEqual) {
    await clearPublishedOutput(out);
    await writeFile(
      join(out, "proof.json"),
      `${JSON.stringify(result.proof, null, 2)}\n`,
    );
    await writeFile(
      join(out, "diagnostics.json"),
      `${JSON.stringify(result.diagnostics, null, 2)}\n`,
    );
    await writeFile(
      join(out, "README.md"),
      `# Squashed migrations\n\nProof equal: false. SQL was not published.\nSee proof.json and diagnostics.json.\n`,
    );
    return { proofEqual: false, publishedSql: false };
  }

  const tmp = await mkdtemp(join(tmpdir(), "pgsquash-out-"));
  try {
    for (const file of result.files) {
      await writeFile(join(tmp, file.name), file.sql);
    }
    await writeFile(
      join(tmp, "manifest.json"),
      `${JSON.stringify(result.manifest, null, 2)}\n`,
    );
    await writeFile(
      join(tmp, "proof.json"),
      `${JSON.stringify(result.proof, null, 2)}\n`,
    );
    await writeFile(
      join(tmp, "README.md"),
      `# Squashed migrations\n\n${String(chainLength)} input files → ${String(result.files.length)} output files.\nProof equal: true\n`,
    );
    await clearPublishedOutput(out);
    await moveInto(tmp, out);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  return { proofEqual: true, publishedSql: true };
};
