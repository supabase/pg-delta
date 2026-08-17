import type { ClusterHandle, Diagnostic, SquashResult } from "./model/index.ts";
import { nextMidpointSplit, planSquash } from "./plan.ts";
import type { ManifestEntry } from "./emit/index.ts";
import {
  applyVolatilityMask,
  captureProofState,
  compareProofStates,
} from "./prove/index.ts";
import type { EquivalenceProof } from "./prove/index.ts";
import { isNonTransactional, replayChain } from "./replay/index.ts";
import type { ReplayFailure } from "./replay/index.ts";
import { sourceKeyForReplayFailure } from "./repair.ts";
import {
  createDatabasePool,
  diffLedger,
  revertLedger,
  snapshotLedger,
} from "./shadow/index.ts";
import type { LeasedDatabase } from "./shadow/index.ts";

export type SquashOptions = {
  cluster: ClusterHandle;
  baselineDatabase: string;
  pgVersion?: number;
  /** Skip the second original replay used for the volatility mask. */
  skipVolatilityMask?: boolean;
  /**
   * Emit BEGIN/COMMIT around packed files. Off by default; the apply
   * runner already wraps each output file. Authored BEGIN/COMMIT are
   * always preserved.
   */
  wrapTransactions?: boolean;
};

const emptyProof = (): EquivalenceProof => ({
  equal: false,
  originalRootHash: "",
  candidateRootHash: "",
  ledgerEqual: false,
  tables: [],
});

const repairNote = (message: string): Diagnostic => ({
  code: "repair-split",
  message,
});

const revertLedgerRetry = async (
  cluster: ClusterHandle,
  before: Awaited<ReturnType<typeof snapshotLedger>>,
): Promise<void> => {
  try {
    await revertLedger(cluster.admin, before);
  } catch {
    await revertLedger(cluster.admin, before);
  }
};

/**
 * Happy-path squash with a repair loop: on candidate failure or proof
 * mismatch, insert a segment boundary and retry. Worst case degenerates
 * toward original file/statement boundaries.
 */
export const squash = async (
  chain: { name: string; sql: string }[],
  options: SquashOptions,
): Promise<SquashResult> => {
  const pgMajor = options.pgVersion ?? options.cluster.pgMajor;
  const splitBefore = new Set<string>();
  const forceBarrier = new Set<string>();
  const diagnostics: Diagnostic[] = [];

  const planOptions = {
    splitBefore,
    forceBarrier,
    wrapTransactions: options.wrapTransactions,
  };

  let planned = await planSquash(chain, pgMajor, planOptions);
  diagnostics.push(...planned.diagnostics);
  if (planned.refused) {
    return {
      files: planned.files,
      manifest: planned.manifest,
      proof: emptyProof(),
      diagnostics,
    };
  }

  const maxAttempts = Math.max(
    8,
    chain.length * 2,
    planned.statementKeys.length * 2,
  );

  const dbPool = createDatabasePool(options.cluster, {
    baselineDatabase: options.baselineDatabase,
    size: 3,
  });
  let original: LeasedDatabase | undefined = await dbPool.take();
  let candidate: LeasedDatabase | undefined = await dbPool.take();
  const before = await snapshotLedger(options.cluster.admin);

  const recycleCandidate = async (): Promise<void> => {
    if (candidate !== undefined) {
      await dbPool.release(candidate).catch(() => {});
      candidate = undefined;
    }
    await revertLedgerRetry(options.cluster, before).catch(() => {});
    candidate = await dbPool.take();
  };

  try {
    const originalReplay = await replayChain(original.pool, chain);
    if (!originalReplay.ok) {
      diagnostics.push({
        code: "parse-error",
        message: `original chain failed at ${originalReplay.failure.file}: ${originalReplay.failure.message}`,
      });
      return {
        files: chain,
        manifest: [],
        proof: emptyProof(),
        diagnostics,
      };
    }
    const originalLedger = diffLedger(
      before,
      await snapshotLedger(options.cluster.admin),
    );
    let originalState = await captureProofState(original.pool, originalLedger);
    await dbPool.release(original);
    original = undefined;
    await revertLedgerRetry(options.cluster, before);

    if (options.skipVolatilityMask !== true) {
      const prime = await dbPool.take();
      try {
        const primeReplay = await replayChain(prime.pool, chain);
        if (primeReplay.ok) {
          const primeLedger = diffLedger(
            before,
            await snapshotLedger(options.cluster.admin),
          );
          const primeState = await captureProofState(prime.pool, primeLedger);
          originalState = applyVolatilityMask(originalState, primeState);
        }
      } finally {
        await dbPool.release(prime).catch(() => {});
        await revertLedgerRetry(options.cluster, before).catch(() => {});
      }
    }

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (attempt > 0) {
        await recycleCandidate();
        planned = await planSquash(chain, pgMajor, planOptions);
        diagnostics.push(...planned.diagnostics);
      }
      if (candidate === undefined) {
        candidate = await dbPool.take();
      }

      const candidateReplay = await replayChain(candidate.pool, planned.files);
      if (!candidateReplay.ok) {
        const split = recordFailureSplit(
          planned.statementKeys,
          planned.manifest,
          splitBefore,
          forceBarrier,
          candidateReplay.failure,
        );
        diagnostics.push(
          repairNote(
            `attempt ${attempt + 1}: ${candidateReplay.failure.file}: ${candidateReplay.failure.message}${split}`,
          ),
        );
        if (split === "") break;
        continue;
      }

      const candidateLedger = diffLedger(
        before,
        await snapshotLedger(options.cluster.admin),
      );
      const candidateState = await captureProofState(
        candidate.pool,
        candidateLedger,
      );
      const proof = compareProofStates(originalState, candidateState);
      if (proof.equal) {
        return {
          files: planned.files,
          manifest: planned.manifest,
          proof,
          diagnostics,
        };
      }

      const mid = nextMidpointSplit(planned.statementKeys, splitBefore);
      if (mid === undefined) {
        diagnostics.push(
          repairNote("proof mismatch with no remaining split points"),
        );
        return {
          files: planned.files,
          manifest: planned.manifest,
          proof,
          diagnostics,
        };
      }
      splitBefore.add(mid);
      diagnostics.push(
        repairNote(
          `attempt ${attempt + 1}: proof mismatch, split before ${mid}`,
        ),
      );
    }

    return {
      files: planned.files,
      manifest: planned.manifest,
      proof: emptyProof(),
      diagnostics,
    };
  } finally {
    if (original !== undefined) {
      await dbPool.release(original).catch(() => {});
    }
    if (candidate !== undefined) {
      await dbPool.release(candidate).catch(() => {});
    }
    await dbPool.drain().catch(() => {});
    await revertLedgerRetry(options.cluster, before).catch(() => {});
  }
};

const recordFailureSplit = (
  keys: readonly string[],
  manifest: readonly ManifestEntry[],
  splitBefore: Set<string>,
  forceBarrier: Set<string>,
  failure: ReplayFailure,
): string => {
  if (
    failure.nonTransactional ||
    isNonTransactional({ code: failure.sqlstate })
  ) {
    const sourceKey = sourceKeyForReplayFailure(failure, manifest);
    const isolated = sourceKey ?? keys[keys.length - 1];
    if (isolated !== undefined) {
      forceBarrier.add(isolated);
      splitBefore.add(isolated);
      return `; isolated ${isolated} as a runtime barrier`;
    }
  }
  const mid = nextMidpointSplit(keys, splitBefore);
  if (mid === undefined) return "";
  splitBefore.add(mid);
  return `; split before ${mid}`;
};
