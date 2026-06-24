import { isAbsolute, resolve } from "node:path";

/**
 * Resolve a user-supplied run output directory to an absolute path that does
 * NOT depend on `process.cwd()`.
 *
 * A relative path is anchored to `repoRoot` (the monorepo root) so that, e.g.,
 * `docs/dogfooding/runs/bookmark` always lands in the same place whether the
 * runner is invoked in the foreground from the package dir, via `bun run`
 * (which sets cwd to the package), or backgrounded with a different cwd. The
 * earlier bug resolved the arg against the invocation cwd, so artifacts were
 * silently written to a path that didn't survive. Absolute paths pass through
 * unchanged. When no path is given, falls back to `<repoRoot>/<defaultRelative>`.
 */
export function resolveRunOutDir(
  arg: string | undefined,
  repoRoot: string,
  defaultRelative: string,
): string {
  if (arg === undefined || arg === "")
    return resolve(repoRoot, defaultRelative);
  if (isAbsolute(arg)) return arg;
  return resolve(repoRoot, arg);
}
