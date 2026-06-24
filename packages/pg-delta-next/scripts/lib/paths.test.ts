import { describe, expect, test } from "bun:test";
import { resolveRunOutDir } from "./paths.ts";

const REPO_ROOT = "/repo";

describe("resolveRunOutDir", () => {
  test("anchors a relative path to repoRoot, not process.cwd()", () => {
    // The bug this guards: a relative out-dir was resolved against the
    // invocation cwd, which differs between `bun run`, foreground, and a
    // backgrounded shell — so artifacts silently landed in the wrong place.
    expect(
      resolveRunOutDir("docs/dogfooding/runs/bookmark", REPO_ROOT, "fallback"),
    ).toBe("/repo/docs/dogfooding/runs/bookmark");
  });

  test("normalizes a relative path with leading ./ and ../ segments", () => {
    expect(resolveRunOutDir("./a/../b", REPO_ROOT, "fallback")).toBe("/repo/b");
  });

  test("passes an absolute path through unchanged", () => {
    expect(resolveRunOutDir("/tmp/run", REPO_ROOT, "fallback")).toBe(
      "/tmp/run",
    );
  });

  test("falls back to <repoRoot>/<default> when no arg is given", () => {
    expect(resolveRunOutDir(undefined, REPO_ROOT, "docs/runs/suite")).toBe(
      "/repo/docs/runs/suite",
    );
    expect(resolveRunOutDir("", REPO_ROOT, "docs/runs/suite")).toBe(
      "/repo/docs/runs/suite",
    );
  });
});
