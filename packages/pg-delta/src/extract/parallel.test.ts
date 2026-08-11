import { describe, expect, test } from "bun:test";
import {
  closeSnapshotWorkers,
  MAX_EXTRACT_CONCURRENCY,
  resolveStreamCount,
  runSlottedJobs,
} from "./parallel.ts";

describe("resolveStreamCount", () => {
  test("undefined and 1 mean the serial path", () => {
    expect(resolveStreamCount(undefined, 5)).toBe(1);
    expect(resolveStreamCount(1, 5)).toBe(1);
  });

  test("a request within the pool's capacity is honored", () => {
    expect(resolveStreamCount(4, 5)).toBe(4);
    expect(resolveStreamCount(5, 5)).toBe(5);
  });

  test("clamps to the pool's max so connect() can never queue", () => {
    // the coordinator holds one client for the whole extraction, so asking the
    // pool for more than it can hand out would block forever
    expect(resolveStreamCount(8, 5)).toBe(5);
    expect(resolveStreamCount(4, 1)).toBe(1);
    expect(resolveStreamCount(4, 2)).toBe(2);
  });

  test("clamps to the hard cap", () => {
    expect(resolveStreamCount(100, 100)).toBe(MAX_EXTRACT_CONCURRENCY);
    expect(MAX_EXTRACT_CONCURRENCY).toBe(8);
  });

  test("an unknown pool max falls back to node-pg's default of 10", () => {
    expect(resolveStreamCount(6, undefined)).toBe(6);
    expect(resolveStreamCount(20, undefined)).toBe(MAX_EXTRACT_CONCURRENCY);
  });

  test("a nonsense request is rejected instead of silently coerced", () => {
    for (const bad of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => resolveStreamCount(bad, 5)).toThrow(/concurrency/i);
    }
  });
});

/** The rejection value of `promise`, awaited (so nothing is left dangling) and
 *  asserted to have happened at all. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject, but it resolved");
}

describe("runSlottedJobs", () => {
  const deferred = <T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
  } => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  test("results are slotted by JOB index, never completion order", async () => {
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()];
    const run = runSlottedJobs(
      gates.map((gate) => () => gate.promise),
      3,
    );
    // settle backwards — a completion-order merge would produce c,b,a
    gates[2]!.resolve("c");
    await Promise.resolve();
    gates[0]!.resolve("a");
    await Promise.resolve();
    gates[1]!.resolve("b");
    expect(await run).toEqual(["a", "b", "c"]);
  });

  test("more jobs than streams still slot in job order", async () => {
    const jobs = Array.from({ length: 23 }, (_, index) => async () => {
      // deliberately inverted delays: later jobs finish first
      await Bun.sleep((23 - index) % 5);
      return index;
    });
    expect(await runSlottedJobs(jobs, 4)).toEqual(
      Array.from({ length: 23 }, (_, index) => index),
    );
  });

  test("never runs more than `streamCount` jobs at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const jobs = Array.from({ length: 20 }, () => async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Bun.sleep(1);
      inFlight--;
      return 0;
    });
    await runSlottedJobs(jobs, 3);
    expect(peak).toBe(3);
  });

  test("each job is told which stream it runs on", async () => {
    const streams = await runSlottedJobs(
      Array.from({ length: 12 }, () => async (stream: number) => stream),
      3,
    );
    expect(new Set(streams)).toEqual(new Set([0, 1, 2]));
  });

  test("the first failure wins and no later job is started", async () => {
    const started: number[] = [];
    const boom = new Error("first");
    const jobs = Array.from({ length: 10 }, (_, index) => async () => {
      started.push(index);
      if (index === 1) throw boom;
      if (index === 2) throw new Error("second");
      await Bun.sleep(1);
      return index;
    });
    // one stream → strictly sequential, so "first" is unambiguous
    expect(await rejection(runSlottedJobs(jobs, 1))).toBe(boom);
    expect(started).toEqual([0, 1]);
  });

  test("in-flight jobs are awaited before rejecting (no dangling work)", async () => {
    const slow = deferred<number>();
    let slowSettled = false;
    const jobs = [
      async () => {
        const value = await slow.promise;
        slowSettled = true;
        return value;
      },
      async () => {
        throw new Error("fast failure");
      },
    ];
    const run = runSlottedJobs(jobs, 2);
    // the failure has already happened, but the slow job is still open: the
    // scheduler must not reject until it settles, or the caller would ROLLBACK
    // a connection with a query still on the wire
    await Bun.sleep(5);
    expect(slowSettled).toBe(false);
    slow.resolve(1);
    expect((await rejection(run)) as Error).toHaveProperty(
      "message",
      "fast failure",
    );
    expect(slowSettled).toBe(true);
  });

  test("an empty job list is a no-op", async () => {
    expect(await runSlottedJobs([], 4)).toEqual([]);
  });

  // extract.ts's `runFamiliesAcrossStreams` puts the pg_depend resolver — by
  // far the most expensive single query in the extractor — at job index 0,
  // ahead of the 22 family jobs, specifically so it is PULLED first instead of
  // becoming a serial tail once every other job has already finished (see
  // ./extract.ts). These tests pin the scheduler guarantee that reordering
  // relies on: job 0 always starts in the very first pulled batch, and the
  // merge stays index-ordered regardless of what any individual job returns.
  test("job 0 starts in the first pulled batch, never deferred behind later jobs", async () => {
    const startOrder: number[] = [];
    // Mirrors extract.ts's shape: 1 expensive job (index 0, the dependency
    // fetch) + 22 cheap ones (the families), at a stream count well below the
    // job count — exactly where the old append-at-the-end order regressed to
    // a serial tail.
    const jobs = [
      async (): Promise<number> => {
        startOrder.push(0);
        await Bun.sleep(20); // the expensive one
        return 0;
      },
      ...Array.from(
        { length: 22 },
        (_unused, index) => async (): Promise<number> => {
          startOrder.push(index + 1);
          return index + 1;
        },
      ),
    ];
    const result = await runSlottedJobs(jobs, 4);
    // job 0 is among the first `streamCount` jobs STARTED, not the last —
    // that is what "pulled first" means (pull order is index order; only the
    // finish order can vary with concurrency).
    expect(startOrder.slice(0, 4)).toContain(0);
    expect(startOrder[startOrder.length - 1]).not.toBe(0);
    expect(result).toEqual(Array.from({ length: 23 }, (_, index) => index));
  });

  test("deterministic merge: an undefined-returning job (dependency fetch) keeps its index slot regardless of completion time", async () => {
    // The dependency job contributes no collector of its own (extract.ts's
    // merge loop treats an `undefined` slot as "skip"); it must still occupy
    // its own array position so family slots either side of it are unaffected.
    const jobs: (() => Promise<string | undefined>)[] = [
      async () => {
        await Bun.sleep(15); // slow AND resolves last
        return undefined;
      },
      async () => "family-a",
      async () => "family-b",
      async () => "family-c",
    ];
    const slots = await runSlottedJobs(jobs, 4);
    expect(slots).toEqual([undefined, "family-a", "family-b", "family-c"]);
  });
});

describe("closeSnapshotWorkers", () => {
  type FakePoolClient = import("pg").PoolClient;

  /** A worker whose ROLLBACK behaves as directed and whose release() records
   *  how it was called — the pool-side contract under test. */
  function fakeWorker(rollback: "ok" | "dead"): {
    worker: { client: FakePoolClient; q: () => Promise<never> };
    releasedWith: unknown[][];
  } {
    const releasedWith: unknown[][] = [];
    const client = {
      query: () =>
        rollback === "ok"
          ? Promise.resolve({ rows: [] })
          : Promise.reject(new Error("Connection terminated unexpectedly")),
      release: (...args: unknown[]) => {
        releasedWith.push(args);
      },
    } as unknown as FakePoolClient;
    return {
      worker: { client, q: () => Promise.reject(new Error("unused")) },
      releasedWith,
    };
  }

  test("a clean worker is re-pooled (release with no error)", async () => {
    const { worker, releasedWith } = fakeWorker("ok");
    await closeSnapshotWorkers([worker]);
    expect(releasedWith).toHaveLength(1);
    expect(releasedWith[0]!.filter((a) => Boolean(a))).toHaveLength(0);
  });

  test("a worker whose ROLLBACK fails is destroyed, not re-pooled", async () => {
    // A dead TCP connection makes ROLLBACK reject; plain release() would hand
    // the corpse back to the pool and poison the next checkout. release(error)
    // tells node-pg to destroy it instead.
    const { worker, releasedWith } = fakeWorker("dead");
    await closeSnapshotWorkers([worker]);
    expect(releasedWith).toHaveLength(1);
    expect(releasedWith[0]![0]).toBeInstanceOf(Error);
  });

  test("one dead worker does not stop clean siblings from releasing", async () => {
    const dead = fakeWorker("dead");
    const clean = fakeWorker("ok");
    await closeSnapshotWorkers([dead.worker, clean.worker]);
    expect(dead.releasedWith).toHaveLength(1);
    expect(clean.releasedWith).toHaveLength(1);
  });
});
