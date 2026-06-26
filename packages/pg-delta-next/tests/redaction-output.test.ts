/**
 * Secret-redaction output parity (port of the old suite's
 * fdw-option-secret-redaction.test.ts + the masking half of
 * sensitive-and-env-dependent-handling.test.ts).
 *
 * pg-delta must NEVER emit foreign-data-wrapper / server / user-mapping /
 * foreign-table option secrets, nor subscription conninfo credentials, in any
 * output channel: plan SQL, the catalog snapshot (which also feeds the
 * fingerprint digest), the declarative SQL-file export, or the serialized plan
 * artifact. Corpus convergence does NOT prove this — corpus a.sql/b.sql carry
 * literal values that round-trip whether or not they are redacted. This file is
 * the dedicated proof that every channel is scrubbed.
 *
 * If any assertion here fails, an output path is leaking credentials in
 * cleartext. Treat as critical.
 */
import { describe, expect, test } from "bun:test";
import { serializeSnapshot } from "../src/core/snapshot.ts";
import { extract } from "../src/extract/extract.ts";
import { exportSqlFiles } from "../src/frontends/export-sql-files.ts";
import { plan } from "../src/plan/plan.ts";
import { serializePlan } from "../src/plan/artifact.ts";
import { sharedCluster } from "./containers.ts";

// Distinctive sentinels planted at every OPTIONS-bearing layer. None of these
// may appear in any rendered/persisted artifact.
const OPTION_SECRETS = [
  "fdw-shared-secret",
  "fdw-api-key",
  "real-user-password",
  "/etc/secrets/passfile",
  "krb-passcode",
  "ssl-secret",
  "table-shared-secret",
];
const CONNINFO_SECRET = "subconnpassword";

const SETUP_SQL = /* sql */ `
  CREATE FOREIGN DATA WRAPPER redact_fdw OPTIONS (
    use_remote_estimate 'true',
    password 'fdw-shared-secret',
    api_key 'fdw-api-key'
  );
  CREATE SERVER redact_server FOREIGN DATA WRAPPER redact_fdw OPTIONS (
    host 'remote.example.com',
    port '5432',
    password 'real-user-password',
    passfile '/etc/secrets/passfile'
  );
  CREATE USER MAPPING FOR CURRENT_USER SERVER redact_server OPTIONS (
    "user" 'fdw_reader',
    password 'real-user-password',
    passcode 'krb-passcode',
    sslpassword 'ssl-secret'
  );
  CREATE FOREIGN TABLE redact_table (id integer) SERVER redact_server OPTIONS (
    schema_name 'remote_schema',
    password 'table-shared-secret'
  );
`;

function planSql(p: ReturnType<typeof plan>): string {
  return p.actions.map((a) => a.sql).join("\n");
}

describe("secret redaction across output channels", () => {
  test("FDW/server/user-mapping/foreign-table option secrets never leak; non-secret options survive", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("redact_src");
    const tgt = await cluster.createDb("redact_tgt");
    await tgt.pool.query(SETUP_SQL);

    const [s, d] = [await extract(src.pool), await extract(tgt.pool)];
    const thePlan = plan(s.factBase, d.factBase);

    const pg = String(await cluster.pgMajor());
    const channels: Record<string, string> = {
      "plan SQL": planSql(thePlan),
      snapshot: serializeSnapshot(d.factBase, { pgVersion: pg }),
      "declarative export": exportSqlFiles(d.factBase)
        .map((f) => f.sql)
        .join("\n"),
      "plan artifact": serializePlan(thePlan),
    };

    // No secret may appear in ANY channel.
    for (const [channel, text] of Object.entries(channels)) {
      for (const secret of OPTION_SECRETS) {
        expect(
          text.includes(secret),
          `secret "${secret}" leaked into ${channel}`,
        ).toBe(false);
      }
    }

    // Non-secret options must still round-trip in the plan SQL, and sensitive
    // keys must be replaced with the placeholder (parity with the old suite).
    // pg-delta-next quotes every option key, so assert the quoted-key form.
    const sql = channels["plan SQL"]!;
    expect(sql).toContain(`"host" 'remote.example.com'`);
    expect(sql).toContain(`"port" '5432'`);
    expect(sql).toContain(`"user" 'fdw_reader'`);
    expect(sql).toContain(`"use_remote_estimate" 'true'`);
    expect(sql).toContain(`"schema_name" 'remote_schema'`);
    expect(sql).toContain(`"password" '__OPTION_PASSWORD__'`);
    expect(sql).toContain(`"passfile" '__OPTION_PASSFILE__'`);
    expect(sql).toContain(`"passcode" '__OPTION_PASSCODE__'`);
    expect(sql).toContain(`"sslpassword" '__OPTION_SSLPASSWORD__'`);
    expect(sql).toContain(`"api_key" '__OPTION_API_KEY__'`);
  });

  test("subscription conninfo credentials never leak and are masked", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("redact_sub_src");
    const tgt = await cluster.createDb("redact_sub_tgt");
    const { rows } = await tgt.pool.query<{ name: string }>(
      "select current_database() as name",
    );
    const dbName = rows[0]!.name;
    await tgt.pool.query(`
      CREATE PUBLICATION redact_pub FOR ALL TABLES;
      CREATE SUBSCRIPTION redact_sub
        CONNECTION 'dbname=${dbName} password=${CONNINFO_SECRET}'
        PUBLICATION redact_pub
        WITH (connect = false, create_slot = false, enabled = false, slot_name = NONE);
    `);

    const [s, d] = [await extract(src.pool), await extract(tgt.pool)];
    const thePlan = plan(s.factBase, d.factBase);

    const pg = String(await cluster.pgMajor());
    const channels: Record<string, string> = {
      "plan SQL": planSql(thePlan),
      snapshot: serializeSnapshot(d.factBase, { pgVersion: pg }),
      "plan artifact": serializePlan(thePlan),
    };
    for (const [channel, text] of Object.entries(channels)) {
      expect(
        text.includes(CONNINFO_SECRET),
        `conninfo secret leaked into ${channel}`,
      ).toBe(false);
    }

    // The CREATE SUBSCRIPTION conninfo is fully masked to fixed placeholders.
    const sql = channels["plan SQL"]!;
    expect(sql).toContain(`CREATE SUBSCRIPTION "redact_sub"`);
    expect(sql).toContain("password=__CONN_PASSWORD__");
  });

  test("extract({ redactSecrets: false }) emits real values and raises a loud warning", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("redact_off_src");
    const tgt = await cluster.createDb("redact_off_tgt");
    const { rows } = await tgt.pool.query<{ name: string }>(
      "select current_database() as name",
    );
    const dbName = rows[0]!.name;
    await tgt.pool.query(SETUP_SQL);
    await tgt.pool.query(`
      CREATE PUBLICATION redact_off_pub FOR ALL TABLES;
      CREATE SUBSCRIPTION redact_off_sub
        CONNECTION 'dbname=${dbName} password=${CONNINFO_SECRET}'
        PUBLICATION redact_off_pub
        WITH (connect = false, create_slot = false, enabled = false, slot_name = NONE);
    `);

    const s = await extract(src.pool, { redactSecrets: false });
    const d = await extract(tgt.pool, { redactSecrets: false });
    const sql = plan(s.factBase, d.factBase)
      .actions.map((a) => a.sql)
      .join("\n");

    // With redaction OFF, real secrets are emitted in cleartext...
    expect(sql).toContain("fdw-shared-secret");
    expect(sql).toContain("real-user-password");
    expect(sql).toContain(CONNINFO_SECRET);
    // ...and NO redaction placeholders are present.
    expect(sql).not.toContain("__OPTION_");
    expect(sql).not.toContain("__CONN_");

    // Explicit opt-in is loud: a warning diagnostic must be raised.
    const warning = d.diagnostics.find(
      (x) => x.code === "secret-redaction-disabled",
    );
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe("warning");

    // Disabling redaction changes the fingerprint (real vs placeholder facts).
    const dRedacted = await extract(tgt.pool);
    expect(dRedacted.factBase.rootHash).not.toBe(d.factBase.rootHash);
    // The default path stays silent — no spurious warning.
    expect(
      dRedacted.diagnostics.some((x) => x.code === "secret-redaction-disabled"),
    ).toBe(false);
  });
});
