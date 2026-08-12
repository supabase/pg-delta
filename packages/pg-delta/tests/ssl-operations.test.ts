/**
 * SSL/TLS connection semantics for the CLI pool helper and co-located shadow
 * provisioning.
 *
 * Regression under test (CLI-2176 / Sentry SUPABASE-API-8CZ): libpq treats
 * `sslmode=require`/`prefer` without a root CA as "encrypt the connection,
 * don't verify the chain", while node-postgres verifies against Node's default
 * trust store. The clean-room rewrite dropped the legacy ssl-config
 * translation, so every `sslmode=require` connection to a server with a
 * self-signed / internal-CA chain failed with SELF_SIGNED_CERT_IN_CHAIN.
 *
 * The container requires SSL for all TCP connections (pg_hba `hostssl`) and
 * presents a cert chain rooted in a throwaway test CA that Node does not
 * trust — exactly the Supabase branch-database shape.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import pg from "pg";
import { makePool } from "../src/cli/pool.ts";
import { extract } from "../src/extract/extract.ts";
import { provisionCoLocatedShadow } from "../src/frontends/shadow.ts";
import {
  PostgresSslContainer,
  type StartedPostgresSslContainer,
} from "./postgres-ssl.ts";
import { generateSslCertificates, type SslCertificates } from "./ssl-utils.ts";

const PG_IMAGE = process.env["PGDELTA_TEST_IMAGE"] ?? "postgres:17-alpine";
// The legacy SSL suite excluded PG 18: node-pg emits "Connection terminated
// unexpectedly" during sslmode=require fixture teardown on 18 in this focused
// file. 18 stays covered by the broader integration matrix.
const skipSslSuite = PG_IMAGE.includes("postgres:18");

async function queryOne(pool: pg.Pool): Promise<void> {
  const res = await pool.query("SELECT 1 AS one");
  expect(res.rows[0]).toEqual({ one: 1 });
}

describe.skipIf(skipSslSuite)(`SSL operations (${PG_IMAGE})`, () => {
  let certificates: SslCertificates;
  let container: StartedPostgresSslContainer;
  let baseUri: string;

  beforeAll(async () => {
    certificates = await generateSslCertificates();
    container = await new PostgresSslContainer(PG_IMAGE, certificates).start();
    baseUri = container.getConnectionUri();
  }, 180_000);

  afterAll(async () => {
    await container?.stop();
    await certificates?.cleanup();
  });

  test(
    "sslmode=require connects without chain verification (libpq parity)",
    async () => {
      const managed = makePool(`${baseUri}?sslmode=require`);
      try {
        const result = await extract(managed.pool);
        expect(result.factBase).toBeDefined();
      } finally {
        await managed.end();
      }
    },
    { timeout: 60_000, retry: 3 },
  );

  test(
    "sslmode=prefer connects without chain verification (libpq parity)",
    async () => {
      const managed = makePool(`${baseUri}?sslmode=prefer`);
      try {
        await queryOne(managed.pool);
      } finally {
        await managed.end();
      }
    },
    { timeout: 30_000, retry: 3 },
  );

  test(
    "sslmode=verify-full without a trusted CA still rejects the chain",
    async () => {
      const managed = makePool(`${baseUri}?sslmode=verify-full`);
      try {
        expect(managed.pool.query("SELECT 1")).rejects.toThrow(
          /self[- ]signed|certificate/i,
        );
      } finally {
        await managed.end();
      }
    },
    { timeout: 30_000, retry: 3 },
  );

  test(
    "sslmode=verify-ca with sslrootcert verifies the chain and connects",
    async () => {
      const managed = makePool(
        `${baseUri}?sslmode=verify-ca&sslrootcert=${encodeURIComponent(certificates.caCert)}`,
      );
      try {
        await queryOne(managed.pool);
      } finally {
        await managed.end();
      }
    },
    { timeout: 30_000, retry: 3 },
  );

  test(
    "sslmode=require with sslrootcert behaves like verify-ca (libpq compat)",
    async () => {
      const managed = makePool(
        `${baseUri}?sslmode=require&sslrootcert=${encodeURIComponent(certificates.caCert)}`,
      );
      try {
        await queryOne(managed.pool);
      } finally {
        await managed.end();
      }
    },
    { timeout: 30_000, retry: 3 },
  );

  test(
    "provisionCoLocatedShadow works against an sslmode=require target",
    async () => {
      const shadow = await provisionCoLocatedShadow(
        `${baseUri}?sslmode=require`,
        { uniqueSuffix: "ssl_ops_test" },
      );
      const managed = makePool(shadow.url);
      try {
        await queryOne(managed.pool);
      } finally {
        await managed.end();
        await shadow.cleanup();
      }
    },
    { timeout: 60_000, retry: 3 },
  );
});
