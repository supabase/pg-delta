import { Pool } from "pg";
import type { ClusterHandle } from "../model/index.ts";
import { qid } from "./ident.ts";

export type OpenClusterHandleOptions = {
  admin: Pool;
  connectionStringFor: (database: string) => string;
  pgMajor?: number;
  poolMax?: number;
};

const probePgMajor = async (admin: Pool): Promise<number> => {
  const res = await admin.query<{ v: number }>(
    `SELECT current_setting('server_version_num')::int AS v`,
  );
  const v = res.rows[0]?.v;
  if (v === undefined) {
    throw new Error("could not read server_version_num");
  }
  return Math.floor(v / 10000);
};

const probeCreateDb = async (admin: Pool): Promise<boolean> => {
  const res = await admin.query<{ ok: boolean }>(
    `SELECT rolcreatedb OR rolsuper AS ok
     FROM pg_roles
     WHERE rolname = current_user`,
  );
  return res.rows[0]?.ok === true;
};

/**
 * Wrap an injected CREATEDB-capable admin pool as a {@link ClusterHandle}.
 * The library never boots Docker; the caller owns the admin pool lifecycle.
 */
export const openClusterHandle = async (
  options: OpenClusterHandleOptions,
): Promise<ClusterHandle> => {
  const pgMajor = options.pgMajor ?? (await probePgMajor(options.admin));
  const canCreate = await probeCreateDb(options.admin);
  if (!canCreate) {
    throw new Error("ClusterHandle admin role cannot CREATE DATABASE");
  }
  const poolMax = options.poolMax ?? 5;

  return {
    admin: options.admin,
    pgMajor,
    async createDatabase(name, template) {
      await options.admin.query(
        `CREATE DATABASE ${qid(name)} TEMPLATE ${qid(template)}`,
      );
    },
    async dropDatabase(name) {
      await options.admin.query(
        `DROP DATABASE IF EXISTS ${qid(name)} WITH (FORCE)`,
      );
    },
    async connect(database) {
      const pool = new Pool({
        connectionString: options.connectionStringFor(database),
        max: poolMax,
      });
      pool.on("error", () => {});
      return pool;
    },
  };
};
