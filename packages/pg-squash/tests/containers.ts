/**
 * Slim shared PostgreSQL cluster for pg-squash integration tests.
 * Copied from pg-delta's testcontainers singleton (stock alpine only) —
 * do not import pg-delta's tests/containers.ts.
 */
import { setDefaultTimeout } from "bun:test";
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers";
import { Pool } from "pg";
import { openClusterHandle } from "../src/shadow/index.ts";
import type { ClusterHandle } from "../src/model/index.ts";

// Container boot plus CREATE DATABASE TEMPLATE routinely exceeds bun's 5s default.
setDefaultTimeout(60_000);

const PG_IMAGE = process.env["PGDELTA_TEST_IMAGE"] ?? "postgres:17-alpine";

let dbCounter = 0;

export class Cluster {
  #pgMajor: number | undefined;

  constructor(
    readonly container: StartedTestContainer,
    readonly adminPool: Pool,
    readonly uriFor: (db: string) => string,
  ) {}

  async pgMajor(): Promise<number> {
    if (this.#pgMajor === undefined) {
      const res = await this.adminPool.query<{ v: number }>(
        `SELECT current_setting('server_version_num')::int AS v`,
      );
      const v = res.rows[0]?.v;
      if (v === undefined) {
        throw new Error("could not read server_version_num");
      }
      this.#pgMajor = Math.floor(v / 10000);
    }
    return this.#pgMajor;
  }
}

const startCluster = async (): Promise<Cluster> => {
  const container = await new GenericContainer(PG_IMAGE)
    .withEnvironment({
      POSTGRES_USER: "test",
      POSTGRES_PASSWORD: "test",
      POSTGRES_DB: "postgres",
    })
    .withCommand([
      "postgres",
      "-c",
      "fsync=off",
      "-c",
      "full_page_writes=off",
      "-c",
      "max_connections=300",
    ])
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage(/database system is ready to accept connections/, 2),
    )
    .start();
  const uriFor = (db: string) =>
    `postgres://test:test@${container.getHost()}:${container.getMappedPort(5432)}/${db}`;
  const adminPool = new Pool({
    connectionString: uriFor("postgres"),
    max: 3,
  });
  adminPool.on("error", () => {});
  return new Cluster(container, adminPool, uriFor);
};

let shared: Promise<Cluster> | null = null;

export const sharedCluster = (): Promise<Cluster> => {
  shared ??= startCluster();
  return shared;
};

export const testClusterHandle = async (): Promise<ClusterHandle> => {
  const cluster = await sharedCluster();
  return openClusterHandle({
    admin: cluster.adminPool,
    connectionStringFor: cluster.uriFor,
    pgMajor: await cluster.pgMajor(),
  });
};

/** Serialize tests that snapshot/revert cluster-global roles. */
let ledgerLock = Promise.resolve();

export const withLedgerLock = async <T>(fn: () => Promise<T>): Promise<T> => {
  const prev = ledgerLock;
  let release: () => void = () => {};
  ledgerLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
};

export const uniqueRoleName = (prefix = "sq_role"): string => {
  dbCounter += 1;
  return `${prefix}_${dbCounter}_${Math.random().toString(36).slice(2, 8)}`;
};
