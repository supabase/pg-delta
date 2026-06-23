/**
 * Characterization oracle for the `pg_depend` dependency resolver
 * (`extract.ts` `${resolver}` + `dependRows`). Milestone A rewrites that
 * correlated CASE subquery into a set-based form for performance; the rewrite
 * MUST produce a byte-identical edge set, because edges drive sort/plan
 * ordering. This test pins the CURRENT edge set so any drift fails fast.
 *
 * The fixture exercises the resolver's non-extension branches (extension-member
 * branches are pinned separately by tests/extension-member-*.test.ts):
 * pg_class (table/view/matview/index/sequence + constraint-backed index),
 * pg_class objsubid>0 (column), pg_proc, pg_constraint (PK/UNIQUE/FK/CHECK on
 * table and domain), pg_type (composite + domain), pg_policy, pg_event_trigger,
 * pg_publication(_rel), pg_attrdef, pg_rewrite, pg_trigger, pg_inherits.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { encodeId } from "../src/core/stable-id.ts";
import { extract, type ExtractResult } from "../src/extract/extract.ts";
import { createTestDb, type TestDb } from "./containers.ts";

const FIXTURE_DDL = /* sql */ `
  CREATE SCHEMA app;
  CREATE SEQUENCE app.id_seq;
  CREATE TYPE app.addr AS (street text, city text);
  CREATE DOMAIN app.pos AS integer CHECK (VALUE > 0);

  CREATE TABLE app.users (
    id integer PRIMARY KEY DEFAULT nextval('app.id_seq'),
    email text NOT NULL,
    qty app.pos,
    home app.addr,
    score numeric DEFAULT 0,
    CONSTRAINT users_email_uq UNIQUE (email),
    CONSTRAINT score_nonneg CHECK (score >= 0)
  );

  CREATE TABLE app.orders (
    id integer PRIMARY KEY,
    user_id integer NOT NULL,
    note text,
    CONSTRAINT orders_user_fk FOREIGN KEY (user_id) REFERENCES app.users (id)
  );
  CREATE INDEX orders_user_idx ON app.orders (user_id);
  CREATE TABLE app.archived_orders () INHERITS (app.orders);

  CREATE FUNCTION app.inc(a integer) RETURNS integer
    LANGUAGE sql IMMUTABLE AS 'SELECT a + 1';
  CREATE FUNCTION app.user_count() RETURNS bigint
    LANGUAGE sql STABLE AS 'SELECT count(*) FROM app.users';
  CREATE FUNCTION app.touch() RETURNS trigger
    LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END';
  CREATE TRIGGER orders_touch BEFORE UPDATE ON app.orders
    FOR EACH ROW EXECUTE FUNCTION app.touch();

  CREATE VIEW app.user_emails AS SELECT id, email FROM app.users;
  CREATE VIEW app.user_emails2 AS SELECT id FROM app.user_emails;
  CREATE MATERIALIZED VIEW app.order_counts AS
    SELECT user_id, count(*) AS n FROM app.orders GROUP BY user_id;

  ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
  CREATE POLICY users_pos ON app.users USING (app.user_count() >= 0);

  CREATE FUNCTION app.evt() RETURNS event_trigger
    LANGUAGE plpgsql AS 'BEGIN END';
  CREATE EVENT TRIGGER app_evt ON ddl_command_end EXECUTE FUNCTION app.evt();
`;

let db: TestDb;
let result: ExtractResult;
let pgMajor: number;

beforeAll(async () => {
  db = await createTestDb("depend-oracle");
  await db.pool.query(FIXTURE_DDL);
  pgMajor = await db.cluster.pgMajor();
  // publication column lists are PG15+; on PG14 publish the whole table.
  await db.pool.query(
    pgMajor >= 15
      ? `CREATE PUBLICATION app_pub FOR TABLE app.users (id, email)`
      : `CREATE PUBLICATION app_pub FOR TABLE app.users`,
  );
  result = await extract(db.pool);
}, 120_000);

afterAll(async () => {
  await db.drop();
});

/** Stable, human-reviewable rendering of one edge. */
function renderEdges(kind: string): string[] {
  return result.factBase.edges
    .filter((e) => e.kind === kind)
    .map((e) => `${encodeId(e.from)} -> ${encodeId(e.to)}`)
    .sort();
}

describe("pg_depend resolver: edge-set oracle", () => {
  test("depends edges are exactly as resolved today", () => {
    // Some pg_depend rows differ across the supported version matrix and are
    // excluded so this oracle is stable from PG14-18: object self-dependencies
    // (PG14 records view/matview _RETURN self-deps; PG15+ does not) and
    // publication column-list edges (PG15+ only — pinned separately below).
    const dependsEdges = renderEdges("depends").filter((e) => {
      const [from, to] = e.split(" -> ");
      return from !== to && !e.startsWith("publication:app_pub -> column:");
    });
    expect(dependsEdges).toMatchInlineSnapshot(`
      [
        "column:app.users.home -> type:app.addr",
        "column:app.users.id -> sequence:app.id_seq",
        "column:app.users.qty -> domain:app.pos",
        "constraint:app.orders.orders_pkey -> column:app.orders.id",
        "constraint:app.orders.orders_user_fk -> column:app.orders.user_id",
        "constraint:app.orders.orders_user_fk -> column:app.users.id",
        "constraint:app.orders.orders_user_fk -> constraint:app.users.users_pkey",
        "constraint:app.pos.pos_check -> domain:app.pos",
        "constraint:app.users.score_nonneg -> column:app.users.score",
        "constraint:app.users.users_email_uq -> column:app.users.email",
        "constraint:app.users.users_pkey -> column:app.users.id",
        "default:app.users.id -> column:app.users.id",
        "default:app.users.id -> sequence:app.id_seq",
        "default:app.users.score -> column:app.users.score",
        "domain:app.pos -> schema:app",
        "eventTrigger:app_evt -> function:app.evt()",
        "function:app.evt() -> schema:app",
        "function:app.inc(integer) -> schema:app",
        "function:app.touch() -> schema:app",
        "function:app.user_count() -> schema:app",
        "index:app.orders_user_idx -> column:app.orders.user_id",
        "materializedView:app.order_counts -> column:app.orders.user_id",
        "materializedView:app.order_counts -> schema:app",
        "policy:app.users.users_pos -> function:app.user_count()",
        "policy:app.users.users_pos -> table:app.users",
        "publication:app_pub -> table:app.users",
        "sequence:app.id_seq -> schema:app",
        "table:app.archived_orders -> schema:app",
        "table:app.archived_orders -> table:app.orders",
        "table:app.archived_orders -> table:app.orders",
        "table:app.orders -> schema:app",
        "table:app.users -> schema:app",
        "trigger:app.orders.orders_touch -> function:app.touch()",
        "trigger:app.orders.orders_touch -> table:app.orders",
        "type:app.addr -> schema:app",
        "view:app.user_emails -> column:app.users.email",
        "view:app.user_emails -> column:app.users.id",
        "view:app.user_emails -> schema:app",
        "view:app.user_emails2 -> schema:app",
        "view:app.user_emails2 -> view:app.user_emails",
      ]
    `);
  });

  test("publication column-list edges are PG15+", () => {
    if (pgMajor < 15) return; // publication column lists don't exist before PG15
    expect(
      renderEdges("depends").filter((e) =>
        e.startsWith("publication:app_pub -> column:"),
      ),
    ).toEqual([
      "publication:app_pub -> column:app.users.email",
      "publication:app_pub -> column:app.users.id",
    ]);
  });

  test("owner edges are exactly as resolved today", () => {
    // the `public` schema is owned by the bootstrap role on PG14 but by
    // pg_database_owner (a pg_* role, filtered out) on PG15+; exclude it so
    // this oracle is stable across the version matrix.
    const ownerEdges = renderEdges("owner").filter(
      (e) => !e.startsWith("schema:public -> "),
    );
    expect(ownerEdges).toMatchInlineSnapshot(`
      [
        "domain:app.pos -> role:test",
        "eventTrigger:app_evt -> role:test",
        "function:app.evt() -> role:test",
        "function:app.inc(integer) -> role:test",
        "function:app.touch() -> role:test",
        "function:app.user_count() -> role:test",
        "materializedView:app.order_counts -> role:test",
        "publication:app_pub -> role:test",
        "schema:app -> role:test",
        "sequence:app.id_seq -> role:test",
        "table:app.archived_orders -> role:test",
        "table:app.orders -> role:test",
        "table:app.users -> role:test",
        "type:app.addr -> role:test",
        "view:app.user_emails -> role:test",
        "view:app.user_emails2 -> role:test",
      ]
    `);
  });
});

/**
 * Foreign tables (`pg_class.relkind = 'f'`) must resolve at the RELATION level,
 * not only at the column level. The set-based resolver's `rel` CTE skipped 'f',
 * so a view depending on the foreign-table relation shape (e.g. `count(*)`) lost
 * its dependency edge entirely (review P1 #3). Pinned in its own container so the
 * cross-version oracle snapshot above stays untouched.
 */
describe("pg_depend resolver: foreign-table relation-level dependencies (review P1 #3)", () => {
  let ftDb: TestDb;
  let ftResult: ExtractResult;

  beforeAll(async () => {
    ftDb = await createTestDb("depend-oracle-ft");
    // A handler-less FDW is enough: CREATE VIEW only parses/rewrites its query
    // (it never invokes the FDW), so the relation-level pg_depend edge is still
    // recorded — mirroring corpus/foreign-table-constraints--add-check.
    await ftDb.pool.query(`
      CREATE SCHEMA ftapp;
      CREATE FOREIGN DATA WRAPPER ftapp_fdw;
      CREATE SERVER ftapp_srv FOREIGN DATA WRAPPER ftapp_fdw;
      CREATE FOREIGN TABLE ftapp.ft (id integer) SERVER ftapp_srv;
      CREATE VIEW ftapp.v_count AS SELECT count(*) AS n FROM ftapp.ft;
      CREATE VIEW ftapp.v_cols AS SELECT id FROM ftapp.ft;
    `);
    ftResult = await extract(ftDb.pool);
  }, 120_000);

  afterAll(async () => {
    await ftDb.drop();
  });

  test("a view referencing only the relation shape keeps its foreignTable dependency", () => {
    const depends = ftResult.factBase.edges
      .filter((e) => e.kind === "depends")
      .map((e) => `${encodeId(e.from)} -> ${encodeId(e.to)}`);
    // count(*) references the relation, not any column: the edge must resolve to
    // the foreignTable id rather than being dropped as a NULL endpoint.
    expect(depends).toContain("view:ftapp.v_count -> foreignTable:ftapp.ft");
    // a column reference still resolves to the column (unchanged behaviour).
    expect(depends).toContain("view:ftapp.v_cols -> column:ftapp.ft.id");
  });
});
