import type { ClusterHandle } from "../model/index.ts";
import type { LedgerSnapshot } from "./ledger.ts";
import type { LeasedDatabase } from "./pool.ts";
import { revertLedger, snapshotLedger } from "./ledger.ts";
import { uniqueDatabaseName } from "./names.ts";

export type Checkpoint = {
  templateDb: string;
  ledger: LedgerSnapshot;
};

/**
 * Clone `sourceName` into a new template database and snapshot the cluster
 * ledger. The caller must have closed every connection to `sourceName`
 * (`CREATE DATABASE … TEMPLATE` requires this).
 */
export const createCheckpoint = async (
  handle: ClusterHandle,
  sourceName: string,
): Promise<Checkpoint> => {
  const templateDb = uniqueDatabaseName("cp");
  await handle.createDatabase(templateDb, sourceName);
  const ledger = await snapshotLedger(handle.admin);
  return { templateDb, ledger };
};

/**
 * End connections on `lease`, create a checkpoint, and reopen the source.
 */
export const checkpointLease = async (
  handle: ClusterHandle,
  lease: LeasedDatabase,
): Promise<{ checkpoint: Checkpoint; lease: LeasedDatabase }> => {
  await lease.pool.end();
  const checkpoint = await createCheckpoint(handle, lease.name);
  const pool = await handle.connect(lease.name);
  return { checkpoint, lease: { name: lease.name, pool } };
};

export const dropCheckpoint = async (
  handle: ClusterHandle,
  checkpoint: Checkpoint,
): Promise<void> => {
  await handle.dropDatabase(checkpoint.templateDb);
};

/**
 * Revert the cluster ledger to the checkpoint snapshot, then clone the
 * template into a new database. Pass `drop` to tear down a failed replay
 * database first so `DROP ROLE` is not blocked by owned objects.
 */
export const restoreFromCheckpoint = async (
  handle: ClusterHandle,
  checkpoint: Checkpoint,
  options?: { drop?: LeasedDatabase },
): Promise<LeasedDatabase> => {
  if (options?.drop !== undefined) {
    await options.drop.pool.end().catch(() => {});
    await handle.dropDatabase(options.drop.name);
  }
  await revertLedger(handle.admin, checkpoint.ledger);
  const name = uniqueDatabaseName("rs");
  await handle.createDatabase(name, checkpoint.templateDb);
  const pool = await handle.connect(name);
  return { name, pool };
};
