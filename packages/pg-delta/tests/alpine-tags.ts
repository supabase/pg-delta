import type { PostgresVersion } from "./constants.ts";

/**
 * Maps a PostgreSQL major version to the Alpine base tag that ships the
 * matching `postgresql<PG_MAJOR>-dev` package. Needed because a given
 * alpine release typically only carries the current pg-dev headers.
 *
 * Keep in sync with the matrix in `.github/workflows/tests.yml`
 * (`pg-delta-build-test-images` job) — CI uses these same values to
 * build the prebuilt `pg-delta-test:<major>` image and push it to GHCR
 * so test shards can pull instead of rebuilding locally.
 *
 * This file is hashed alone (with `dummy-seclabel.Dockerfile`) for the
 * prebuilt image tag so edits to `postgres-alpine.ts` do not invalidate
 * the cache when Alpine tags are unchanged.
 */
export const ALPINE_TAG_FOR_PG_MAJOR: Record<PostgresVersion, string> = {
  // v3.20 community ships postgresql14-dev and shares musl 1.2.5 with the
  // postgres:14-alpine runtime (alpine 3.23), so the compiled dummy_seclabel.so
  // loads cleanly. (postgresql14 is dropped from alpine's newer main repos.)
  14: "3.20",
  15: "3.19",
  17: "3.23",
  // v3.22 has no postgresql18 in main/community; v3.23 ships postgresql18-dev.
  18: "3.23",
};
