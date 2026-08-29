import { describe, expect, test } from "bun:test";
import { buildFactBase, type DependencyEdge, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import type { ProjectionAudit } from "../index.ts";
import { plan } from "../plan/plan.ts";
import type { ApplierCapability } from "./capability.ts";
import type { Policy } from "./policy.ts";
import { auditManagedViewProjection } from "./reconstruct.ts";
import { supabasePolicy } from "./supabase.ts";

const schema = (name: string): StableId => ({ kind: "schema", name });
const table = (schemaName: string, name: string): StableId => ({
  kind: "table",
  schema: schemaName,
  name,
});
const extension = (name: string): StableId => ({ kind: "extension", name });
const column = (
  schemaName: string,
  tableName: string,
  name: string,
): StableId => ({
  kind: "column",
  schema: schemaName,
  table: tableName,
  name,
});
const fact = (
  id: StableId,
  payload: Fact["payload"] = {},
  parent?: StableId,
): Fact => (parent === undefined ? { id, payload } : { id, payload, parent });

describe("attributed projection audit", () => {
  test("generic policy exclusion of differing user state is suspicious", () => {
    const publicSchema = schema("public");
    const userTable = table("public", "accounts");
    const source = buildFactBase([fact(publicSchema)], []);
    const desired = buildFactBase(
      [fact(publicSchema), fact(userTable, {}, publicSchema)],
      [],
    );
    const policy: Policy = {
      id: "generic",
      filter: [{ match: { kind: "table" }, action: "exclude" }],
    };

    const audit: ProjectionAudit = auditManagedViewProjection(source, desired, {
      policy,
    });
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({
      delta: { verb: "add", fact: { id: userTable } },
      subject: { kind: "fact", id: userTable },
      classification: "suspicious",
      suppressions: [
        {
          side: "desired",
          stage: "policyScopeRule",
          classification: "suspicious",
        },
      ],
    });
    expect(audit.entries[0]?.suppressions[0]?.reasonCode).toMatch(
      /^policy:generic:rule:[0-9a-f]{64}$/,
    );
    expect(audit.summary).toEqual({
      total: 1,
      suspicious: 1,
      acknowledged: 0,
      baseline: 0,
    });
  });

  test("named policy exclusion is acknowledged and keeps its stable reason code", () => {
    const authSchema = schema("auth");
    const authTable = table("auth", "users");
    const source = buildFactBase(
      [fact(authSchema), fact(authTable, { version: 1 }, authSchema)],
      [],
    );
    const desired = buildFactBase(
      [fact(authSchema), fact(authTable, { version: 2 }, authSchema)],
      [],
    );
    const policy: Policy = {
      id: "platform",
      filter: [
        {
          match: { schema: "auth" },
          action: "exclude",
          audit: { reasonCode: "platform.auth-schema" },
        },
      ],
    };

    const audit = auditManagedViewProjection(source, desired, { policy });
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({
      delta: { verb: "set", id: authTable, attr: "version", from: 1, to: 2 },
      subject: { kind: "fact", id: authTable },
      classification: "acknowledged",
      suppressions: [
        {
          side: "desired",
          stage: "policyScopeRule",
          reasonCode: "platform.auth-schema",
          classification: "acknowledged",
        },
        {
          side: "source",
          stage: "policyScopeRule",
          reasonCode: "platform.auth-schema",
          classification: "acknowledged",
        },
      ],
    });
    expect(audit.summary.suspicious).toBe(0);
  });

  test("target.table wildcard exclusion is a broad class selector: suspicious", () => {
    // Classifiers must see `table`, or `{ target: { schema, table: "*" } }`
    // passes as "named" on the strength of the concrete schema alone.
    const storageSchema = schema("storage");
    const objectsTable = table("storage", "objects");
    const objectsPolicy: StableId = {
      kind: "policy",
      schema: "storage",
      table: "objects",
      name: "user policy",
    };
    const policyComment = {
      id: { kind: "comment", target: objectsPolicy } as StableId,
      payload: { text: "note" },
      parent: objectsPolicy,
    };
    const base = [
      fact(storageSchema),
      fact(objectsTable, {}, storageSchema),
      fact(objectsPolicy, {}, objectsTable),
    ];
    const source = buildFactBase(base, []);
    const desired = buildFactBase([...base, policyComment], []);
    const policy: Policy = {
      id: "wildcard-table",
      filter: [
        {
          match: {
            all: [
              { kind: "comment" },
              { target: { schema: "storage", table: "*" } },
            ],
          },
          action: "exclude",
        },
      ],
    };

    const audit = auditManagedViewProjection(source, desired, { policy });
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]?.classification).toBe("suspicious");
  });

  test("target.table concrete exclusion names its surface: acknowledged", () => {
    const storageSchema = schema("storage");
    const objectsTable = table("storage", "objects");
    const objectsPolicy: StableId = {
      kind: "policy",
      schema: "storage",
      table: "objects",
      name: "user policy",
    };
    const policyComment = {
      id: { kind: "comment", target: objectsPolicy } as StableId,
      payload: { text: "note" },
      parent: objectsPolicy,
    };
    const base = [
      fact(storageSchema),
      fact(objectsTable, {}, storageSchema),
      fact(objectsPolicy, {}, objectsTable),
    ];
    const source = buildFactBase(base, []);
    const desired = buildFactBase([...base, policyComment], []);
    const policy: Policy = {
      id: "named-table",
      filter: [
        {
          match: { target: { kind: "policy", table: "objects" } },
          action: "exclude",
        },
      ],
    };

    const audit = auditManagedViewProjection(source, desired, { policy });
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]?.classification).toBe("acknowledged");
  });

  test("partitionOf exclusion pinned to a concrete parent is acknowledged", () => {
    const realtimeSchema = schema("realtime");
    const partitionChild = table("realtime", "messages_2026_08_05");
    const source = buildFactBase([fact(realtimeSchema)], []);
    const desired = buildFactBase(
      [
        fact(realtimeSchema),
        fact(
          partitionChild,
          {
            partitionBound: "FOR VALUES FROM ('2026-08-05') TO ('2026-08-06')",
            parentTable: { schema: "realtime", name: "messages" },
          },
          realtimeSchema,
        ),
      ],
      [],
    );
    const policy: Policy = {
      id: "realtime",
      filter: [
        {
          match: { partitionOf: { schema: "realtime", name: "messages" } },
          action: "exclude",
        },
      ],
    };

    const audit = auditManagedViewProjection(source, desired, { policy });
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({
      subject: { kind: "fact", id: partitionChild },
      classification: "acknowledged",
    });
    expect(audit.summary.suspicious).toBe(0);
  });

  test("bare partitionOf exclusion is a broad class selector: suspicious", () => {
    const realtimeSchema = schema("realtime");
    const partitionChild = table("realtime", "messages_2026_08_05");
    const source = buildFactBase([fact(realtimeSchema)], []);
    const desired = buildFactBase(
      [
        fact(realtimeSchema),
        fact(
          partitionChild,
          {
            partitionBound: "FOR VALUES FROM ('2026-08-05') TO ('2026-08-06')",
            parentTable: { schema: "realtime", name: "messages" },
          },
          realtimeSchema,
        ),
      ],
      [],
    );
    const policy: Policy = {
      id: "realtime",
      filter: [{ match: { partitionOf: {} }, action: "exclude" }],
    };

    const audit = auditManagedViewProjection(source, desired, { policy });
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({
      subject: { kind: "fact", id: partitionChild },
      classification: "suspicious",
    });
    expect(audit.summary.suspicious).toBe(1);
  });

  test("identical source and desired produce an empty audit", () => {
    const publicSchema = schema("public");
    const fb = buildFactBase([fact(publicSchema)], []);
    expect(auditManagedViewProjection(fb, fb)).toEqual({
      entries: [],
      summary: {
        total: 0,
        suspicious: 0,
        acknowledged: 0,
        baseline: 0,
      },
    });
  });

  test("reference-only projection attributes a suppressed payload change", () => {
    const publicSchema = schema("public");
    const pgmq = extension("pgmq");
    const queue = table("public", "q_jobs");
    const memberEdge: DependencyEdge = {
      from: queue,
      to: pgmq,
      kind: "memberOfExtension",
    };
    const source = buildFactBase(
      [
        fact(publicSchema),
        fact(pgmq),
        fact(queue, { version: 1 }, publicSchema),
      ],
      [memberEdge],
    );
    const desired = buildFactBase(
      [
        fact(publicSchema),
        fact(pgmq),
        fact(queue, { version: 2 }, publicSchema),
      ],
      [memberEdge],
    );

    expect(auditManagedViewProjection(source, desired).entries).toEqual([
      {
        delta: {
          verb: "set",
          id: queue,
          attr: "version",
          from: 1,
          to: 2,
        },
        subject: { kind: "fact", id: queue },
        classification: "acknowledged",
        suppressions: [
          {
            side: "desired",
            stage: "referenceOnly",
            reasonCode: "reference-only.extension-member",
            classification: "acknowledged",
          },
          {
            side: "source",
            stage: "referenceOnly",
            reasonCode: "reference-only.extension-member",
            classification: "acknowledged",
          },
        ],
      },
    ]);
  });

  test("descendant suppression points to the root decision", () => {
    const publicSchema = schema("public");
    const pgPartman = extension("pg_partman");
    const child = table("public", "events_p1");
    const childColumn = column("public", "events_p1", "id");
    const managedEdge: DependencyEdge = {
      from: child,
      to: pgPartman,
      kind: "managedBy",
    };
    const source = buildFactBase(
      [
        fact(publicSchema),
        fact(pgPartman),
        fact(child, {}, publicSchema),
        fact(childColumn, { type: "integer" }, child),
      ],
      [managedEdge],
    );
    const desired = buildFactBase(
      [
        fact(publicSchema),
        fact(pgPartman),
        fact(child, {}, publicSchema),
        fact(childColumn, { type: "bigint" }, child),
      ],
      [managedEdge],
    );

    expect(
      auditManagedViewProjection(source, desired).entries[0],
    ).toMatchObject({
      delta: { verb: "set", id: childColumn, attr: "type" },
      subject: { kind: "fact", id: childColumn },
      classification: "acknowledged",
      suppressions: [
        {
          side: "desired",
          stage: "managedBy",
          reasonCode: "managed-by.provenance",
          viaDescendantOf: child,
        },
        {
          side: "source",
          stage: "managedBy",
          reasonCode: "managed-by.provenance",
          viaDescendantOf: child,
        },
      ],
    });
  });

  test("reference-only projection attributes independent edge differences", () => {
    const publicSchema = schema("public");
    const pgmq = extension("pgmq");
    const queue = table("public", "q_jobs");
    const ownerA: StableId = { kind: "role", name: "owner_a" };
    const ownerB: StableId = { kind: "role", name: "owner_b" };
    const memberEdge: DependencyEdge = {
      from: queue,
      to: pgmq,
      kind: "memberOfExtension",
    };
    const sourceOwner: DependencyEdge = {
      from: queue,
      to: ownerA,
      kind: "owner",
    };
    const desiredOwner: DependencyEdge = {
      from: queue,
      to: ownerB,
      kind: "owner",
    };
    const facts = [
      fact(publicSchema),
      fact(pgmq),
      fact(queue, {}, publicSchema),
      fact(ownerA),
      fact(ownerB),
    ];
    const source = buildFactBase(facts, [memberEdge, sourceOwner]);
    const desired = buildFactBase(facts, [memberEdge, desiredOwner]);

    const audit = auditManagedViewProjection(source, desired);
    expect(audit.entries.map((entry) => entry.delta.verb)).toEqual([
      "link",
      "unlink",
    ]);
    expect(audit.entries.every((entry) => entry.subject.kind === "edge")).toBe(
      true,
    );
    expect(
      audit.entries.flatMap((entry) => entry.suppressions.map((s) => s.side)),
    ).toEqual(["desired", "source", "desired", "source"]);
  });

  test("reference-only on one side attributes edges present only on the other side", () => {
    const publicSchema = schema("public");
    const pgmq = extension("pgmq");
    const queue = table("public", "q_jobs");
    const owner: StableId = { kind: "role", name: "queue_owner" };
    const memberEdge: DependencyEdge = {
      from: queue,
      to: pgmq,
      kind: "memberOfExtension",
    };
    const ownerEdge: DependencyEdge = {
      from: queue,
      to: owner,
      kind: "owner",
    };
    const facts = [
      fact(publicSchema),
      fact(pgmq),
      fact(queue, {}, publicSchema),
      fact(owner),
    ];
    const source = buildFactBase(facts, [memberEdge]);
    const desired = buildFactBase(facts, [ownerEdge]);

    const audit = auditManagedViewProjection(source, desired);
    expect(audit.entries.map((entry) => entry.delta)).toEqual([
      { verb: "link", edge: ownerEdge },
      { verb: "unlink", edge: memberEdge },
    ]);
    expect(audit.entries[0]?.suppressions).toEqual([
      {
        side: "source",
        stage: "referenceOnly",
        reasonCode: "reference-only.extension-member",
        classification: "acknowledged",
      },
    ]);
  });

  test("baseline suppression stays visible when only one side matches it", () => {
    const publicSchema = schema("public");
    const userTable = table("public", "accounts");
    const source = buildFactBase(
      [fact(publicSchema), fact(userTable, { version: 1 }, publicSchema)],
      [],
    );
    const desired = buildFactBase(
      [fact(publicSchema), fact(userTable, { version: 2 }, publicSchema)],
      [],
    );
    const baseline = buildFactBase(
      [fact(publicSchema), fact(userTable, { version: 1 }, publicSchema)],
      [],
    );

    const audit = auditManagedViewProjection(source, desired, { baseline });
    expect(audit.entries[0]).toMatchObject({
      delta: { verb: "set", id: userTable, attr: "version" },
      classification: "acknowledged",
      suppressions: [
        {
          side: "source",
          stage: "baseline",
          reasonCode: "baseline.identical-state",
          classification: "acknowledged",
        },
      ],
    });
    expect(audit.summary.baseline).toBe(1);
  });

  test("capability restriction attributes a differing FDW ACL", () => {
    const wrapper: StableId = { kind: "fdw", name: "remote" };
    const acl: StableId = { kind: "acl", target: wrapper, grantee: "reader" };
    const source = buildFactBase(
      [fact(wrapper), fact(acl, { privileges: ["USAGE"] })],
      [],
    );
    const desired = buildFactBase(
      [fact(wrapper), fact(acl, { privileges: [] })],
      [],
    );
    const capability: ApplierCapability = {
      role: "app",
      isSuperuser: false,
      memberOf: [],
    };

    expect(
      auditManagedViewProjection(source, desired, { capability }).entries[0],
    ).toMatchObject({
      subject: { kind: "fact", id: acl },
      classification: "acknowledged",
      suppressions: [
        {
          side: "desired",
          stage: "capability",
          reasonCode: "capability.fdw-acl",
        },
        {
          side: "source",
          stage: "capability",
          reasonCode: "capability.fdw-acl",
        },
      ],
    });
  });

  test("Supabase's intentional FDW ACL exclusion is acknowledged", () => {
    const wrapper: StableId = { kind: "fdw", name: "remote" };
    const acl: StableId = { kind: "acl", target: wrapper, grantee: "reader" };
    const source = buildFactBase(
      [fact(wrapper), fact(acl, { privileges: ["USAGE"] })],
      [],
    );
    const desired = buildFactBase(
      [fact(wrapper), fact(acl, { privileges: [] })],
      [],
    );

    expect(
      auditManagedViewProjection(source, desired, { policy: supabasePolicy })
        .entries[0],
    ).toMatchObject({
      subject: { kind: "fact", id: acl },
      classification: "acknowledged",
      suppressions: [
        {
          side: "desired",
          stage: "policyScopeRule",
          reasonCode: "supabase.fdw-acl",
          classification: "acknowledged",
        },
        {
          side: "source",
          stage: "policyScopeRule",
          reasonCode: "supabase.fdw-acl",
          classification: "acknowledged",
        },
      ],
    });
  });

  test("database management scope attributes cluster-object state", () => {
    const appRole: StableId = { kind: "role", name: "app_role" };
    const source = buildFactBase([fact(appRole, { login: false })], []);
    const desired = buildFactBase([fact(appRole, { login: true })], []);

    expect(
      auditManagedViewProjection(source, desired, { scope: "database" })
        .entries[0],
    ).toMatchObject({
      subject: { kind: "fact", id: appRole },
      classification: "acknowledged",
      suppressions: [
        {
          side: "desired",
          stage: "managementScope",
          reasonCode: "management-scope.database.cluster-object",
        },
        {
          side: "source",
          stage: "managementScope",
          reasonCode: "management-scope.database.cluster-object",
        },
      ],
    });
  });

  test("database default-owner edge suppression has its own reason", () => {
    const appSchema = schema("app");
    const appRole: StableId = { kind: "role", name: "app_owner" };
    const ownerEdge: DependencyEdge = {
      from: appSchema,
      to: appRole,
      kind: "owner",
    };
    const source = buildFactBase([fact(appSchema), fact(appRole)], [ownerEdge]);
    const desired = buildFactBase([fact(appSchema), fact(appRole)], []);

    const audit = auditManagedViewProjection(source, desired, {
      scope: "database",
      defaultOwner: "app_owner",
    });
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]?.delta).toEqual({
      verb: "unlink",
      edge: ownerEdge,
    });
    expect(audit.entries[0]?.suppressions).toEqual([
      {
        side: "source",
        stage: "managementScope",
        reasonCode: "management-scope.database.default-owner",
        classification: "acknowledged",
      },
    ]);
  });

  test("assumed-schema state is attributed to reference-only projection", () => {
    const authSchema = schema("auth");
    const authTable = table("auth", "users");
    const source = buildFactBase(
      [fact(authSchema), fact(authTable, { version: 1 }, authSchema)],
      [],
    );
    const desired = buildFactBase(
      [fact(authSchema), fact(authTable, { version: 2 }, authSchema)],
      [],
    );
    const policy: Policy = {
      id: "assumed-auth",
      assumedSchemas: ["auth"],
      filter: [
        {
          match: { schema: "auth" },
          action: "exclude",
          audit: { reasonCode: "platform.auth" },
        },
      ],
    };

    expect(
      auditManagedViewProjection(source, desired, { policy }).entries[0],
    ).toMatchObject({
      subject: { kind: "fact", id: authTable },
      classification: "acknowledged",
      suppressions: [
        {
          side: "desired",
          stage: "referenceOnly",
          reasonCode: "reference-only.assumed-schema:platform.auth",
        },
        {
          side: "source",
          stage: "referenceOnly",
          reasonCode: "reference-only.assumed-schema:platform.auth",
        },
      ],
    });
  });

  test("assumed-schema reference-only projection preserves an explicit suspicious override", () => {
    const authSchema = schema("auth");
    const authTable = table("auth", "users");
    const source = buildFactBase(
      [fact(authSchema), fact(authTable, { version: 1 }, authSchema)],
      [],
    );
    const desired = buildFactBase(
      [fact(authSchema), fact(authTable, { version: 2 }, authSchema)],
      [],
    );
    const policy: Policy = {
      id: "assumed-auth",
      assumedSchemas: ["auth"],
      filter: [
        {
          match: { schema: "auth" },
          action: "exclude",
          audit: {
            reasonCode: "platform.auth",
            classification: "suspicious",
          },
        },
      ],
    };

    const audit = auditManagedViewProjection(source, desired, { policy });
    expect(audit.entries[0]).toMatchObject({
      subject: { kind: "fact", id: authTable },
      classification: "suspicious",
      suppressions: [
        {
          side: "desired",
          stage: "referenceOnly",
          reasonCode: "reference-only.assumed-schema:platform.auth",
          classification: "suspicious",
        },
        {
          side: "source",
          stage: "referenceOnly",
          reasonCode: "reference-only.assumed-schema:platform.auth",
          classification: "suspicious",
        },
      ],
    });
    expect(audit.summary).toMatchObject({
      suspicious: 1,
      acknowledged: 0,
    });
  });

  test("plan artifact carries the audit computed from the raw fact bases", () => {
    const publicSchema = schema("public");
    const userTable = table("public", "accounts");
    const source = buildFactBase([fact(publicSchema)], []);
    const desired = buildFactBase(
      [fact(publicSchema), fact(userTable, {}, publicSchema)],
      [],
    );
    const policy: Policy = {
      id: "generic",
      filter: [{ match: { kind: "table" }, action: "exclude" }],
    };

    const thePlan = plan(source, desired, { policy });
    expect(thePlan.projectionAudit?.summary).toEqual({
      total: 1,
      suspicious: 1,
      acknowledged: 0,
      baseline: 0,
    });
  });
});
