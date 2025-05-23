import type { PGClient } from "../types.ts";

export type SequenceDefinition = {
  schema_name: string;
  sequence_name: string;
  data_type: string;
  start_value: number;
  minimum_value: number | null;
  maximum_value: number | null;
  increment: number;
  cycle: boolean;
  cache_size: number;
};

export async function extractSequenceDefinitions(
  db: PGClient,
): Promise<SequenceDefinition[]> {
  const sequences = await db.sql<SequenceDefinition>`
    select 
      n.nspname as schema_name,
      c.relname as sequence_name,
      pg_catalog.format_type(s.seqtypid, null) as data_type,
      s.seqstart as start_value,
      s.seqmin as minimum_value,
      s.seqmax as maximum_value,
      s.seqincrement as increment,
      s.seqcycle as cycle,
      s.seqcache as cache_size
    from pg_sequence s
    join pg_class c on c.oid = s.seqrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname not in ('pg_catalog', 'information_schema')
      and n.nspname not like 'pg_%'
    order by n.nspname, c.relname;
  `;

  return sequences.rows;
}

export function serializeSequenceDefinitions(
  sequences: SequenceDefinition[],
): string {
  if (sequences.length === 0) {
    return "";
  }

  const statements = sequences.map((seq) => {
    const parts: string[] = [];

    parts.push(`create sequence ${seq.schema_name}.${seq.sequence_name}`);
    parts.push(`as ${seq.data_type}`);
    parts.push(`start with ${seq.start_value}`);
    parts.push(`increment by ${seq.increment}`);

    if (seq.minimum_value === null) {
      parts.push("no minvalue");
    } else {
      parts.push(`minvalue ${seq.minimum_value}`);
    }

    if (seq.maximum_value === null) {
      parts.push("no maxvalue");
    } else {
      parts.push(`maxvalue ${seq.maximum_value}`);
    }

    parts.push(`cache ${seq.cache_size}`);

    if (seq.cycle) {
      parts.push("cycle");
    } else {
      parts.push("no cycle");
    }

    return parts.join("\n  ");
  });

  return `${statements.join(";\n\n")};`;
}
