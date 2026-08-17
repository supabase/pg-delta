import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const MIGRATION_FILE = /^[0-9]+_.*\.sql$/;

/** Filesystem adapter. Core ingest never calls this. */
export const readChain = async (
  dir: string,
): Promise<{ name: string; sql: string }[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const names = entries
    .filter((e) => e.isFile() && MIGRATION_FILE.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return Promise.all(
    names.map(async (name) => ({
      name,
      sql: await readFile(join(dir, name), "utf8"),
    })),
  );
};
