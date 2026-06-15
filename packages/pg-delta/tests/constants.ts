export const POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG = {
  15: "15.14.1.107",
  17: "17.6.1.107",
} as const;

export const POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG = {
  14: "14.23-alpine",
  15: "15.14-alpine",
  17: "17.6-alpine",
  18: "18.3-alpine",
} as const;

export type PostgresVersion =
  keyof typeof POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG;
export type SupabasePostgresVersion =
  keyof typeof POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG;

// Alpine images define the default pg-delta integration matrix because they are
// available for PostgreSQL 18, while Supabase test images are only available
// for a subset of supported versions.
export const POSTGRES_VERSIONS = process.env.PGDELTA_TEST_POSTGRES_VERSIONS
  ? process.env.PGDELTA_TEST_POSTGRES_VERSIONS.split(",").map(
      (v) => Number(v) as PostgresVersion,
    )
  : (Object.keys(POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG).map(
      Number,
    ) as PostgresVersion[]);

export const SUPABASE_POSTGRES_VERSIONS = POSTGRES_VERSIONS.filter(
  (version): version is SupabasePostgresVersion =>
    version in POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG,
);
