/** Quote a PostgreSQL identifier. */
export const qid = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/** Quote a string literal. */
export const lit = (value: string): string =>
  `'${value.replaceAll("'", "''")}'`;
