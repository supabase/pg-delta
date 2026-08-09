import { describe, expect, test } from "bun:test";
import { encodeId, parseId, type StableId } from "./stable-id.ts";

/** Round-trip helper: encode → parse must reproduce the value exactly. */
function roundtrip(id: StableId): void {
  const encoded = encodeId(id);
  expect(parseId(encoded)).toEqual(id);
}

describe("encodeId", () => {
  test("simple name kinds", () => {
    expect(encodeId({ kind: "schema", name: "public" })).toBe("schema:public");
    expect(encodeId({ kind: "role", name: "app_user" })).toBe("role:app_user");
    expect(encodeId({ kind: "extension", name: "pgcrypto" })).toBe(
      "extension:pgcrypto",
    );
  });

  test("schema-qualified kinds", () => {
    expect(encodeId({ kind: "table", schema: "public", name: "users" })).toBe(
      "table:public.users",
    );
    expect(encodeId({ kind: "view", schema: "app", name: "v_users" })).toBe(
      "view:app.v_users",
    );
    expect(
      encodeId({ kind: "index", schema: "public", name: "users_pkey" }),
    ).toBe("index:public.users_pkey");
  });

  test("sub-entity kinds", () => {
    expect(
      encodeId({
        kind: "column",
        schema: "public",
        table: "users",
        name: "email",
      }),
    ).toBe("column:public.users.email");
    expect(
      encodeId({
        kind: "constraint",
        schema: "public",
        table: "users",
        name: "users_pkey",
      }),
    ).toBe("constraint:public.users.users_pkey");
    expect(
      encodeId({
        kind: "default",
        schema: "public",
        table: "users",
        name: "id",
      }),
    ).toBe("default:public.users.id");
  });

  test("routines carry signatures", () => {
    expect(
      encodeId({
        kind: "function",
        schema: "public",
        name: "add",
        args: ["integer", "integer"],
      }),
    ).toBe("function:public.add(integer,integer)");
    expect(
      encodeId({
        kind: "procedure",
        schema: "public",
        name: "add",
        args: ["integer", "integer"],
      }),
    ).toBe("procedure:public.add(integer,integer)");
    expect(
      encodeId({
        kind: "procedure",
        schema: "public",
        name: "now_utc",
        args: [],
      }),
    ).toBe("procedure:public.now_utc()");
  });

  test("quotes parts containing delimiters", () => {
    expect(
      encodeId({ kind: "table", schema: "public", name: "weird.name" }),
    ).toBe('table:public."weird.name"');
    expect(encodeId({ kind: "schema", name: 'has"quote' })).toBe(
      'schema:"has""quote"',
    );
    expect(encodeId({ kind: "table", schema: "a:b", name: "c,d" })).toBe(
      'table:"a:b"."c,d"',
    );
  });

  test("wrapper kinds nest their target", () => {
    const table: StableId = { kind: "table", schema: "public", name: "users" };
    expect(encodeId({ kind: "comment", target: table })).toBe(
      "comment:(table:public.users)",
    );
    expect(encodeId({ kind: "acl", target: table, grantee: "app_user" })).toBe(
      "acl:(table:public.users).app_user",
    );
    // column-level grant appends an optional `.column` segment
    expect(
      encodeId({
        kind: "acl",
        target: table,
        grantee: "app_user",
        column: "email",
      }),
    ).toBe("acl:(table:public.users).app_user.email");
    expect(
      encodeId({ kind: "securityLabel", target: table, provider: "selinux" }),
    ).toBe("securityLabel:(table:public.users).selinux");
  });

  test("membership and user mapping", () => {
    expect(
      encodeId({ kind: "membership", role: "admin", member: "alice" }),
    ).toBe("membership:admin.alice");
    expect(
      encodeId({ kind: "userMapping", server: "files", role: "bob" }),
    ).toBe("userMapping:files.bob");
  });

  test("extension intent carries ext.intentKind.key", () => {
    expect(
      encodeId({
        kind: "extensionIntent",
        ext: "pg_cron",
        intentKind: "job",
        key: "nightly",
      }),
    ).toBe("extensionIntent:pg_cron.job.nightly");
    // a jobname with delimiters must quote the key segment only
    expect(
      encodeId({
        kind: "extensionIntent",
        ext: "pg_cron",
        intentKind: "job",
        key: "night.ly job",
      }),
    ).toBe('extensionIntent:pg_cron.job."night.ly job"');
  });
});

describe("parseId round-trips", () => {
  const cases: StableId[] = [
    { kind: "schema", name: "public" },
    { kind: "role", name: "postgres" },
    { kind: "table", schema: "public", name: "users" },
    { kind: "table", schema: "Schema With Space", name: 'crazy."name"' },
    { kind: "column", schema: "s", table: "t", name: "c" },
    { kind: "column", schema: "a.b", table: "c:d", name: "e(f)" },
    { kind: "function", schema: "public", name: "fn", args: [] },
    { kind: "procedure", schema: "public", name: "fn", args: [] },
    {
      kind: "procedure",
      schema: "public",
      name: "fn",
      args: ["text", "integer[]"],
    },
    {
      kind: "procedure",
      schema: "s",
      name: "weird,fn",
      args: ["my schema.my type"],
    },
    { kind: "aggregate", schema: "public", name: "agg", args: ["numeric"] },
    { kind: "index", schema: "public", name: "idx" },
    { kind: "sequence", schema: "public", name: "users_id_seq" },
    {
      kind: "comment",
      target: { kind: "column", schema: "s", table: "t", name: "c" },
    },
    {
      kind: "acl",
      target: { kind: "procedure", schema: "s", name: "f", args: ["text"] },
      grantee: "PUBLIC",
    },
    // column-level ACL: the optional `column` segment must round-trip
    {
      kind: "acl",
      target: { kind: "table", schema: "public", name: "users" },
      grantee: "app_user",
      column: "email",
    },
    // hostile column name (dot, quote, uppercase) must round-trip too
    {
      kind: "acl",
      target: { kind: "table", schema: "s", name: "t" },
      grantee: "PUBLIC",
      column: 'weird."col".Name',
    },
    {
      kind: "securityLabel",
      target: { kind: "table", schema: "s", name: "t" },
      provider: "dummy",
    },
    // nested wrapper: comment on nothing weirder than facts allow, but the
    // codec itself must support recursion
    {
      kind: "comment",
      target: {
        kind: "acl",
        target: { kind: "schema", name: "s" },
        grantee: "g",
      },
    },
    { kind: "membership", role: "r1", member: "r2" },
    { kind: "userMapping", server: "srv", role: "rl" },
    { kind: "typeAttribute", schema: "s", type: "addr", name: "city" },
    { kind: "typeAttribute", schema: "a.b", type: "weird type", name: "x,y" },
    { kind: "publicationRel", publication: "pub", schema: "s", table: "t" },
    {
      kind: "publicationRel",
      publication: "p.b",
      schema: "weird s",
      table: 't"q',
    },
    { kind: "publicationSchema", publication: "pub", schema: "analytics" },
    {
      kind: "defaultPrivilege",
      role: "owner",
      schema: "public",
      objtype: "tables",
      grantee: "app",
    },
    {
      kind: "defaultPrivilege",
      role: "owner",
      schema: null,
      objtype: "functions",
      grantee: "app",
    },
    { kind: "extensionIntent", ext: "pg_cron", intentKind: "job", key: "nb" },
    {
      kind: "extensionIntent",
      ext: "pg_cron",
      intentKind: "job",
      key: "weird.job, name",
    },
  ];

  for (const id of cases) {
    test(`round-trip ${JSON.stringify(id)}`, () => roundtrip(id));
  }

  test("empty-string parts are quoted and round-trip", () => {
    const id: StableId = {
      kind: "defaultPrivilege",
      role: "o",
      schema: null,
      objtype: "tables",
      grantee: "g",
    };
    const enc = encodeId(id);
    expect(parseId(enc)).toEqual(id);
  });

  test("rejects malformed input", () => {
    expect(() => parseId("notakind:foo")).toThrow();
    expect(() => parseId("table:only_one_part")).toThrow();
    expect(() => parseId("table:a.b.c.d")).toThrow();
    expect(() => parseId('table:"unterminated')).toThrow();
    expect(() => parseId("comment:(table:a.b")).toThrow();
    expect(() => parseId("")).toThrow();
  });

  test("two distinct ids never encode to the same string", () => {
    // the classic ambiguity: dots inside names vs structural dots
    const a = encodeId({ kind: "table", schema: "a.b", name: "c" });
    const b = encodeId({ kind: "table", schema: "a", name: "b.c" });
    expect(a).not.toBe(b);
    const c = encodeId({ kind: "column", schema: "a", table: "b", name: "c" });
    const d = encodeId({ kind: "table", schema: "a", name: "b.c" });
    expect(c).not.toBe(d);
  });
});
