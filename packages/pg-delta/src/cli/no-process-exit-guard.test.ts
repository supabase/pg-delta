/**
 * Self-test for the test-harness guard (tests/no-process-exit-guard.ts, loaded
 * via bunfig `[test].preload`): confirms that `process.exit` is intercepted and
 * throws inside the test process instead of tearing the runner down. If this
 * ever fails, the guard is not active and an in-process `process.exit`
 * regression could once again abort the whole suite with no summary.
 */
import { describe, expect, test } from "bun:test";

describe("test-harness process.exit guard", () => {
  test("process.exit throws instead of exiting the test process", () => {
    expect(() => process.exit(2)).toThrow(/process\.exit\(2\) called inside/);
  });

  test("the guard reports whatever code was passed", () => {
    expect(() => process.exit(0)).toThrow(/process\.exit\(0\) called inside/);
    expect(() => process.exit(1)).toThrow(/process\.exit\(1\) called inside/);
  });
});
