/**
 * Stage-2 extractor fixture ring: known DDL in, specific facts out
 * (target-architecture §4.3 "independent extractor ring").
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { diff } from "../src/core/diff.ts";
import { encodeId } from "../src/core/stable-id.ts";
import {
  deserializeSnapshot,
  serializeSnapshot,
} from "../src/core/snapshot.ts";
import { extract, type ExtractResult } from "../src/extract/extract.ts";
import { createTestDb, type TestDb } from "./containers.ts";

const FIXTURE_DDL = /* sql */ `
  CREATE SCHEMA app;
  CREATE SEQUENCE app.order_seq START 100 INCREMENT 5;
  CREATE TABLE app.users (
    id integer GENERATED ALWAYS AS IDENTITY,
    email text NOT NULL,
    score numeric(10,2) DEFAULT 0.0,
    CONSTRAINT users_pkey PRIMARY KEY (id),
    CONSTRAINT score_positive CHECK (score >= 0)
  );
  CREATE TABLE app.orders (
    id bigint DEFAULT nextval('app.order_seq') PRIMARY KEY,
    user_id integer NOT NULL,
    CONSTRAINT orders_user_fk FOREIGN KEY (user_id) REFERENCES app.users (id)
  );
  CREATE INDEX orders_user_idx ON app.orders (user_id);
  CREATE VIEW app.user_emails AS SELECT id, email FROM app.users;
  CREATE FUNCTION app.add(a integer, b integer) RETURNS integer
    LANGUAGE sql IMMUTABLE AS 'SELECT a + b';
  COMMENT ON TABLE app.users IS 'user accounts';
  COMMENT ON COLUMN app.users.email IS 'login email';
  ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
  CREATE POLICY users_self ON app.users FOR SELECT USING (true);
  CREATE ROLE app_reader_xyz NOLOGIN;
  GRANT SELECT ON app.users TO app_reader_xyz;
  CREATE TYPE app.addr AS (street text, city varchar(90));
`;

let db: TestDb;
let result: ExtractResult;
let pgMajor: number;

beforeAll(async () => {
  db = await createTestDb("extract");
  await db.pool.query(FIXTURE_DDL);
  pgMajor = await db.cluster.pgMajor();
  // publication column lists are PG15+; on PG14 publish the whole table so the
  // rest of the fixture still exercises publication facts.
  await db.pool.query(
    pgMajor >= 15
      ? `CREATE PUBLICATION app_pub FOR TABLE app.users (id, email)`
      : `CREATE PUBLICATION app_pub FOR TABLE app.users`,
  );
  result = await extract(db.pool);
}, 120_000);

afterAll(async () => {
  await db.pool.query(`DROP ROLE IF EXISTS app_reader_xyz`).catch(() => {});
  await db.drop();
});

describe("extract: fixture ring", () => {
  const fb = () => result.factBase;

  test("schema, table, and column facts exist with normalized payloads", () => {
    // ownership is an `owner` EDGE (object --owner--> role), not a payload field
    // (managed-view move 2); the schema "app" is owned by the connection role.
    expect(fb().has({ kind: "schema", name: "app" })).toBe(true);
    const schemaOwnerEdge = fb().edges.find(
      (e) => e.kind === "owner" && encodeId(e.from) === "schema:app",
    );
    expect(schemaOwnerEdge?.to).toEqual({ kind: "role", name: "test" });
    const table = fb().get({ kind: "table", schema: "app", name: "users" });
    expect(table?.payload).toMatchObject({
      persistence: "p",
      rowSecurity: true,
    });
    const email = fb().get({
      kind: "column",
      schema: "app",
      table: "users",
      name: "email",
    });
    expect(email?.payload).toMatchObject({
      type: "text",
      notNull: true,
      identity: null,
    });
    const id = fb().get({
      kind: "column",
      schema: "app",
      table: "users",
      name: "id",
    });
    expect(id?.payload).toMatchObject({
      type: "integer",
      identity: { generation: "a" },
    });
    const score = fb().get({
      kind: "column",
      schema: "app",
      table: "users",
      name: "score",
    });
    expect(score?.payload).toMatchObject({ type: "numeric(10,2)" });
  });

  test("defaults are their own facts (pg_attrdef model)", () => {
    const def = fb().get({
      kind: "default",
      schema: "app",
      table: "users",
      name: "score",
    });
    expect(def?.payload["expr"]).toBe("0.0");
    const orderDefault = fb().get({
      kind: "default",
      schema: "app",
      table: "orders",
      name: "id",
    });
    expect(orderDefault?.payload["expr"] as string).toContain("nextval");
  });

  test("constraints carry canonical pg_get_constraintdef", () => {
    const pk = fb().get({
      kind: "constraint",
      schema: "app",
      table: "users",
      name: "users_pkey",
    });
    expect(pk?.payload["def"]).toBe("PRIMARY KEY (id)");
    const fk = fb().get({
      kind: "constraint",
      schema: "app",
      table: "orders",
      name: "orders_user_fk",
    });
    expect(fk?.payload["def"]).toBe(
      "FOREIGN KEY (user_id) REFERENCES app.users(id)",
    );
    expect(fk?.payload["type"]).toBe("f");
  });

  test("non-constraint index extracted with canonical def; pkey index is not", () => {
    const idx = fb().get({
      kind: "index",
      schema: "app",
      name: "orders_user_idx",
    });
    expect(idx?.payload["def"] as string).toContain(
      "CREATE INDEX orders_user_idx",
    );
    expect(fb().has({ kind: "index", schema: "app", name: "users_pkey" })).toBe(
      false,
    );
  });

  test("identity-column backing sequence is excluded; user sequence is present", () => {
    const seq = fb().get({
      kind: "sequence",
      schema: "app",
      name: "order_seq",
    });
    expect(seq?.payload).toMatchObject({ start: "100", increment: "5" });
    const internal = fb()
      .facts()
      .filter(
        (f) => f.id.kind === "sequence" && encodeId(f.id).includes("users_id"),
      );
    expect(internal).toHaveLength(0);
  });

  test("view, function, policy, trigger-less fixture facts", () => {
    const view = fb().get({ kind: "view", schema: "app", name: "user_emails" });
    expect(view?.payload["def"] as string).toContain("FROM app.users");
    const fn = fb().get({
      kind: "function",
      schema: "app",
      name: "add",
      args: ["integer", "integer"],
    });
    expect(fn?.payload["def"] as string).toContain("SELECT a + b");
    const policy = fb().get({
      kind: "policy",
      schema: "app",
      table: "users",
      name: "users_self",
    });
    expect(policy?.payload).toMatchObject({ cmd: "r", usingExpr: "true" });
  });

  test("composite-type attributes are their own facts (granularity is one)", () => {
    const type = fb().get({ kind: "type", schema: "app", name: "addr" });
    expect(type?.payload).toMatchObject({ variant: "composite" });
    // the attributes are NOT in the type payload — they are sub-facts
    expect(type?.payload["attributes"]).toBeUndefined();
    const street = fb().get({
      kind: "typeAttribute",
      schema: "app",
      type: "addr",
      name: "street",
    });
    expect(street?.payload).toMatchObject({ type: "text" });
    expect(street?.parent).toEqual({
      kind: "type",
      schema: "app",
      name: "addr",
    });
    const city = fb().get({
      kind: "typeAttribute",
      schema: "app",
      type: "addr",
      name: "city",
    });
    expect(city?.payload["type"]).toBe("character varying(90)");
  });

  test("published tables are their own facts, parented to the publication", () => {
    const pub = fb().get({ kind: "publication", name: "app_pub" });
    expect(pub?.payload["tables"]).toBeUndefined();
    const rel = fb().get({
      kind: "publicationRel",
      publication: "app_pub",
      schema: "app",
      table: "users",
    });
    expect(rel?.parent).toEqual({ kind: "publication", name: "app_pub" });
    // column lists are PG15+; on PG14 the publication has no column list
    expect(rel?.payload["columns"]).toEqual(
      pgMajor >= 15 ? ["email", "id"] : null,
    );
  });

  test("comments and ACLs are satellite facts parented to their target", () => {
    const tableId = { kind: "table", schema: "app", name: "users" } as const;
    const comment = fb().get({ kind: "comment", target: tableId });
    expect(comment?.payload["text"]).toBe("user accounts");
    const colComment = fb().get({
      kind: "comment",
      target: { kind: "column", schema: "app", table: "users", name: "email" },
    });
    expect(colComment?.payload["text"]).toBe("login email");
    const acl = fb().get({
      kind: "acl",
      target: tableId,
      grantee: "app_reader_xyz",
    });
    expect(acl?.payload["privileges"]).toEqual(["SELECT"]);
  });

  test("pg_depend edges arrive at column grain (one granularity, §3.1)", () => {
    const edgeSet = new Set(
      fb().edges.map((e) => `${encodeId(e.from)}->${encodeId(e.to)}`),
    );
    // view references are per-column in pg_depend — exactly our fact grain
    expect(edgeSet.has("view:app.user_emails->column:app.users.email")).toBe(
      true,
    );
    expect(edgeSet.has("default:app.orders.id->sequence:app.order_seq")).toBe(
      true,
    );
    // FK constraints reference the target table's columns
    expect(
      edgeSet.has("constraint:app.orders.orders_user_fk->column:app.users.id"),
    ).toBe(true);
  });

  test("extraction is deterministic: re-extract is hash-identical", async () => {
    const again = await extract(db.pool);
    expect(again.factBase.rootHash).toBe(result.factBase.rootHash);
  }, 30_000);

  test("snapshot round-trips a real extraction hash-identically", () => {
    const json = serializeSnapshot(result.factBase, {
      pgVersion: result.pgVersion,
    });
    const restored = deserializeSnapshot(json);
    expect(restored.factBase.rootHash).toBe(result.factBase.rootHash);
    expect(diff(result.factBase, restored.factBase)).toEqual([]);
  });

  test("clone fidelity: TEMPLATE clone extracts hash-identical", async () => {
    const clone = await db.clone();
    try {
      const cloned = await extract(clone.pool);
      expect(cloned.factBase.rootHash).toBe(result.factBase.rootHash);
      expect(diff(result.factBase, cloned.factBase)).toEqual([]);
    } finally {
      await clone.drop();
    }
  }, 60_000);
});
