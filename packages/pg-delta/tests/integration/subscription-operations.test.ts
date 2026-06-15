import { describe, expect, test } from "bun:test";
import { sql } from "@ts-safeql/sql-tag";
import dedent from "dedent";
import type { Change } from "../../src/core/change.types.ts";
import { applyPlan } from "../../src/core/plan/apply.ts";
import { createPlan } from "../../src/core/plan/create.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb, withDbIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`subscription operations (pg${pgVersion})`, () => {
    test(
      "create subscription without connecting",
      withDb(pgVersion, async (db) => {
        const {
          rows: [{ name: mainDbName }],
        } = await db.main.query<{ name: string }>(
          sql`select current_database() as name`,
        );

        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE PUBLICATION sub_create_pub FOR ALL TABLES;
        `,
          testSql: `
          CREATE SUBSCRIPTION sub_create
            CONNECTION 'dbname=${mainDbName}'
            PUBLICATION sub_create_pub
            WITH (
              connect = false,
              create_slot = false,
              enabled = false,
              slot_name = NONE
            );
        `,
        });
      }),
    );

    test(
      "alter subscription configuration",
      withDbIsolated(pgVersion, async (db) => {
        const {
          rows: [{ name: mainDbName }],
        } = await db.main.query<{ name: string }>(
          sql`select current_database() as name`,
        );

        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE PUBLICATION sub_alter_pub FOR ALL TABLES;
          CREATE PUBLICATION sub_alter_pub2 FOR ALL TABLES;
          CREATE ROLE sub_owner SUPERUSER;
          CREATE SUBSCRIPTION sub_alter
            CONNECTION 'dbname=${mainDbName}'
            PUBLICATION sub_alter_pub
            WITH (
              connect = false,
              create_slot = false,
              enabled = false,
              slot_name = NONE
            );
        `,
          testSql: `
          ALTER SUBSCRIPTION sub_alter
            CONNECTION 'dbname=postgres application_name=sub_alter';

          ALTER SUBSCRIPTION sub_alter
            SET PUBLICATION sub_alter_pub, sub_alter_pub2 WITH (refresh = false);

          ALTER SUBSCRIPTION sub_alter SET (
            slot_name = 'sub_alter_slot',
            binary = true,
            streaming = ${pgVersion >= 17 ? "'parallel'" : "true"},
            synchronous_commit = 'local'${
              pgVersion >= 15 ? ", disable_on_error = true" : ""
            }${pgVersion >= 16 ? ", password_required = false" : ""}${
              pgVersion >= 17 ? ", run_as_owner = true" : ""
            }${pgVersion >= 17 ? ", origin = 'none'" : ""}
          );

          COMMENT ON SUBSCRIPTION sub_alter IS 'subscription metadata';
          ALTER SUBSCRIPTION sub_alter OWNER TO sub_owner;
        `,
        });
      }),
    );

    test(
      "drop subscription",
      withDb(pgVersion, async (db) => {
        const {
          rows: [{ name: mainDbName }],
        } = await db.main.query<{ name: string }>(
          sql`select current_database() as name`,
        );

        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE PUBLICATION sub_drop_pub FOR ALL TABLES;
          CREATE SUBSCRIPTION sub_drop
            CONNECTION 'dbname=${mainDbName}'
            PUBLICATION sub_drop_pub
            WITH (
              connect = false,
              create_slot = false,
              enabled = false,
              slot_name = NONE
            );
        `,
          testSql: `DROP SUBSCRIPTION sub_drop;`,
        });
      }),
    );

    test(
      "subscription comment creation",
      withDb(pgVersion, async (db) => {
        const {
          rows: [{ name: mainDbName }],
        } = await db.main.query<{ name: string }>(
          sql`select current_database() as name`,
        );

        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
          CREATE PUBLICATION sub_comment_pub FOR ALL TABLES;
          CREATE SUBSCRIPTION sub_comment
            CONNECTION 'dbname=${mainDbName}'
            PUBLICATION sub_comment_pub
            WITH (
              connect = false,
              create_slot = false,
              enabled = false,
              slot_name = NONE
            );
        `,
          testSql: `COMMENT ON SUBSCRIPTION sub_comment IS 'subscription comment';`,
        });
      }),
    );

    test(
      "subscription comment removal",
      withDb(pgVersion, async (db) => {
        const {
          rows: [{ name: mainDbName }],
        } = await db.main.query<{ name: string }>(
          sql`select current_database() as name`,
        );

        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
          CREATE PUBLICATION sub_comment_drop_pub FOR ALL TABLES;
          CREATE SUBSCRIPTION sub_comment_drop
            CONNECTION 'dbname=${mainDbName}'
            PUBLICATION sub_comment_drop_pub
            WITH (
              connect = false,
              create_slot = false,
              enabled = false,
              slot_name = NONE
            );
          COMMENT ON SUBSCRIPTION sub_comment_drop IS 'subscription comment';
        `,
          testSql: `COMMENT ON SUBSCRIPTION sub_comment_drop IS NULL;`,
        });
      }),
    );

    test(
      "subscription comment creation depends on subscription create order",
      withDb(pgVersion, async (db) => {
        const {
          rows: [{ name: mainDbName }],
        } = await db.main.query<{ name: string }>(
          sql`select current_database() as name`,
        );

        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE PUBLICATION sub_comment_dependency_pub FOR ALL TABLES;
          `,
          testSql: dedent`
            CREATE SUBSCRIPTION sub_comment_dependency
              CONNECTION 'dbname=${mainDbName}'
              PUBLICATION sub_comment_dependency_pub
              WITH (
                connect = false,
                create_slot = false,
                enabled = false,
                slot_name = NONE
              );

            COMMENT ON SUBSCRIPTION sub_comment_dependency IS 'dependency check';
          `,
          sortChangesCallback: (a: Change, b: Change) => {
            // Force the comment create to sort ahead of the subscription create to prove the sorter fixes the order.
            const priority = (change: Change) => {
              if (
                change.objectType === "subscription" &&
                change.scope === "comment" &&
                change.operation === "create"
              ) {
                return 0;
              }
              if (
                change.objectType === "subscription" &&
                change.scope === "object" &&
                change.operation === "create"
              ) {
                return 1;
              }
              return 2;
            };
            return priority(a) - priority(b);
          },
        });
      }),
    );

    test(
      "creates a subscription reusing an existing replication slot inside a transaction",
      withDbIsolated(pgVersion, async (db) => {
        // A subscription whose replication slot actually exists must
        // serialize with create_slot = false so the slot is reused instead of
        // recreated. That form keeps the connect = true default and is
        // accepted inside a transaction block (PostgreSQL's 25001 gate is on
        // create_slot = true), so the plan stays fully transactional.
        // Extraction redacts conninfo to the __CONN_*__ placeholder (it
        // carries credentials), so the apply leg substitutes real connection
        // values first — exactly what a user does — and executes the result
        // inside an explicit transaction against the same cluster, which only
        // works because no slot is created as part of the command.
        const {
          rows: [{ name: branchDbName }],
        } = await db.branch.query<{ name: string }>(
          sql`select current_database() as name`,
        );
        await db.branch.query(
          "CREATE PUBLICATION sub_with_slot_pub FOR ALL TABLES",
        );
        await db.branch.query(
          sql`select pg_create_logical_replication_slot('sub_existing_slot', 'pgoutput')`,
        );
        await db.branch.query(dedent`
          CREATE SUBSCRIPTION sub_with_slot
            CONNECTION 'dbname=${branchDbName}'
            PUBLICATION sub_with_slot_pub
            WITH (
              connect = false,
              create_slot = false,
              enabled = false,
              slot_name = 'sub_existing_slot'
            );
        `);

        const result = await createPlan(db.main, db.branch);
        expect(result).not.toBeNull();
        if (!result) throw new Error("expected result");

        expect(result.plan.units).toHaveLength(1);
        const [unit] = result.plan.units;
        expect(unit.transactionMode).toBe("transactional");
        const createStatement = unit.statements.find((statement) =>
          statement.startsWith("CREATE SUBSCRIPTION sub_with_slot"),
        );
        expect(createStatement).toBeDefined();
        if (!createStatement) throw new Error("expected create statement");
        expect(createStatement).toContain("create_slot = false");
        // connect must stay at its default (true) so the existing slot is
        // looked up on the publisher rather than skipped.
        expect(createStatement).not.toContain("connect = false");
        expect(createStatement).toContain("slot_name = 'sub_existing_slot'");

        const executable = createStatement.replace(
          /CONNECTION '[^']*'/,
          `CONNECTION 'dbname=${branchDbName}'`,
        );
        const client = await db.main.connect();
        try {
          await client.query("BEGIN");
          await client.query(executable);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          throw error;
        } finally {
          client.release();
        }

        const { rows: subscriptions } = await db.main.query(
          sql`
            select 1
            from pg_subscription s
            join pg_database d on d.oid = s.subdbid
            where s.subname = 'sub_with_slot'
              and d.datname = current_database()
          `,
        );
        expect(subscriptions).toHaveLength(1);
      }),
    );

    test(
      "drops a subscription with an associated replication slot outside a transaction block",
      withDbIsolated(pgVersion, async (db) => {
        // DROP SUBSCRIPTION must connect to the publisher to drop the remote
        // slot, and PostgreSQL rejects it inside a transaction block (25001)
        // whenever a slot is associated. The extra table guarantees the plan
        // has more than one statement, so a naive single-script/explicit
        // transaction apply would fail.
        const {
          rows: [{ name: mainDbName }],
        } = await db.main.query<{ name: string }>(
          sql`select current_database() as name`,
        );
        await db.main.query(
          sql`select pg_create_logical_replication_slot('sub_drop_slot', 'pgoutput')`,
        );
        await db.main.query(dedent`
          CREATE SUBSCRIPTION sub_drop_with_slot
            CONNECTION 'dbname=${mainDbName}'
            PUBLICATION sub_drop_pub
            WITH (
              connect = false,
              create_slot = false,
              enabled = false,
              slot_name = 'sub_drop_slot'
            );
        `);
        await db.main.query("CREATE TABLE public.drop_me (id integer)");

        const result = await createPlan(db.main, db.branch);
        expect(result).not.toBeNull();
        if (!result) throw new Error("expected result");

        const dropUnit = result.plan.units.find((unit) =>
          unit.statements.some((statement) =>
            statement.startsWith("DROP SUBSCRIPTION sub_drop_with_slot"),
          ),
        );
        expect(dropUnit).toBeDefined();
        expect(dropUnit?.transactionMode).toBe("none");
        expect(dropUnit?.statements).toHaveLength(1);

        const applied = await applyPlan(result.plan, db.main, db.branch);
        expect(applied.status).toBe("applied");
        if (applied.status !== "applied") throw new Error("expected applied");
        expect(applied.warnings).toBeUndefined();

        const after = await createPlan(db.main, db.branch);
        expect(after).toBeNull();

        // DROP SUBSCRIPTION also dropped the slot it connected for.
        const { rows: slots } = await db.main.query(
          sql`select 1 from pg_replication_slots where slot_name = 'sub_drop_slot'`,
        );
        expect(slots).toHaveLength(0);
      }),
    );
  });
}
