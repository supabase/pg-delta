import type { ClusterHandle, Diagnostic, SquashResult } from "./model/index.ts";
import { nextMidpointSplit, planSquash } from "./plan.ts";
import {
  applyVolatilityMask,
  captureProofState,
  compareProofStates,
} from "./prove/index.ts";
import type { EquivalenceProof } from "./prove/index.ts";
import { isNonTransactional, replayChain } from "./replay/index.ts";
import type { ReplayFailure } from "./replay/index.ts";
import {
  createDatabasePool,
  diffLedger,
  revertLedger,
  snapshotLedger,
} from "./shadow/index.ts";

export type SquashOptions = {
  cluster: ClusterHandle;
  baselineDatabase: string;
  pgVersion?: number;
  /** Skip the second original replay used for the volatility mask. */
  skipVolatilityMask?: boolean;
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
  const maxAttempts = Math.max(8, chain.length * 2);
  const diagnostics: Diagnostic[] = [];

  let planned = await planSquash(chain, pgMajor, {
    splitBefore,
    forceBarrier,
  });
  diagnostics.push(...planned.diagnostics);
  if (planned.refused) {
    return {
      files: planned.files,
      manifest: planned.manifest,
      proof: emptyProof(),
      diagnostics,
    };
  }

  const dbPool = createDatabasePool(options.cluster, {
    baselineDatabase: options.baselineDatabase,
    size: 3,
  });
  const original = await dbPool.take();
  let candidate = await dbPool.take();
  const before = await snapshotLedger(options.cluster.admin);

  const recycleCandidate = async (): Promise<void> => {
    await dbPool.release(candidate).catch(() => {});
    await revertLedger(options.cluster.admin, before).catch(() => {});
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
    await revertLedger(options.cluster.admin, before);

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
        await revertLedger(options.cluster.admin, before).catch(() => {});
      }
    }

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (attempt > 0) {
        await recycleCandidate();
        planned = await planSquash(chain, pgMajor, {
          splitBefore,
          forceBarrier,
        });
        diagnostics.push(...planned.diagnostics);
      }

      const candidateReplay = await replayChain(candidate.pool, planned.files);
      if (!candidateReplay.ok) {
        const split = recordFailureSplit(
          planned.statementKeys,
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
    await revertLedger(options.cluster.admin, before).catch(() => {});
    await dbPool.release(original).catch(() => {});
    await dbPool.release(candidate).catch(() => {});
    await dbPool.drain().catch(() => {});
  }
};

const recordFailureSplit = (
  keys: readonly string[],
  splitBefore: Set<string>,
  forceBarrier: Set<string>,
  failure: ReplayFailure,
): string => {
  if (
    failure.nonTransactional ||
    isNonTransactional({ code: failure.sqlstate })
  ) {
    const mid = nextMidpointSplit(keys, splitBefore) ?? keys[keys.length - 1];
    if (mid !== undefined) {
      forceBarrier.add(mid);
      splitBefore.add(mid);
      return `; isolated ${mid} as a runtime barrier`;
    }
  }
  const mid = nextMidpointSplit(keys, splitBefore);
  if (mid === undefined) return "";
  splitBefore.add(mid);
  return `; split before ${mid}`;
};
