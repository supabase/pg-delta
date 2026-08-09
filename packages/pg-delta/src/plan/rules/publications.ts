/** Rule definitions for publications, their member facts, and subscriptions. */
import type { Fact } from "../../core/fact.ts";
import { SUBSCRIPTION_CONNINFO_PLACEHOLDER } from "../../extract/sensitive-options.ts";
import { lit, qid, rel } from "../render.ts";
import type { ActionSpec, KindRules } from "../rules.ts";
import { p, publicationObjects, publicationRelClause, str } from "./helpers.ts";

export const publicationRules: Record<string, KindRules> = {
  publication: {
    weight: 18,
    cascadesToChildren: true,
    create: (fact, view) => {
      const name = qid((fact.id as { name: string }).name);
      const objects = publicationObjects(fact, view);
      let sql = `CREATE PUBLICATION ${name}`;
      // FOR ALL TABLES has no member facts; otherwise inline the member
      // facts (delta-set) so their standalone ADD actions are skipped
      if (p(fact, "allTables")) sql += ` FOR ALL TABLES`;
      else if (objects.clauses.length > 0)
        sql += ` FOR ${objects.clauses.join(", ")}`;
      const withParts = [
        `publish = ${lit(((p(fact, "publish") as string[]) ?? []).join(", "))}`,
      ];
      if (p(fact, "viaRoot"))
        withParts.push(`publish_via_partition_root = true`);
      sql += ` WITH (${withParts.join(", ")})`;
      return [
        {
          sql,
          ...(objects.consumes.length > 0
            ? { consumes: objects.consumes }
            : {}),
          ...(objects.produced.length > 0
            ? { alsoProduces: objects.produced }
            : {}),
        },
      ];
    },
    drop: (fact) => ({
      sql: `DROP PUBLICATION ${qid((fact.id as { name: string }).name)}`,
    }),
    ownerAlterPrefix: (fact) =>
      `ALTER PUBLICATION ${qid((fact.id as { name: string }).name)}`,
    attributes: {
      publish: {
        alter: (fact, _from, to) => ({
          sql: `ALTER PUBLICATION ${qid((fact.id as { name: string }).name)} SET (publish = ${lit(((to as string[] | null) ?? []).join(", "))})`,
        }),
      },
      viaRoot: {
        alter: (fact, _from, to) => ({
          sql: `ALTER PUBLICATION ${qid((fact.id as { name: string }).name)} SET (publish_via_partition_root = ${to ? "true" : "false"})`,
        }),
      },
      allTables: "replace",
    },
  },

  // a published table is its own fact: ADD/DROP TABLE incrementally. A
  // column-list or WHERE change has no in-place form, so those attributes
  // replace (DROP TABLE + re-ADD with the new shape). On a fresh
  // publication the member is inlined into CREATE PUBLICATION (see above).
  publicationRel: {
    weight: 18,
    create: (fact) => {
      const id = fact.id as {
        publication: string;
        schema: string;
        table: string;
      };
      return [
        {
          sql: `ALTER PUBLICATION ${qid(id.publication)} ADD ${publicationRelClause(fact)}`,
          consumes: [{ kind: "table", schema: id.schema, name: id.table }],
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as {
        publication: string;
        schema: string;
        table: string;
      };
      return {
        sql: `ALTER PUBLICATION ${qid(id.publication)} DROP TABLE ${rel(id.schema, id.table)}`,
      };
    },
    attributes: {
      columns: "replace",
      where: "replace",
    },
  },

  // a published schema (FOR TABLES IN SCHEMA, PG15+) as its own fact
  publicationSchema: {
    weight: 18,
    create: (fact) => {
      const id = fact.id as { publication: string; schema: string };
      return [
        {
          sql: `ALTER PUBLICATION ${qid(id.publication)} ADD TABLES IN SCHEMA ${qid(id.schema)}`,
          consumes: [{ kind: "schema", name: id.schema }],
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as { publication: string; schema: string };
      return {
        sql: `ALTER PUBLICATION ${qid(id.publication)} DROP TABLES IN SCHEMA ${qid(id.schema)}`,
      };
    },
    attributes: {},
  },

  subscription: {
    weight: 23,
    create: (fact) => {
      const name = qid((fact.id as { name: string }).name);
      const publications = ((p(fact, "publications") as string[]) ?? [])
        .map((pub) => qid(pub))
        .join(", ");
      const slot = p(fact, "slotName");
      const conninfo = str(p(fact, "conninfo"));
      // A subscription rebuilt from a REDACTED extraction carries a placeholder
      // conninfo — its real host/credentials are unrecoverable. Emitting the
      // ENABLE follow-up would start a replication worker against that bogus
      // host, which fails asynchronously forever while catalog convergence still
      // passes. When the desired state is ENABLED, keep it disabled instead and
      // tell the operator to set a real connection and enable it by hand. A
      // disabled subscription is unaffected (its create never emits ENABLE), and
      // unredacted creates are unchanged.
      const redacted = conninfo === SUBSCRIPTION_CONNINFO_PLACEHOLDER;
      const wantEnabled = Boolean(p(fact, "enabled"));
      const suppressEnable = redacted && wantEnabled;
      const withParts = [
        "connect = false",
        "enabled = false",
        `slot_name = ${slot == null ? "NONE" : lit(str(slot))}`,
        // every captured option is reproduced at create time: a fresh
        // subscription has no prior fact, so the per-attribute ALTER rules
        // below never fire for it — only the WITH clause carries the options.
        ...subscriptionOptionParts(fact),
      ];
      const note = suppressEnable
        ? `-- pg-delta: subscription ${name} was exported with REDACTED connection info;\n` +
          `-- its CONNECTION below is a placeholder. Set the real connection string and run\n` +
          `-- ALTER SUBSCRIPTION ${name} ENABLE; manually before it will replicate.\n`
        : "";
      const specs: ActionSpec[] = [
        {
          sql: `${note}CREATE SUBSCRIPTION ${name} CONNECTION ${lit(conninfo)} PUBLICATION ${publications} WITH (${withParts.join(", ")})`,
        },
      ];
      if (wantEnabled && !suppressEnable) {
        specs.push({ sql: `ALTER SUBSCRIPTION ${name} ENABLE` });
      }
      return specs;
    },
    drop: (fact) => ({
      sql: `DROP SUBSCRIPTION ${qid((fact.id as { name: string }).name)}`,
      // with an associated replication slot the drop cannot run inside a
      // transaction block; slotless subscriptions drop transactionally
      ...(p(fact, "slotName") == null
        ? {}
        : { transactionality: "nonTransactional" as const }),
    }),
    ownerAlterPrefix: (fact) =>
      `ALTER SUBSCRIPTION ${qid((fact.id as { name: string }).name)}`,
    attributes: {
      enabled: {
        alter: (fact, _from, to) => ({
          sql: `ALTER SUBSCRIPTION ${qid((fact.id as { name: string }).name)} ${to ? "ENABLE" : "DISABLE"}`,
        }),
      },
      publications: {
        alter: (fact, _from, to) => ({
          sql: `ALTER SUBSCRIPTION ${qid((fact.id as { name: string }).name)} SET PUBLICATION ${((to as string[] | null) ?? []).map((pub) => qid(pub)).join(", ")} WITH (refresh = false)`,
        }),
      },
      conninfo: {
        alter: (fact, _from, to) => ({
          sql: `ALTER SUBSCRIPTION ${qid((fact.id as { name: string }).name)} CONNECTION ${lit(str(to))}`,
        }),
      },
      slotName: {
        alter: (fact, _from, to) => ({
          sql: `ALTER SUBSCRIPTION ${qid((fact.id as { name: string }).name)} SET (slot_name = ${to == null ? "NONE" : lit(str(to))})`,
        }),
      },
      // in-place ALTER … SET (opt = …) for the settable replication options
      binary: subscriptionBoolSet("binary"),
      streaming: subscriptionStringSet("streaming"),
      synchronousCommit: subscriptionStringSet("synchronous_commit"),
      disableOnError: subscriptionBoolSet("disable_on_error"),
      runAsOwner: subscriptionBoolSet("run_as_owner"),
      origin: subscriptionStringSet("origin"),
      // `two_phase` must NOT be classified "replace": drop+recreate runs
      // DROP SUBSCRIPTION, which drops the publisher's replication slot (it
      // connects via the catalog conninfo), and the recreate uses
      // `connect = false, slot_name = <name>` — it does not recreate that
      // remote slot, so the catalog converges while replication is silently
      // broken (and the DROP fails outright when the publisher is unreachable).
      // PG18+ added `ALTER SUBSCRIPTION … SET (two_phase)`, allowed only on a
      // DISABLED subscription, so route through DISABLE → SET → (re-)ENABLE. On
      // PG < 18 there is no in-place form (`two_phase` is rejected as an
      // unrecognized parameter) and an automatic recreate is destructive, so
      // fail loudly and let the operator recreate the subscription deliberately.
      twoPhase: {
        alter: (fact, _from, to) => {
          const name = subscriptionName(fact);
          const major = Number(p(fact, "_serverMajor") ?? 0);
          if (major < 18) {
            throw new Error(
              `subscription ${name}: changing two_phase requires PostgreSQL 18+ ` +
                `(ALTER SUBSCRIPTION … SET (two_phase)). On PG${major || " < 18"} ` +
                `recreate the subscription manually — an automatic drop/recreate ` +
                `would drop the publisher's replication slot and break replication.`,
            );
          }
          // two_phase is settable only while the subscription is disabled; a
          // DISABLE on an already-disabled subscription is a harmless no-op.
          // These three specs tie on subject id and stay in emission order.
          const specs: ActionSpec[] = [
            { sql: `ALTER SUBSCRIPTION ${name} DISABLE` },
            {
              sql: `ALTER SUBSCRIPTION ${name} SET (two_phase = ${to ? "true" : "false"})`,
            },
          ];
          if (p(fact, "enabled")) {
            specs.push({ sql: `ALTER SUBSCRIPTION ${name} ENABLE` });
          }
          return specs;
        },
      },
    },
  },
};

/** `CREATE SUBSCRIPTION … WITH (…)` fragments for every non-null option.
 *  null marks an option the server version does not expose (run_as_owner /
 *  origin are PG16+), so it is simply omitted. */
function subscriptionOptionParts(fact: Fact): string[] {
  const parts: string[] = [];
  const bool = (key: string, opt: string): void => {
    const v = p(fact, key);
    if (v != null) parts.push(`${opt} = ${v ? "true" : "false"}`);
  };
  const text = (key: string, opt: string): void => {
    const v = p(fact, key);
    if (v != null) parts.push(`${opt} = ${lit(str(v))}`);
  };
  bool("binary", "binary");
  text("streaming", "streaming");
  text("synchronousCommit", "synchronous_commit");
  bool("disableOnError", "disable_on_error");
  bool("runAsOwner", "run_as_owner");
  bool("twoPhase", "two_phase");
  text("origin", "origin");
  return parts;
}

function subscriptionName(fact: Fact): string {
  return qid((fact.id as { name: string }).name);
}

/** boolean ALTER … SET (opt = true|false). */
function subscriptionBoolSet(opt: string): KindRules["attributes"][string] {
  return {
    alter: (fact, _from, to) => ({
      sql: `ALTER SUBSCRIPTION ${subscriptionName(fact)} SET (${opt} = ${to ? "true" : "false"})`,
    }),
  };
}

/** quoted-string ALTER … SET (opt = '…'). */
function subscriptionStringSet(opt: string): KindRules["attributes"][string] {
  return {
    alter: (fact, _from, to) => ({
      sql: `ALTER SUBSCRIPTION ${subscriptionName(fact)} SET (${opt} = ${lit(str(to))})`,
    }),
  };
}
