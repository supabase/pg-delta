import { describe, expect, test } from "bun:test";
import { analyzeAndSort } from "../src/analyze-and-sort";

describe("diagnostics", () => {
  test("reports duplicate producers with candidate details", async () => {
    const result = await analyzeAndSort([
      "create schema app;",
      "create table app.users(id int primary key);",
      "create table app.users(id int primary key, email text not null);",
      "create view app.user_ids as select id from app.users;",
    ]);
    const duplicateDiagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "DUPLICATE_PRODUCER",
    );
    const ambiguousDependency = duplicateDiagnostics.find((diagnostic) =>
      diagnostic.message.includes("Ambiguous dependency"),
    );

    expect(duplicateDiagnostics.length).toBeGreaterThan(0);
    expect(ambiguousDependency).toBeDefined();
    expect(
      JSON.stringify(ambiguousDependency?.details?.candidateObjectKeys),
    ).toContain("table:app:users");
  });

  test("includes candidate producers for unresolved dependencies", async () => {
    const result = await analyzeAndSort([
      "create schema analytics;",
      "create table analytics.accounts(id int primary key);",
      "create view public.account_ids as select id from public.accounts;",
    ]);
    const unresolved = result.diagnostics.find(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );

    expect(unresolved).toBeDefined();
    expect(unresolved?.details?.candidateObjectKeys).toBeDefined();
    expect(JSON.stringify(unresolved?.details?.candidateObjectKeys)).toContain(
      "table:analytics:accounts",
    );
  });

  test("reports unresolved publication for ALTER SUBSCRIPTION ADD PUBLICATION", async () => {
    const result = await analyzeAndSort([
      "alter subscription sub_orders add publication pub_events;",
      "create subscription sub_orders connection 'host=localhost port=5432 dbname=postgres' publication pub_orders with (connect = false);",
      "create publication pub_orders;",
    ]);
    const unresolved = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.details?.requiredObjectKey === "publication::pub_events:",
    );

    expect(unresolved).toBeDefined();
  });

  test("reports unresolved table for ALTER PUBLICATION DROP TABLE", async () => {
    const result = await analyzeAndSort([
      "alter publication pub_orders drop table public.orders;",
      "create publication pub_orders;",
    ]);
    const unresolved = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.details?.requiredObjectKey === "table:public:orders:",
    );

    expect(unresolved).toBeDefined();
  });

  test("reports unresolved schema for ALTER PUBLICATION DROP TABLES IN SCHEMA", async () => {
    const result = await analyzeAndSort([
      "alter publication pub_sales drop tables in schema sales;",
      "create publication pub_sales;",
    ]);
    const unresolved = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.details?.requiredObjectKey === "schema::sales:",
    );

    expect(unresolved).toBeDefined();
  });

  test("reports unresolved row filter function for ALTER PUBLICATION ADD TABLE", async () => {
    const result = await analyzeAndSort([
      "alter publication pub_orders add table public.orders where (public.is_visible(id));",
      "create table public.orders(id int primary key);",
      "create publication pub_orders;",
    ]);
    const unresolved = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.details?.requiredObjectKey ===
          "function:public:is_visible:(unknown)",
    );

    expect(unresolved).toBeDefined();
  });

  test("cycle diagnostics include statement participants", async () => {
    const result = await analyzeAndSort([
      "create view public.v1 as select * from public.v2;",
      "create view public.v2 as select * from public.v1;",
    ]);
    const cycleDiagnostic = result.diagnostics.find(
      (diagnostic) => diagnostic.code === "CYCLE_DETECTED",
    );

    expect(cycleDiagnostic).toBeDefined();
    expect(cycleDiagnostic?.details?.cycleStatements).toBeDefined();
    const cycleStatements = JSON.stringify(
      cycleDiagnostic?.details?.cycleStatements,
    );
    expect(cycleStatements).toContain("<input:");
  });

  test("externalProviders suppresses UNRESOLVED_DEPENDENCY for provided objects", async () => {
    const sql = [
      "create schema analytics;",
      "create table analytics.accounts(id int primary key);",
      "create view public.account_ids as select id from public.accounts;",
    ];
    const withoutProviders = await analyzeAndSort(sql);
    const unresolvedWithout = withoutProviders.diagnostics.filter(
      (d) => d.code === "UNRESOLVED_DEPENDENCY",
    );
    expect(unresolvedWithout.length).toBeGreaterThan(0);

    const externalProviders = [
      { kind: "table" as const, schema: "public", name: "accounts" },
    ];
    const withProviders = await analyzeAndSort(sql, { externalProviders });
    const unresolvedWith = withProviders.diagnostics.filter(
      (d) => d.code === "UNRESOLVED_DEPENDENCY",
    );
    expect(unresolvedWith.length).toBeLessThan(unresolvedWithout.length);
  });

  test("external base type providers satisfy generated array type requirements", async () => {
    const result = await analyzeAndSort(
      ["create schema app;", "create table app.events(values app.score[]);"],
      {
        externalProviders: [{ kind: "type", schema: "app", name: "score" }],
      },
    );
    const unresolvedArrayType = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" &&
            ref.schema === "app" &&
            ref.name === "score[]",
        ) === true,
    );

    expect(unresolvedArrayType).toHaveLength(0);
  });

  test("external range providers do not invent default multirange requirements", async () => {
    const withoutMultirangeProvider = await analyzeAndSort(
      [
        "create schema app;",
        "create table app.events(spans app.period_multirange);",
      ],
      {
        externalProviders: [
          {
            kind: "type",
            schema: "app",
            name: "period",
            signature: "(range)",
          },
        ],
      },
    );
    const missingImplicitMultirange =
      withoutMultirangeProvider.diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
          diagnostic.objectRefs?.some(
            (ref) =>
              ref.kind === "type" &&
              ref.schema === "app" &&
              ref.name === "period_multirange",
          ) === true,
      );

    const withMultirangeProvider = await analyzeAndSort(
      [
        "create schema app;",
        "create table app.events(spans app.period_multirange);",
      ],
      {
        externalProviders: [
          {
            kind: "type",
            schema: "app",
            name: "period",
            signature: "(range)",
          },
          {
            kind: "type",
            schema: "app",
            name: "period_multirange",
            signature: "(multirange)",
          },
        ],
      },
    );
    const unresolvedExplicitMultirange =
      withMultirangeProvider.diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
          diagnostic.objectRefs?.some(
            (ref) =>
              ref.kind === "type" &&
              ref.schema === "app" &&
              ref.name === "period_multirange",
          ) === true,
      );

    expect(missingImplicitMultirange).toHaveLength(1);
    expect(unresolvedExplicitMultirange).toHaveLength(0);
  });

  test("does not report unresolved unqualified built-in operator class and family comments", async () => {
    const result = await analyzeAndSort([
      "comment on operator class int4_ops using btree is 'built-in int4 opclass';",
      "comment on operator family integer_ops using btree is 'built-in integer opfamily';",
    ]);
    const unresolvedBuiltIns = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            (ref.kind === "operator_class" && ref.name === "int4_ops") ||
            (ref.kind === "operator_family" && ref.name === "integer_ops"),
        ) === true,
    );

    expect(unresolvedBuiltIns).toHaveLength(0);
  });

  test("external domain providers satisfy generated array type requirements", async () => {
    const result = await analyzeAndSort(
      [
        "create schema app;",
        "create table app.events(emails app.email_domain[]);",
        "create table app.audit(emails app.other_domain[]);",
      ],
      {
        externalProviders: [
          { kind: "domain", schema: "app", name: "email_domain" },
        ],
      },
    );
    const providedDomainArray = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" &&
            ref.schema === "app" &&
            ref.name === "email_domain[]",
        ) === true,
    );
    const unrelatedDomainArray = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" &&
            ref.schema === "app" &&
            ref.name === "other_domain[]",
        ) === true,
    );

    expect(providedDomainArray).toHaveLength(0);
    expect(unrelatedDomainArray).toHaveLength(1);
  });

  test("external relation providers satisfy generated row type array requirements", async () => {
    const result = await analyzeAndSort(
      [
        "create schema app;",
        "create table app.children(parents app.events[]);",
      ],
      {
        externalProviders: [{ kind: "table", schema: "app", name: "events" }],
      },
    );
    const unresolvedRowTypeArray = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" &&
            ref.schema === "app" &&
            ref.name === "events[]",
        ) === true,
    );

    expect(unresolvedRowTypeArray).toHaveLength(0);
  });

  test("reports self references through generated array types", async () => {
    const tableResult = await analyzeAndSort([
      "create schema app;",
      "create table app.events(parents app.events[]);",
    ]);
    const rangeResult = await analyzeAndSort([
      "create schema app;",
      "create type app.r as range (subtype = app.r[]);",
    ]);
    const rangeMultirangeResult = await analyzeAndSort([
      "create schema app;",
      "create type app.r as range (subtype = app.r_multirange);",
    ]);
    const explicitRangeMultirangeResult = await analyzeAndSort([
      "create schema app;",
      "create type app.r as range (subtype = app.mr, multirange_type_name = app.mr);",
    ]);
    const domainResult = await analyzeAndSort([
      "create schema app;",
      "create domain app.email_domain as app.email_domain[];",
    ]);
    const selfTableArray = tableResult.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" &&
            ref.schema === "app" &&
            ref.name === "events[]",
        ) === true,
    );
    const selfRangeArray = rangeResult.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" && ref.schema === "app" && ref.name === "r[]",
        ) === true,
    );
    const selfRangeMultirange = rangeMultirangeResult.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" &&
            ref.schema === "app" &&
            ref.name === "r_multirange",
        ) === true,
    );
    const selfExplicitRangeMultirange =
      explicitRangeMultirangeResult.diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
          diagnostic.objectRefs?.some(
            (ref) =>
              ref.kind === "type" && ref.schema === "app" && ref.name === "mr",
          ) === true,
      );
    const selfDomainArray = domainResult.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "type" &&
            ref.schema === "app" &&
            ref.name === "email_domain[]",
        ) === true,
    );

    expect(selfTableArray).toHaveLength(1);
    expect(selfRangeArray).toHaveLength(1);
    expect(selfRangeMultirange).toHaveLength(1);
    expect(selfExplicitRangeMultirange).toHaveLength(1);
    expect(selfDomainArray).toHaveLength(1);
  });

  test("external operator class providers satisfy omitted range subtype defaults", async () => {
    const sql = [
      "create schema app;",
      "create type app.score as (value int4);",
      "create type app.score_range as range (subtype = app.score);",
    ];
    const withoutProviders = await analyzeAndSort(sql);
    const missingDefaultWithout = withoutProviders.diagnostics.filter(
      (d) =>
        d.code === "UNRESOLVED_DEPENDENCY" &&
        d.message.includes("No default btree operator class provider"),
    );
    expect(missingDefaultWithout.length).toBeGreaterThan(0);

    const withProviders = await analyzeAndSort(sql, {
      externalProviders: [
        {
          kind: "operator_class",
          schema: "app",
          name: "score_ops",
          signature: "(btree,app.score)",
          implicitProvider: true,
        },
      ],
    });
    const missingDefaultWith = withProviders.diagnostics.filter(
      (d) =>
        d.code === "UNRESOLVED_DEPENDENCY" &&
        d.message.includes("No default btree operator class provider"),
    );
    expect(missingDefaultWith).toHaveLength(0);
  });

  test("external enum subtype providers do not require range default opclass providers", async () => {
    const result = await analyzeAndSort(
      [
        "create schema app;",
        "create type app.mood_range as range (subtype = app.mood);",
      ],
      {
        externalProviders: [
          { kind: "type", schema: "app", name: "mood", signature: "(enum)" },
        ],
      },
    );
    const unresolved = result.diagnostics.filter(
      (d) => d.code === "UNRESOLVED_DEPENDENCY",
    );
    const missingDefault = unresolved.filter((d) =>
      d.message.includes("No default btree operator class provider"),
    );

    expect(unresolved).toHaveLength(0);
    expect(missingDefault).toHaveLength(0);
  });

  test("external multirange providers satisfy multirange default opclasses", async () => {
    const result = await analyzeAndSort(
      [
        "create schema app;",
        "create type app.wrap as range (subtype = app.period_multirange);",
      ],
      {
        externalProviders: [
          { kind: "type", schema: "app", name: "period", signature: "(range)" },
          {
            kind: "type",
            schema: "app",
            name: "period_multirange",
            signature: "(multirange)",
          },
        ],
      },
    );
    const unresolved = result.diagnostics.filter(
      (d) => d.code === "UNRESOLVED_DEPENDENCY",
    );
    const missingDefault = unresolved.filter((d) =>
      d.message.includes("No default btree operator class provider"),
    );

    expect(unresolved).toHaveLength(0);
    expect(missingDefault).toHaveLength(0);
  });

  test("external custom subtype providers still require range default opclass providers", async () => {
    const result = await analyzeAndSort(
      [
        "create schema app;",
        "create type app.score_range as range (subtype = app.score);",
      ],
      {
        externalProviders: [{ kind: "type", schema: "app", name: "score" }],
      },
    );
    const missingDefault = result.diagnostics.filter(
      (d) =>
        d.code === "UNRESOLVED_DEPENDENCY" &&
        d.message.includes(
          "No default btree operator class provider found for range subtype 'app.score'",
        ),
    );

    expect(missingDefault).toHaveLength(1);
  });

  test("external range operator class providers must match the omitted subtype", async () => {
    const sql = [
      "create schema app;",
      "create type app.score as (value int4);",
      "create type app.other_score as (value int4);",
      "create type app.score_range as range (subtype = app.score);",
    ];
    const result = await analyzeAndSort(sql, {
      externalProviders: [
        {
          kind: "operator_class",
          schema: "app",
          name: "other_score_ops",
          signature: "(btree,app.other_score)",
        },
      ],
    });
    const missingDefault = result.diagnostics.filter(
      (d) =>
        d.code === "UNRESOLVED_DEPENDENCY" &&
        d.message.includes(
          "No default btree operator class provider found for range subtype 'app.score'",
        ),
    );

    expect(missingDefault).toHaveLength(1);
  });

  test("external non-default operator class providers do not satisfy omitted range subtype defaults", async () => {
    const result = await analyzeAndSort(
      [
        "create schema app;",
        "create type app.score as (value int4);",
        "create type app.score_range as range (subtype = app.score);",
      ],
      {
        externalProviders: [
          {
            kind: "operator_class",
            schema: "app",
            name: "score_ops",
            signature: "(btree,app.score)",
          },
        ],
      },
    );
    const missingDefault = result.diagnostics.filter(
      (d) =>
        d.code === "UNRESOLVED_DEPENDENCY" &&
        d.message.includes(
          "No default btree operator class provider found for range subtype 'app.score'",
        ),
    );

    expect(missingDefault).toHaveLength(1);
  });

  test("external operator class providers satisfy identity comment signatures", async () => {
    const result = await analyzeAndSort(
      [
        "create schema app;",
        "comment on operator class app.ops using btree is 'external';",
      ],
      {
        externalProviders: [
          {
            kind: "operator_class",
            schema: "app",
            name: "ops",
            signature: "(btree,int4)",
          },
        ],
      },
    );
    const unresolvedOperatorClass = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.objectRefs?.some(
          (ref) =>
            ref.kind === "operator_class" &&
            ref.schema === "app" &&
            ref.name === "ops" &&
            ref.signature === "(btree)",
        ) === true,
    );

    expect(unresolvedOperatorClass).toHaveLength(0);
  });

  test("externalProviders with signature mismatch uses compatibility (e.g. timezone)", async () => {
    const sql = [
      "create table public.events(ts timestamptz default timezone('utc'::text, now()) not null);",
    ];
    const withoutProviders = await analyzeAndSort(sql);
    const timezoneUnresolved = withoutProviders.diagnostics.filter(
      (d) =>
        d.code === "UNRESOLVED_DEPENDENCY" &&
        JSON.stringify(d.details?.requiredObjectKey).includes("timezone"),
    );
    expect(timezoneUnresolved.length).toBeGreaterThan(0);

    const externalProviders = [
      {
        kind: "function" as const,
        schema: "public",
        name: "timezone",
        signature: "(text,timestamp with time zone)",
      },
    ];
    const withProviders = await analyzeAndSort(sql, { externalProviders });
    const timezoneUnresolvedWith = withProviders.diagnostics.filter(
      (d) =>
        d.code === "UNRESOLVED_DEPENDENCY" &&
        JSON.stringify(d.details?.requiredObjectKey).includes("timezone"),
    );
    expect(timezoneUnresolvedWith.length).toBe(0);
  });

  test("external aggregate providers satisfy function-call requirements", async () => {
    const sql = [
      "create table public.accounts(id int);",
      "create view public.max_account as select max(id) from public.accounts;",
    ];
    const withoutProviders = await analyzeAndSort(sql);
    const unresolvedWithout = withoutProviders.diagnostics.filter(
      (d) =>
        d.code === "UNRESOLVED_DEPENDENCY" &&
        JSON.stringify(d.details?.requiredObjectKey).includes(
          "function:public:max",
        ),
    );
    expect(unresolvedWithout.length).toBeGreaterThan(0);

    const withProviders = await analyzeAndSort(sql, {
      externalProviders: [
        {
          kind: "aggregate",
          schema: "public",
          name: "max",
          signature: "(integer)",
        },
      ],
    });
    const unresolvedWith = withProviders.diagnostics.filter(
      (d) =>
        d.code === "UNRESOLVED_DEPENDENCY" &&
        JSON.stringify(d.details?.requiredObjectKey).includes(
          "function:public:max",
        ),
    );
    expect(unresolvedWith.length).toBe(0);
  });

  test("external variadic providers satisfy unknown-arity calls", async () => {
    const sql = [
      "create table public.events(meta jsonb default json_build_object('a', 1));",
    ];
    const withoutProviders = await analyzeAndSort(sql);
    const unresolvedWithout = withoutProviders.diagnostics.filter(
      (d) =>
        d.code === "UNRESOLVED_DEPENDENCY" &&
        JSON.stringify(d.details?.requiredObjectKey).includes(
          "json_build_object",
        ),
    );
    expect(unresolvedWithout.length).toBeGreaterThan(0);

    const withProviders = await analyzeAndSort(sql, {
      externalProviders: [
        {
          kind: "function",
          schema: "public",
          name: "json_build_object",
          signature: "(VARIADIC any)",
        },
      ],
    });
    const unresolvedWith = withProviders.diagnostics.filter(
      (d) =>
        d.code === "UNRESOLVED_DEPENDENCY" &&
        JSON.stringify(d.details?.requiredObjectKey).includes(
          "json_build_object",
        ),
    );
    expect(unresolvedWith.length).toBe(0);
  });

  test("strict extension schema behavior remains unchanged", async () => {
    const sql = [
      "create table public.ids(id uuid default extensions.uuid_generate_v4());",
    ];
    const withMismatchedProvider = await analyzeAndSort(sql, {
      externalProviders: [
        {
          kind: "function",
          schema: "public",
          name: "uuid_generate_v4",
          signature: "()",
        },
      ],
    });
    const unresolved = withMismatchedProvider.diagnostics.filter(
      (d) =>
        d.code === "UNRESOLVED_DEPENDENCY" &&
        JSON.stringify(d.details?.requiredObjectKey).includes(
          "function:extensions:uuid_generate_v4",
        ),
    );
    expect(unresolved.length).toBeGreaterThan(0);
  });

  test("multiple producers for same constraint add requires_constraint_key edges", async () => {
    const result = await analyzeAndSort([
      "create schema app;",
      "create table app.t(id int primary key);",
      "create table app.t(id int primary key, x int);",
      "create table app.ref(id int references app.t(id));",
    ]);
    const duplicateTable = result.diagnostics.filter(
      (d) => d.code === "DUPLICATE_PRODUCER",
    );
    expect(duplicateTable.length).toBeGreaterThan(0);
    expect(
      result.graph.edges.some((e) => e.reason === "requires_constraint_key"),
    ).toBe(true);
  });

  test("comment on trigger and policy resolve to existing producers", async () => {
    const sql = [
      "create schema auth;",
      "create table auth.users(id bigint primary key, email text, deleted_at timestamptz);",
      "create function auth.touch_users_updated_at() returns trigger language plpgsql as $$ begin return new; end; $$;",
      "create trigger initialise_auth_users_email before insert or update on auth.users for each row execute function auth.touch_users_updated_at();",
      "create policy users_select_policy on auth.users for select using (deleted_at is null);",
      "comment on trigger initialise_auth_users_email on auth.users is 'init email';",
      "comment on policy users_select_policy on auth.users is 'policy docs';",
    ];

    const result = await analyzeAndSort(sql);
    const unresolved = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        (JSON.stringify(diagnostic.details?.requiredObjectKey).includes(
          "initialise_auth_users_email",
        ) ||
          JSON.stringify(diagnostic.details?.requiredObjectKey).includes(
            "users_select_policy",
          )),
    );

    expect(unresolved.length).toBe(0);
  });
});
