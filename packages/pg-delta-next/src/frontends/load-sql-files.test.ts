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
  findSessionSettingStatements,
  findTransactionControl,
} from "./load-sql-files.ts";

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
