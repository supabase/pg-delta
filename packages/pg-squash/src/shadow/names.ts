let counter = 0;

/** Cluster-unique database name (quoted later). Postgres identifiers cap at 63 bytes. */
export const uniqueDatabaseName = (prefix = "sq"): string => {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${counter}_${rand}`.slice(0, 63);
};
