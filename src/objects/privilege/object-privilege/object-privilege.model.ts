import type { Sql } from "postgres";
import z from "zod";
import { BasePgModel } from "../../base.model.ts";

const objectPrivilegeRowSchema = z.object({
  target_kind: z.enum([
    "TABLE",
    "VIEW",
    "MATERIALIZED VIEW",
    "SEQUENCE",
    "SCHEMA",
    "LANGUAGE",
    "TYPE",
    "DOMAIN",
    "ROUTINE",
  ]),
  schema: z.string().nullable(),
  name: z.string(),
  arg_types: z.array(z.string()).nullable(),
  target_stable_id: z.string(),
  grantee: z.string(),
  privilege_type: z.string(),
  is_grantable: z.boolean(),
});

type ObjectPrivilegeRow = z.infer<typeof objectPrivilegeRowSchema>;

const objectPrivilegeSetSchema = z.object({
  target_kind: objectPrivilegeRowSchema.shape.target_kind,
  schema: z.string().nullable(),
  name: z.string(),
  arg_types: z.array(z.string()).nullable(),
  target_stable_id: z.string(),
  grantee: z.string(),
  privileges: z.array(
    z.object({ privilege: z.string(), grantable: z.boolean() }),
  ),
});

type ObjectPrivilegeSetProps = z.infer<typeof objectPrivilegeSetSchema>;

export class ObjectPrivilegeSet extends BasePgModel {
  public readonly target_kind: ObjectPrivilegeSetProps["target_kind"];
  public readonly schema: ObjectPrivilegeSetProps["schema"];
  public readonly name: ObjectPrivilegeSetProps["name"];
  public readonly arg_types: ObjectPrivilegeSetProps["arg_types"];
  public readonly target_stable_id: ObjectPrivilegeSetProps["target_stable_id"];
  public readonly grantee: ObjectPrivilegeSetProps["grantee"];
  public readonly privileges: ObjectPrivilegeSetProps["privileges"];

  constructor(props: ObjectPrivilegeSetProps) {
    super();
    this.target_kind = props.target_kind;
    this.schema = props.schema;
    this.name = props.name;
    this.arg_types = props.arg_types;
    this.target_stable_id = props.target_stable_id;
    this.grantee = props.grantee;
    // Ensure stable ordering for deep equality
    this.privileges = [...props.privileges].sort((a, b) => {
      if (a.privilege === b.privilege) {
        return Number(a.grantable) - Number(b.grantable);
      }
      return a.privilege.localeCompare(b.privilege);
    });
  }

  get stableId(): `acl:${string}` {
    return `acl:${this.target_stable_id}::grantee:${this.grantee}`;
  }

  get identityFields() {
    return {
      target_stable_id: this.target_stable_id,
      grantee: this.grantee,
    };
  }

  get dataFields() {
    return {
      target_kind: this.target_kind,
      schema: this.schema,
      name: this.name,
      arg_types: this.arg_types,
      privileges: this.privileges,
    };
  }
}

function mapRelkindToTarget(relkind: string): {
  target_kind: ObjectPrivilegeSetProps["target_kind"];
  target_stable_id_prefix: string;
} | null {
  switch (relkind) {
    case "r": // table
    case "p": // partitioned table
      return { target_kind: "TABLE", target_stable_id_prefix: "table:" };
    case "v":
      return { target_kind: "VIEW", target_stable_id_prefix: "view:" };
    case "m":
      return {
        target_kind: "MATERIALIZED VIEW",
        target_stable_id_prefix: "materializedView:",
      };
    case "S":
      return { target_kind: "SEQUENCE", target_stable_id_prefix: "sequence:" };
    default:
      return null;
  }
}

function mapTyptypeToTarget(typtype: string): {
  target_kind: ObjectPrivilegeSetProps["target_kind"];
  stable_prefix: string;
} | null {
  switch (typtype) {
    case "d":
      return { target_kind: "DOMAIN", stable_prefix: "domain:" };
    case "e":
      return { target_kind: "TYPE", stable_prefix: "enum:" };
    case "r":
      return { target_kind: "TYPE", stable_prefix: "range:" };
    case "c":
      return { target_kind: "TYPE", stable_prefix: "compositeType:" };
    default:
      return null;
  }
}

export async function extractObjectPrivileges(
  sql: Sql,
): Promise<ObjectPrivilegeSet[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;

    // Relations (tables, views, matviews, sequences)
    const relationRows = await sql`
with extension_oids as (
  select objid from pg_depend d
  where d.refclassid = 'pg_extension'::regclass and d.classid = 'pg_class'::regclass
)
select
  c.relkind,
  c.relnamespace::regnamespace::text as schema,
  quote_ident(c.relname) as name,
  case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee,
  x.privilege_type,
  x.is_grantable
from pg_catalog.pg_class c
join lateral aclexplode(c.relacl) as x(grantor, grantee, privilege_type, is_grantable) on true
left join extension_oids e on e.objid = c.oid
where c.relkind in ('r','p','v','m','S')
  and not c.relnamespace::regnamespace::text like any(array['pg\\_%','information\\_schema'])
  and e.objid is null
order by 1, 2, 3, 4, 5;
    `;

    // Schemas
    const schemaRows = await sql`
with extension_oids as (
  select objid from pg_depend d
  where d.refclassid = 'pg_extension'::regclass and d.classid = 'pg_namespace'::regclass
)
select
  quote_ident(n.nspname) as name,
  case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee,
  x.privilege_type,
  x.is_grantable
from pg_catalog.pg_namespace n
join lateral aclexplode(n.nspacl) as x(grantor, grantee, privilege_type, is_grantable) on true
left join extension_oids e on e.objid = n.oid
where not n.nspname like any(array['pg\\_%','information\\_schema'])
  and e.objid is null
order by 1, 2, 3;
    `;

    // Languages (exclude internal)
    const languageRows = await sql`
with extension_oids as (
  select objid from pg_depend d
  where d.refclassid = 'pg_extension'::regclass and d.classid = 'pg_language'::regclass
)
select
  quote_ident(l.lanname) as name,
  case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee,
  x.privilege_type,
  x.is_grantable
from pg_catalog.pg_language l
join lateral aclexplode(l.lanacl) as x(grantor, grantee, privilege_type, is_grantable) on true
left join extension_oids e on e.objid = l.oid
where l.lanname not in ('internal','c')
order by 1, 2, 3;
    `;

    // Routines (functions/procedures/aggregates/windows) → use ROUTINE
    const routineRows = await sql`
with extension_oids as (
  select objid from pg_depend d
  where d.refclassid = 'pg_extension'::regclass and d.classid = 'pg_proc'::regclass
)
select
  p.pronamespace::regnamespace::text as schema,
  quote_ident(p.proname) as name,
  array(select format_type(oid, null) from unnest(p.proargtypes) as oid) as arg_types,
  case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee,
  x.privilege_type,
  x.is_grantable
from pg_catalog.pg_proc p
join lateral aclexplode(p.proacl) as x(grantor, grantee, privilege_type, is_grantable) on true
left join extension_oids e on e.objid = p.oid
join pg_language l on l.oid = p.prolang
where not p.pronamespace::regnamespace::text like any(array['pg\\_%','information\\_schema'])
  and e.objid is null
  and l.lanname not in ('c','internal')
order by 1, 2, 3, 4;
    `;

    // Types and domains
    const typeRows = await sql`
with extension_oids as (
  select objid from pg_depend d
  where d.refclassid = 'pg_extension'::regclass and d.classid = 'pg_type'::regclass
)
select
  t.typtype,
  t.typnamespace::regnamespace::text as schema,
  quote_ident(t.typname) as name,
  case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee,
  x.privilege_type,
  x.is_grantable
from pg_catalog.pg_type t
join lateral aclexplode(t.typacl) as x(grantor, grantee, privilege_type, is_grantable) on true
left join extension_oids e on e.objid = t.oid
where not t.typnamespace::regnamespace::text like any(array['pg\\_%','information\\_schema'])
  and e.objid is null
  and t.typtype in ('d','e','r','c')
order by 1, 2, 3, 4;
    `;

    const rows: ObjectPrivilegeRow[] = [];

    for (const r of relationRows as unknown[]) {
      // biome-ignore lint/suspicious/noExplicitAny: upstream driver returns any
      const rr = r as any;
      const map = mapRelkindToTarget(rr.relkind as string);
      if (!map) continue;
      const target_stable_id = `${map.target_stable_id_prefix}${rr.schema}.${rr.name}`;
      rows.push(
        objectPrivilegeRowSchema.parse({
          target_kind: map.target_kind,
          schema: rr.schema,
          name: rr.name,
          arg_types: null,
          target_stable_id,
          grantee: rr.grantee,
          privilege_type: rr.privilege_type,
          is_grantable: rr.is_grantable,
        }),
      );
    }

    for (const sRow of schemaRows as unknown[]) {
      // biome-ignore lint/suspicious/noExplicitAny: upstream driver returns any
      const s = sRow as any;
      const target_stable_id = `schema:${s.name}`;
      rows.push(
        objectPrivilegeRowSchema.parse({
          target_kind: "SCHEMA",
          schema: null,
          name: s.name,
          arg_types: null,
          target_stable_id,
          grantee: s.grantee,
          privilege_type: s.privilege_type,
          is_grantable: s.is_grantable,
        }),
      );
    }

    for (const lRow of languageRows as unknown[]) {
      // biome-ignore lint/suspicious/noExplicitAny: upstream driver returns any
      const l = lRow as any;
      const target_stable_id = `language:${l.name}`;
      rows.push(
        objectPrivilegeRowSchema.parse({
          target_kind: "LANGUAGE",
          schema: null,
          name: l.name,
          arg_types: null,
          target_stable_id,
          grantee: l.grantee,
          privilege_type: l.privilege_type,
          is_grantable: l.is_grantable,
        }),
      );
    }

    for (const pRow of routineRows as unknown[]) {
      // biome-ignore lint/suspicious/noExplicitAny: upstream driver returns any
      const p = pRow as any;
      const args: string[] | null = p.arg_types ?? null;
      const argsPart = args && args.length > 0 ? `(${args.join(",")})` : `()`;
      const target_stable_id = `procedure:${p.schema}.${p.name}${argsPart}`;
      rows.push(
        objectPrivilegeRowSchema.parse({
          target_kind: "ROUTINE",
          schema: p.schema,
          name: p.name,
          arg_types: args,
          target_stable_id,
          grantee: p.grantee,
          privilege_type: p.privilege_type,
          is_grantable: p.is_grantable,
        }),
      );
    }

    for (const tRow of typeRows as unknown[]) {
      // biome-ignore lint/suspicious/noExplicitAny: upstream driver returns any
      const t = tRow as any;
      const mapped = mapTyptypeToTarget(t.typtype as string);
      if (!mapped) continue;
      const target_stable_id = `${mapped.stable_prefix}${t.schema}.${t.name}`;
      rows.push(
        objectPrivilegeRowSchema.parse({
          target_kind: mapped.target_kind,
          schema: t.schema,
          name: t.name,
          arg_types: null,
          target_stable_id,
          grantee: t.grantee,
          privilege_type: t.privilege_type,
          is_grantable: t.is_grantable,
        }),
      );
    }

    // Group into sets per (target_stable_id, grantee)
    const grouped = new Map<string, ObjectPrivilegeSetProps>();
    for (const row of rows) {
      const key = `${row.target_stable_id}::${row.grantee}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          target_kind: row.target_kind,
          schema: row.schema,
          name: row.name,
          arg_types: row.arg_types,
          target_stable_id: row.target_stable_id,
          grantee: row.grantee,
          privileges: [],
        });
      }
      const entry = grouped.get(key);
      if (entry) {
        entry.privileges.push({
          privilege: row.privilege_type,
          grantable: row.is_grantable,
        });
      }
    }

    return [...grouped.values()].map(
      (g) => new ObjectPrivilegeSet(objectPrivilegeSetSchema.parse(g)),
    );
  });
}
