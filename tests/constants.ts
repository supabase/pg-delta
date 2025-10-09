export const POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG = {
  15: "15.14.1.018",
  17: "17.6.1.018",
};

export const POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG = {
  15: "15.14-alpine",
  17: "17.6-alpine",
};

export type PostgresVersion =
  keyof typeof POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG;

export const POSTGRES_VERSIONS = process.env.TEST_POSTGRES_VERSIONS
  ? process.env.TEST_POSTGRES_VERSIONS.split(",").map(
      (v) => Number(v) as PostgresVersion,
    )
  : (Object.keys(POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG).map(
      Number,
    ) as PostgresVersion[]);

export const DEBUG = process.env.DEBUG;
