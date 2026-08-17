import type { ManifestEntry } from "./emit/index.ts";
import { statementKey } from "./plan.ts";
import type { ReplayFailure } from "./replay/index.ts";

/**
 * Map a candidate replay failure onto the source statement key recorded in
 * the emit manifest. `wrapTransactions` inserts BEGIN/COMMIT around the
 * file, so statementIndex may be offset by one.
 */
export const sourceKeyForReplayFailure = (
  failure: ReplayFailure,
  manifest: readonly ManifestEntry[],
): string | undefined => {
  const inFile = manifest.filter((m) => m.outputFile === failure.file);
  const exact = inFile.find((m) => m.statementIndex === failure.statementIndex);
  if (exact !== undefined) {
    return statementKey(exact.source.file, exact.source.statementIndex);
  }
  const wrapped = inFile.find(
    (m) => m.statementIndex === failure.statementIndex - 1,
  );
  if (wrapped !== undefined) {
    return statementKey(wrapped.source.file, wrapped.source.statementIndex);
  }
  return undefined;
};
