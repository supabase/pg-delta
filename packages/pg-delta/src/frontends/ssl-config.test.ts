import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSslConfig } from "./ssl-config.ts";

const BASE = "postgres://user:p%40ss@db.example.com:6543/mydb";

const ENV_VARS = [
  "PGDELTA_SOURCE_SSLROOTCERT",
  "PGDELTA_TARGET_SSLROOTCERT",
  "PGDELTA_SOURCE_SSLCERT",
  "PGDELTA_TARGET_SSLCERT",
  "PGDELTA_SOURCE_SSLKEY",
  "PGDELTA_TARGET_SSLKEY",
];

afterEach(() => {
  for (const name of ENV_VARS) delete process.env[name];
});

describe("parseSslConfig", () => {
  test.each(["require", "prefer"] as const)(
    "sslmode=%s without a CA encrypts without verification (libpq parity)",
    (sslmode) => {
      const { ssl, cleanedUrl } = parseSslConfig(`${BASE}?sslmode=${sslmode}`);

      expect(ssl).toMatchObject({ rejectUnauthorized: false });
      const url = new URL(cleanedUrl);
      expect(url.searchParams.get("sslmode")).toBeNull();
      expect(url.username).toBe("user");
      expect(url.password).toBe("p%40ss");
      expect(url.hostname).toBe("db.example.com");
      expect(url.port).toBe("6543");
      expect(url.pathname).toBe("/mydb");
    },
  );

  test("require/prefer without a CA never sets ca and never skips hostname checks", () => {
    const { ssl } = parseSslConfig(`${BASE}?sslmode=require`);
    expect(ssl).toStrictEqual({ rejectUnauthorized: false });
  });

  test("sslmode=disable maps to ssl: false with params stripped", () => {
    const { ssl, cleanedUrl } = parseSslConfig(`${BASE}?sslmode=disable`);
    expect(ssl).toBe(false);
    expect(new URL(cleanedUrl).searchParams.get("sslmode")).toBeNull();
  });

  test("node-postgres ssl param is stripped when a handled sslmode takes ownership", () => {
    // pg merges connection-string params OVER explicit config, so a surviving
    // ssl=no-verify would silently disable the verification verify-full asks
    // for (and ssl=true would re-enable TLS under sslmode=disable).
    const full = parseSslConfig(`${BASE}?sslmode=verify-full&ssl=no-verify`);
    expect(full.ssl).toStrictEqual({ rejectUnauthorized: true });
    expect(new URL(full.cleanedUrl).searchParams.get("ssl")).toBeNull();

    const off = parseSslConfig(`${BASE}?ssl=true&sslmode=disable`);
    expect(off.ssl).toBe(false);
    expect(new URL(off.cleanedUrl).searchParams.get("ssl")).toBeNull();
  });

  test("node-postgres ssl param survives passthrough (no recognized sslmode)", () => {
    const url = `${BASE}?ssl=no-verify`;
    expect(parseSslConfig(url)).toStrictEqual({ cleanedUrl: url });
  });

  test("absent sslmode passes through untouched (node-postgres defaults apply)", () => {
    const url = `${BASE}?application_name=pgdelta`;
    expect(parseSslConfig(url)).toStrictEqual({ cleanedUrl: url });
  });

  test("unrecognized sslmode passes through untouched", () => {
    const url = `${BASE}?sslmode=allow`;
    expect(parseSslConfig(url)).toStrictEqual({ cleanedUrl: url });
  });

  test("verify-full verifies chain and hostname (no checkServerIdentity override)", () => {
    const { ssl } = parseSslConfig(`${BASE}?sslmode=verify-full`);
    expect(ssl).toStrictEqual({ rejectUnauthorized: true });
  });

  test("verify-ca without a CA keeps hostname verification (Node trust store)", () => {
    // Skipping hostname checks is only safe against a caller-supplied CA.
    // With no CA resolved, the chain is verified against Node's default
    // public store, where "any valid cert for any host" must not pass —
    // so no checkServerIdentity override.
    const { ssl } = parseSslConfig(`${BASE}?sslmode=verify-ca`);
    expect(ssl).toStrictEqual({ rejectUnauthorized: true });
  });

  describe("with certificate files", () => {
    const dir = mkdtempSync(join(tmpdir(), "pgdelta-sslconfig-"));
    const caPath = join(dir, "ca.pem");
    const certPath = join(dir, "client-cert.pem");
    const keyPath = join(dir, "client-key.pem");
    writeFileSync(caPath, "CA-PEM");
    writeFileSync(certPath, "CERT-PEM");
    writeFileSync(keyPath, "KEY-PEM");
    afterAll(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    test("require + sslrootcert file behaves like verify-ca (libpq compat)", () => {
      const { ssl, cleanedUrl } = parseSslConfig(
        `${BASE}?sslmode=require&sslrootcert=${encodeURIComponent(caPath)}`,
      );
      if (ssl === false || ssl === undefined)
        throw new Error("expected ssl options");
      expect(ssl.rejectUnauthorized).toBe(true);
      expect(ssl.ca).toBe("CA-PEM");
      expect(ssl.checkServerIdentity).toBeDefined();
      expect(new URL(cleanedUrl).searchParams.get("sslrootcert")).toBeNull();
    });

    test("verify-ca + sslrootcert skips hostname verification (libpq semantics)", () => {
      const { ssl } = parseSslConfig(
        `${BASE}?sslmode=verify-ca&sslrootcert=${encodeURIComponent(caPath)}`,
      );
      if (ssl === false || ssl === undefined)
        throw new Error("expected ssl options");
      expect(ssl.rejectUnauthorized).toBe(true);
      expect(ssl.ca).toBe("CA-PEM");
      expect(ssl.checkServerIdentity).toBeDefined();
      expect(ssl.checkServerIdentity?.()).toBeUndefined();
    });

    test("verify-full + sslrootcert keeps hostname verification", () => {
      const { ssl } = parseSslConfig(
        `${BASE}?sslmode=verify-full&sslrootcert=${encodeURIComponent(caPath)}`,
      );
      expect(ssl).toStrictEqual({ rejectUnauthorized: true, ca: "CA-PEM" });
    });

    test("client cert and key are read for mutual TLS", () => {
      const { ssl } = parseSslConfig(
        `${BASE}?sslmode=require&sslcert=${encodeURIComponent(certPath)}&sslkey=${encodeURIComponent(keyPath)}`,
      );
      if (ssl === false || ssl === undefined)
        throw new Error("expected ssl options");
      expect(ssl.cert).toBe("CERT-PEM");
      expect(ssl.key).toBe("KEY-PEM");
      expect(ssl.rejectUnauthorized).toBe(false);
    });

    test("client cert without key throws", () => {
      expect(() =>
        parseSslConfig(
          `${BASE}?sslmode=require&sslcert=${encodeURIComponent(certPath)}`,
        ),
      ).toThrow(/certificate and key must be provided together/);
    });

    test("unreadable certificate file throws with the path in the message", () => {
      expect(() =>
        parseSslConfig(
          `${BASE}?sslmode=require&sslrootcert=${encodeURIComponent(join(dir, "missing.pem"))}`,
        ),
      ).toThrow(/Failed to read certificate file/);
    });
  });

  describe("environment fallbacks", () => {
    test("verify-ca reads the role-scoped PGDELTA_*_SSLROOTCERT content", () => {
      process.env["PGDELTA_SOURCE_SSLROOTCERT"] = "SOURCE-CA";
      process.env["PGDELTA_TARGET_SSLROOTCERT"] = "TARGET-CA";

      const source = parseSslConfig(`${BASE}?sslmode=verify-ca`, "source");
      const target = parseSslConfig(`${BASE}?sslmode=verify-ca`, "target");

      expect(source.ssl).toMatchObject({
        rejectUnauthorized: true,
        ca: "SOURCE-CA",
      });
      expect(target.ssl).toMatchObject({
        rejectUnauthorized: true,
        ca: "TARGET-CA",
      });
      // An env-resolved CA counts as a supplied CA: hostname checks skip.
      if (target.ssl === false || target.ssl === undefined)
        throw new Error("expected ssl options");
      expect(target.ssl.checkServerIdentity).toBeDefined();
    });

    test("require does NOT read the env CA (libpq: only an explicit root CA file upgrades require)", () => {
      process.env["PGDELTA_TARGET_SSLROOTCERT"] = "TARGET-CA";
      const { ssl } = parseSslConfig(`${BASE}?sslmode=require`, "target");
      expect(ssl).toStrictEqual({ rejectUnauthorized: false });
    });

    test("client cert/key env content is honored", () => {
      process.env["PGDELTA_TARGET_SSLCERT"] = "ENV-CERT";
      process.env["PGDELTA_TARGET_SSLKEY"] = "ENV-KEY";
      const { ssl } = parseSslConfig(`${BASE}?sslmode=require`, "target");
      expect(ssl).toMatchObject({ cert: "ENV-CERT", key: "ENV-KEY" });
    });
  });
});
