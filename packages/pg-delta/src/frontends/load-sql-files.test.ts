/**
 * Unit tests for the SQL-file transaction-control scanner (review finding 6).
 *
 * The loader wraps each file in an explicit BEGIN/COMMIT for atomic retry. A
 * file containing its OWN transaction-control statement (COMMIT, BEGIN, …)
 * would break that guarantee — committing partial DDL before a later statement
 * fails. `findTransactionControl` rejects such files, but must NOT false-fire
 * on the same keywords appearing in comments, string literals, dollar-quoted
 * function bodies, or PG14+ `BEGIN ATOMIC` bodies.
 *
 * No Docker required (pure string scan).
 */
import { describe, expect, test } from "bun:test";
import {
  findClusterDdlStatements,
  findDefaultPrivilegeStatements,
  findSessionSettingStatements,
  findTransactionControl,
  resolveReorderOnFailure,
  stripClusterDdl,
} from "./load-sql-files.ts";

describe("cluster-DDL scanner (database scope guard)", () => {
  test("detects role lifecycle, membership, and role metadata", () => {
    expect(findClusterDdlStatements(`CREATE ROLE app NOLOGIN;`)).toEqual([
      "CREATE ROLE",
    ]);
    expect(
      findClusterDdlStatements(`ALTER ROLE app SET search_path=x;`),
    ).toEqual(["ALTER ROLE"]);
    expect(findClusterDdlStatements(`DROP USER app;`)).toEqual(["DROP ROLE"]);
    expect(findClusterDdlStatements(`GRANT app TO reader;`)).toEqual([
      "GRANT (role membership)",
    ]);
    expect(findClusterDdlStatements(`COMMENT ON ROLE app IS 'x';`)).toEqual([
      "COMMENT ON ROLE",
    ]);
  });

  test("does NOT flag USER MAPPING statements (database-local FDW objects)", () => {
    // `CREATE|ALTER|DROP USER MAPPING` is a database-local FDW object emitted by
    // pg-delta's own foreign-data exports; the role-lifecycle rules must not
    // misclassify it as cluster-global role DDL (or database-scope apply would
    // reject / --skip-cluster-ddl would strip user mappings from our exports).
    expect(
      findClusterDdlStatements(
        `CREATE USER MAPPING FOR postgres SERVER s OPTIONS (user 'u');`,
      ),
    ).toEqual([]);
    expect(
      findClusterDdlStatements(
        `ALTER USER MAPPING FOR postgres SERVER s OPTIONS (SET user 'x');`,
      ),
    ).toEqual([]);
    expect(
      findClusterDdlStatements(`DROP USER MAPPING IF EXISTS FOR u SERVER s;`),
    ).toEqual([]);
    // stripClusterDdl keeps them intact (not skipped as cluster DDL)
    const { kept, skipped } = stripClusterDdl(
      `CREATE USER MAPPING FOR postgres SERVER s OPTIONS (user 'u');`,
    );
    expect(skipped).toEqual([]);
    expect(kept).toContain("USER MAPPING");
    // non-regression: a genuine role (CREATE USER) is still detected
    expect(findClusterDdlStatements(`CREATE USER app LOGIN;`)).toEqual([
      "CREATE ROLE",
    ]);
  });

  test("does NOT flag database-local privilege grants (they have ON)", () => {
    expect(findClusterDdlStatements(`GRANT SELECT ON t TO reader;`)).toEqual(
      [],
    );
    expect(
      findClusterDdlStatements(`REVOKE ALL ON SCHEMA app FROM PUBLIC;`),
    ).toEqual([]);
    expect(findClusterDdlStatements(`CREATE TABLE t (id int);`)).toEqual([]);
  });

  test("ignores keywords inside comments/strings", () => {
    expect(
      findClusterDdlStatements(`-- CREATE ROLE app\nCREATE TABLE t (id int);`),
    ).toEqual([]);
  });

  test("stripClusterDdl removes role DDL, keeps the rest (block-aware)", () => {
    const sql = `CREATE ROLE app NOLOGIN;
CREATE SCHEMA s;
CREATE FUNCTION s.f() RETURNS int LANGUAGE sql AS $$ SELECT 1; $$;
GRANT app TO reader;`;
    const { kept, skipped } = stripClusterDdl(sql);
    expect(skipped).toEqual(["CREATE ROLE app NOLOGIN", "GRANT app TO reader"]);
    expect(kept).toContain("CREATE SCHEMA s");
    expect(kept).toContain("SELECT 1"); // function body not mis-split
    expect(kept).not.toContain("CREATE ROLE");
    expect(kept).not.toMatch(/GRANT app TO/);
  });
});

describe("findTransactionControl — rejects top-level transaction control", () => {
  test("a bare COMMIT between statements is detected", () => {
    const found = findTransactionControl(
      `CREATE TABLE t (id int); COMMIT; CREATE TABLE u (id int);`,
    );
    expect(found.join(" ")).toContain("COMMIT");
  });

  test("BEGIN / ROLLBACK / SAVEPOINT / RELEASE are detected", () => {
    expect(findTransactionControl(`BEGIN;`).join(" ")).toContain("BEGIN");
    expect(findTransactionControl(`ROLLBACK;`).join(" ")).toContain("ROLLBACK");
    expect(findTransactionControl(`SAVEPOINT sp;`).join(" ")).toContain(
      "SAVEPOINT",
    );
    expect(findTransactionControl(`RELEASE SAVEPOINT sp;`).join(" ")).toContain(
      "RELEASE",
    );
    expect(findTransactionControl(`START TRANSACTION;`).join(" ")).toContain(
      "START TRANSACTION",
    );
    expect(
      findTransactionControl(`PREPARE TRANSACTION 'gid';`).join(" "),
    ).toContain("PREPARE TRANSACTION");
  });
});

describe("findTransactionControl — no false positives", () => {
  test("clean DDL is accepted", () => {
    expect(
      findTransactionControl(`CREATE SCHEMA s; CREATE TABLE s.t (id int);`),
    ).toEqual([]);
  });

  test("the keyword inside a single-quoted literal is ignored", () => {
    expect(
      findTransactionControl(
        `CREATE FUNCTION f() RETURNS text LANGUAGE sql AS 'SELECT ''COMMIT''';`,
      ),
    ).toEqual([]);
  });

  test("the keyword inside a line comment is ignored", () => {
    expect(
      findTransactionControl(`-- COMMIT later\nCREATE TABLE t (id int);`),
    ).toEqual([]);
  });

  test("transaction control inside a dollar-quoted body is ignored", () => {
    expect(
      findTransactionControl(
        `CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN COMMIT; END; $$;`,
      ),
    ).toEqual([]);
  });

  test("a PG14+ BEGIN ATOMIC function body is accepted", () => {
    expect(
      findTransactionControl(
        `CREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; END;`,
      ),
    ).toEqual([]);
  });
});

describe("findSessionSettingStatements — detects search_path / role barriers", () => {
  test("SET search_path is detected (with SESSION / LOCAL variants)", () => {
    expect(findSessionSettingStatements(`SET search_path TO app;`)).toContain(
      "SET search_path",
    );
    expect(
      findSessionSettingStatements(`SET SESSION search_path TO app, public;`),
    ).toContain("SET search_path");
    expect(
      findSessionSettingStatements(`SET LOCAL search_path = app;`),
    ).toContain("SET search_path");
  });

  test("SET SCHEMA (a search_path alias) is detected", () => {
    expect(
      findSessionSettingStatements(`SET SCHEMA 'app';`).length,
    ).toBeGreaterThan(0);
    expect(
      findSessionSettingStatements(`SET LOCAL SCHEMA 'app';`).length,
    ).toBeGreaterThan(0);
  });

  test("SET ROLE / SET SESSION AUTHORIZATION are detected", () => {
    expect(findSessionSettingStatements(`SET ROLE app_owner;`)).toContain(
      "SET ROLE",
    );
    expect(
      findSessionSettingStatements(`SET SESSION AUTHORIZATION app_owner;`),
    ).toContain("SET SESSION AUTHORIZATION");
  });

  test("RESET of role / search_path / ALL is detected", () => {
    expect(findSessionSettingStatements(`RESET ROLE;`).length).toBeGreaterThan(
      0,
    );
    expect(
      findSessionSettingStatements(`RESET search_path;`).length,
    ).toBeGreaterThan(0);
    expect(findSessionSettingStatements(`RESET ALL;`).length).toBeGreaterThan(
      0,
    );
  });

  test("statements mixed with other DDL in one file are detected", () => {
    expect(
      findSessionSettingStatements(
        `CREATE SCHEMA app; SET search_path TO app; CREATE TABLE t (id int);`,
      ),
    ).toContain("SET search_path");
  });

  test("no false positives on unrelated SET or on quoted/commented keywords", () => {
    // an unrelated GUC does not change object resolution / ownership
    expect(
      findSessionSettingStatements(`SET statement_timeout = '5s';`),
    ).toEqual([]);
    expect(
      findSessionSettingStatements(`SET LOCAL statement_timeout = 0;`),
    ).toContain("SET LOCAL");
    // keyword in a literal or comment is ignored
    expect(
      findSessionSettingStatements(
        `CREATE FUNCTION f() RETURNS text LANGUAGE sql AS 'SELECT ''SET search_path''';`,
      ),
    ).toEqual([]);
    expect(
      findSessionSettingStatements(`-- SET ROLE app\nCREATE TABLE t (id int);`),
    ).toEqual([]);
  });
});

describe("findDefaultPrivilegeStatements — reorder barrier", () => {
  test("ALTER DEFAULT PRIVILEGES is detected", () => {
    expect(
      findDefaultPrivilegeStatements(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO anon;`,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      findDefaultPrivilegeStatements(
        `ALTER DEFAULT PRIVILEGES FOR ROLE alice GRANT EXECUTE ON FUNCTIONS TO PUBLIC;`,
      ).length,
    ).toBeGreaterThan(0);
  });

  test("mixed with other DDL in one file is detected", () => {
    expect(
      findDefaultPrivilegeStatements(
        `CREATE SCHEMA app; ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO anon; CREATE TABLE app.t (id int);`,
      ).length,
    ).toBeGreaterThan(0);
  });

  test("no false positives on plain ALTER / GRANT or quoted keywords", () => {
    expect(
      findDefaultPrivilegeStatements(`ALTER TABLE t ADD COLUMN c int;`),
    ).toEqual([]);
    expect(
      findDefaultPrivilegeStatements(`GRANT SELECT ON t TO anon;`),
    ).toEqual([]);
    expect(
      findDefaultPrivilegeStatements(
        `CREATE FUNCTION f() RETURNS text LANGUAGE sql AS 'SELECT ''ALTER DEFAULT PRIVILEGES''';`,
      ),
    ).toEqual([]);
  });
});

describe("resolveReorderOnFailure", () => {
  test("reorderOnFailure wins when both aliases are set", () => {
    expect(
      resolveReorderOnFailure({ reorder: false, reorderOnFailure: true }),
    ).toBe(true);
    expect(
      resolveReorderOnFailure({ reorder: true, reorderOnFailure: false }),
    ).toBe(false);
  });

  test("either alias alone opts out, default is true", () => {
    expect(resolveReorderOnFailure({ reorder: false })).toBe(false);
    expect(resolveReorderOnFailure({ reorderOnFailure: false })).toBe(false);
    expect(resolveReorderOnFailure({})).toBe(true);
  });
});
