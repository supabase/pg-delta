/**
 * PostgreSQL connection configuration with custom type handlers.
 */

import type postgres from "postgres";

/**
 * Custom type handler for specific corner cases.
 */
export const postgresConfig: postgres.Options<
  Record<string, postgres.PostgresType>
> = {
  types: {
    int2vector: {
      // The pg_types oid for int2vector (22 is the OID for int2vector)
      to: 22,
      // Array of pg_types oids to handle when parsing values coming from the db
      from: [22],
      // Parse int2vector from string format "1 2 3" to array [1, 2, 3]
      parse: (value: string) => {
        if (!value || value === "") return [];
        return value
          .split(" ")
          .map(Number)
          .filter((n) => !Number.isNaN(n));
      },
      // Serialize array back to int2vector format if needed
      serialize: (value: number[]) => {
        if (!Array.isArray(value)) return "";
        return value.join(" ");
      },
    },
    // Handle bigint values from PostgreSQL
    bigint: {
      // The pg_types oid for bigint (20 is the OID for int8/bigint)
      to: 20,
      // Array of pg_types oids to handle when parsing values coming from the db
      from: [20],
      // Parse bigint string to JavaScript BigInt
      parse: (value: string) => {
        return BigInt(value);
      },
      // Serialize BigInt back to string for PostgreSQL
      serialize: (value: bigint) => {
        return value.toString();
      },
    },
  },
};
