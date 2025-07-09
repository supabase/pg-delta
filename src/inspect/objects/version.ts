import type { Sql } from "postgres";

interface InspectedVersion {
  version: number;
}

export async function inspectVersion(sql: Sql): Promise<InspectedVersion> {
  const [result] = await sql<InspectedVersion[]>`
    select current_setting('server_version_num')::int as version;
  `;

  return result;
}
