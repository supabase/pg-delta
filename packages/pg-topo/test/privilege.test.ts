import { describe, expect, test } from "bun:test";
import { analyzeAndSort } from "../src/analyze-and-sort";

describe("StatementNode.privilege", () => {
  test("hosted dump REVOKE ALL then GRANT SELECT on public for postgres → anon", async () => {
    const result = await analyzeAndSort([
      `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT ON TABLES TO anon;`,
    ]);

    expect(result.ordered).toHaveLength(2);
    expect(result.ordered.map((node) => node.statementClass)).toEqual([
      "ALTER_DEFAULT_PRIVILEGES",
      "ALTER_DEFAULT_PRIVILEGES",
    ]);

    const revoke = result.ordered[0]?.privilege;
    const grant = result.ordered[1]?.privilege;
    expect(revoke).toEqual({
      kind: "alter_default_privileges",
      isGrant: false,
      grantors: ["postgres"],
      schemas: ["public"],
      grantees: ["anon"],
      objectKind: "tables",
      privileges: "all",
    });
    expect(grant).toEqual({
      kind: "alter_default_privileges",
      isGrant: true,
      grantors: ["postgres"],
      schemas: ["public"],
      grantees: ["anon"],
      objectKind: "tables",
      privileges: ["select"],
    });
  });

  test("REVOKE-only default ACL fills isGrant false with the same roles and schema", async () => {
    const result = await analyzeAndSort([
      `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE SELECT ON TABLES FROM anon;`,
    ]);

    expect(result.ordered).toHaveLength(1);
    expect(result.ordered[0]?.statementClass).toBe("ALTER_DEFAULT_PRIVILEGES");
    expect(result.ordered[0]?.privilege).toEqual({
      kind: "alter_default_privileges",
      isGrant: false,
      grantors: ["postgres"],
      schemas: ["public"],
      grantees: ["anon"],
      objectKind: "tables",
      privileges: ["select"],
    });
  });

  test("GrantStmt GRANT and REVOKE on a table fill kind and grantees", async () => {
    const result = await analyzeAndSort([
      `GRANT SELECT ON TABLE public.t TO anon;
REVOKE UPDATE ON TABLE public.t FROM app_reader;`,
    ]);

    expect(result.ordered).toHaveLength(2);
    expect(result.ordered[0]?.privilege).toEqual({
      kind: "grant",
      isGrant: true,
      grantors: [],
      schemas: [],
      grantees: ["anon"],
      objectKind: "tables",
      privileges: ["select"],
    });
    expect(result.ordered[1]?.privilege).toEqual({
      kind: "revoke",
      isGrant: false,
      grantors: [],
      schemas: [],
      grantees: ["app_reader"],
      objectKind: "tables",
      privileges: ["update"],
    });
  });

  test("quoted identifiers and PUBLIC grantee match role ObjectRef names", async () => {
    const quoted = await analyzeAndSort([
      `ALTER DEFAULT PRIVILEGES FOR ROLE "Postgres" IN SCHEMA "Public"
  GRANT SELECT ON TABLES TO "Anon";`,
    ]);
    expect(quoted.ordered[0]?.privilege).toEqual({
      kind: "alter_default_privileges",
      isGrant: true,
      grantors: ["Postgres"],
      schemas: ["Public"],
      grantees: ["Anon"],
      objectKind: "tables",
      privileges: ["select"],
    });

    const pub = await analyzeAndSort([
      `GRANT SELECT ON TABLE public."Users" TO PUBLIC;`,
    ]);
    expect(pub.ordered[0]?.privilege?.grantees).toEqual(["public"]);
    const publicRequire = pub.ordered[0]?.requires.find(
      (ref) => ref.kind === "role" && ref.name === "public",
    );
    expect(publicRequire?.name).toBe(pub.ordered[0]?.privilege?.grantees[0]);
  });

  test("missing IN SCHEMA yields an empty schemas list", async () => {
    const result = await analyzeAndSort([
      `ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE ALL ON TABLES FROM anon;`,
    ]);

    expect(result.ordered[0]?.privilege).toEqual({
      kind: "alter_default_privileges",
      isGrant: false,
      grantors: ["postgres"],
      schemas: [],
      grantees: ["anon"],
      objectKind: "tables",
      privileges: "all",
    });
  });

  test("file-header comment does not prevent AST privilege extraction", async () => {
    const result = await analyzeAndSort([
      `-- write revoke SQL
alter default privileges for role postgres in schema public
  revoke select on tables from anon;`,
    ]);

    expect(result.ordered).toHaveLength(1);
    expect(result.ordered[0]?.statementClass).toBe("ALTER_DEFAULT_PRIVILEGES");
    expect(result.ordered[0]?.sql.toLowerCase().startsWith("-- write")).toBe(
      false,
    );
    expect(result.ordered[0]?.privilege).toEqual({
      kind: "alter_default_privileges",
      isGrant: false,
      grantors: ["postgres"],
      schemas: ["public"],
      grantees: ["anon"],
      objectKind: "tables",
      privileges: ["select"],
    });
  });

  test("does not attach privilege to non-ACL statements", async () => {
    const result = await analyzeAndSort(["create table public.t(id int);"]);
    expect(result.ordered[0]?.privilege).toBeUndefined();
  });

  test("keeps graph requires separate from the privilege payload", async () => {
    const result = await analyzeAndSort([
      `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT ON TABLES TO anon;`,
    ]);
    const node = result.ordered[0];
    expect(node?.privilege?.grantors).toEqual(["postgres"]);
    expect(
      node?.requires.some(
        (ref) => ref.kind === "role" && ref.name === "postgres",
      ),
    ).toBe(true);
    expect(
      node?.requires.some(
        (ref) => ref.kind === "schema" && ref.name === "public",
      ),
    ).toBe(true);
    expect(node?.provides).toEqual([]);
  });
});
