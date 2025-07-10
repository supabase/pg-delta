export const POSTGRES_VERSION_TO_DOCKER_TAG = {
  15: "15.8.1.111",
  17: "17.4.1.054",
};

export type PostgresVersion = keyof typeof POSTGRES_VERSION_TO_DOCKER_TAG;

export const POSTGRES_VERSIONS = process.env.TEST_POSTGRES_VERSIONS
  ? process.env.TEST_POSTGRES_VERSIONS.split(",").map(
      (v) => Number(v) as PostgresVersion,
    )
  : (Object.keys(POSTGRES_VERSION_TO_DOCKER_TAG).map(
      Number,
    ) as PostgresVersion[]);
