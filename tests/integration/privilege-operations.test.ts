/**
 * Integration tests for privileges: object, column, default privileges, and memberships.
 */

import dedent from "dedent";
import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTestIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTestIsolated(pgVersion);

  describe.concurrent(`privilege operations (pg${pgVersion})`, () => {
    test("object privileges on view (grant)", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE VIEW test_schema.v AS SELECT 1 AS a;
          CREATE ROLE r_view;
        `,
        testSql: dedent`
          GRANT SELECT ON test_schema.v TO r_view;
        `,
      });
    });

    test("domain privileges (grant)", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE DOMAIN test_schema.dom AS int;
          CREATE ROLE r_dom;
        `,
        testSql: dedent`
          GRANT USAGE ON DOMAIN test_schema.dom TO r_dom;
        `,
      });
    });

    // GRANT tests
    test("object privileges on table (grant)", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.tg(a int);
          CREATE ROLE r_obj_g;
        `,
        testSql: dedent`
          GRANT UPDATE ON TABLE test_schema.tg TO r_obj_g;
        `,
      });
    });

    test("object privileges grant option addition (GRANT ... WITH GRANT OPTION)", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.tg2(a int);
          CREATE ROLE r_obj_g2;
          GRANT SELECT ON TABLE test_schema.tg2 TO r_obj_g2;
        `,
        testSql: dedent`
          GRANT SELECT ON TABLE test_schema.tg2 TO r_obj_g2 WITH GRANT OPTION;
        `,
      });
    });

    test("object privileges on table (revoke)", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.t(a int);
          CREATE ROLE r_obj;
          GRANT SELECT, INSERT ON TABLE test_schema.t TO r_obj;
        `,
        testSql: dedent`
          REVOKE INSERT ON TABLE test_schema.t FROM r_obj;
        `,
      });
    });

    test("object privileges grant option downgrade (REVOKE GRANT OPTION FOR)", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.tgo(a int);
          CREATE ROLE r_obj_go;
          GRANT SELECT, UPDATE ON TABLE test_schema.tgo TO r_obj_go WITH GRANT OPTION;
        `,
        testSql: dedent`
          REVOKE GRANT OPTION FOR UPDATE ON TABLE test_schema.tgo FROM r_obj_go;
        `,
      });
    });

    test("column privileges on table (grant)", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.tcg_g(a int, b int);
          CREATE ROLE r_col_g;
        `,
        testSql: dedent`
          GRANT UPDATE (b) ON TABLE test_schema.tcg_g TO r_col_g;
        `,
      });
    });

    test("column privileges grant option addition", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.tcg_go(a int, b int);
          CREATE ROLE r_col_go2;
          GRANT UPDATE (a, b) ON TABLE test_schema.tcg_go TO r_col_go2;
        `,
        testSql: dedent`
          GRANT UPDATE (b) ON TABLE test_schema.tcg_go TO r_col_go2 WITH GRANT OPTION;
        `,
      });
    });

    test("column privileges on table (revoke)", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.tc(a int, b int, c int);
          CREATE ROLE r_col;
          GRANT SELECT (a, b), UPDATE (b) ON TABLE test_schema.tc TO r_col;
        `,
        testSql: dedent`
          REVOKE UPDATE (b) ON TABLE test_schema.tc FROM r_col;
        `,
      });
    });

    test("column privileges grant option downgrade", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.tcg(a int, b int);
          CREATE ROLE r_col_go;
          GRANT UPDATE (a, b) ON TABLE test_schema.tcg TO r_col_go WITH GRANT OPTION;
        `,
        testSql: dedent`
          REVOKE GRANT OPTION FOR UPDATE (b) ON TABLE test_schema.tcg FROM r_col_go;
        `,
      });
    });

    test("default privileges grant", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE ROLE r_def_g;
          CREATE ROLE owner_role_g;
        `,
        testSql: dedent`
          ALTER DEFAULT PRIVILEGES FOR ROLE owner_role_g IN SCHEMA test_schema GRANT SELECT ON TABLES TO r_def_g;
        `,
      });
    });

    test("default privileges grant option addition", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE ROLE r_def_go_add;
          CREATE ROLE owner_role_go_add;
          ALTER DEFAULT PRIVILEGES FOR ROLE owner_role_go_add IN SCHEMA test_schema GRANT SELECT ON TABLES TO r_def_go_add;
        `,
        testSql: dedent`
          ALTER DEFAULT PRIVILEGES FOR ROLE owner_role_go_add IN SCHEMA test_schema GRANT SELECT ON TABLES TO r_def_go_add WITH GRANT OPTION;
        `,
      });
    });

    test("default privileges in schema (revoke)", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE ROLE r_def;
          CREATE ROLE owner_role;
          -- Create an object owned by owner_role to ensure FOR ROLE is meaningful
          CREATE TABLE test_schema.bootstrap(id int);
          ALTER TABLE test_schema.bootstrap OWNER TO owner_role;
          ALTER DEFAULT PRIVILEGES FOR ROLE owner_role IN SCHEMA test_schema GRANT SELECT, INSERT ON TABLES TO r_def;
        `,
        testSql: dedent`
          ALTER DEFAULT PRIVILEGES FOR ROLE owner_role IN SCHEMA test_schema REVOKE INSERT ON TABLES FROM r_def;
        `,
      });
    });

    test("default privileges grant option downgrade", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA test_schema;
          CREATE ROLE r_def_go;
          CREATE ROLE owner_role_go;
          ALTER DEFAULT PRIVILEGES FOR ROLE owner_role_go IN SCHEMA test_schema GRANT SELECT, INSERT ON TABLES TO r_def_go WITH GRANT OPTION;
        `,
        testSql: dedent`
          ALTER DEFAULT PRIVILEGES FOR ROLE owner_role_go IN SCHEMA test_schema REVOKE GRANT OPTION FOR INSERT ON TABLES FROM r_def_go;
        `,
      });
    });

    test("role membership grant with admin option", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE ROLE parent_role_g;
          CREATE ROLE child_role_g;
        `,
        testSql: dedent`
          GRANT parent_role_g TO child_role_g WITH ADMIN OPTION;
        `,
      });
    });

    test("role membership options update (admin off)", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE ROLE parent_role;
          CREATE ROLE child_role;
          GRANT parent_role TO child_role WITH ADMIN OPTION;
        `,
        testSql: dedent`
          REVOKE ADMIN OPTION FOR parent_role FROM child_role;
        `,
      });
    });

    // Dependency ordering tests mixing object creation with grants/revokes
    test("object privileges with object creation (ordering)", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        testSql: dedent`
          CREATE ROLE r_dep_g;
          CREATE SCHEMA dep_s;
          CREATE TABLE dep_s.dep_t(a int);
          GRANT SELECT, UPDATE ON TABLE dep_s.dep_t TO r_dep_g;
        `,
      });
    });

    test("column privileges with object creation (ordering)", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        testSql: dedent`
          CREATE ROLE r_dep_col;
          CREATE SCHEMA dep_s2;
          CREATE TABLE dep_s2.dep_tc(a int, b int);
          GRANT UPDATE (b) ON TABLE dep_s2.dep_tc TO r_dep_col;
        `,
      });
    });

    test("default privileges with roles and schema creation (ordering)", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        testSql: dedent`
          CREATE ROLE owner_dep;
          CREATE ROLE grantee_dep;
          CREATE SCHEMA dep_s3;
          ALTER DEFAULT PRIVILEGES FOR ROLE owner_dep IN SCHEMA dep_s3 GRANT SELECT ON TABLES TO grantee_dep;
        `,
      });
    });

    test("role membership after role creation (ordering)", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        testSql: dedent`
          CREATE ROLE parent_dep;
          CREATE ROLE child_dep;
          GRANT parent_dep TO child_dep WITH ADMIN OPTION;
        `,
      });
    });

    test("mixed: create + grant, and drop unrelated object", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: dedent`
          CREATE SCHEMA drop_s;
          CREATE TABLE drop_s.old_t(a int);
        `,
        testSql: dedent`
          CREATE ROLE r_mix;
          CREATE SCHEMA dep_mix;
          CREATE TABLE dep_mix.t(a int);
          GRANT SELECT ON TABLE dep_mix.t TO r_mix;
          DROP TABLE drop_s.old_t;
        `,
      });
    });
  });
}
