import { getContainerRuntimeClient, ImageName } from "testcontainers";
import {
  POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG,
  POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG,
  POSTGRES_VERSIONS,
} from "./constants.ts";

export async function setup() {
  const containerRuntimeClient = await getContainerRuntimeClient();
  // pull all the images before running the tests
  const imagesSupabasePostgres = POSTGRES_VERSIONS.map(
    (postgresVersion) =>
      `supabase/postgres:${POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG[postgresVersion]}`,
  );
  const imagesAlpinePostgres = POSTGRES_VERSIONS.map(
    (postgresVersion) =>
      `postgres:${POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG[postgresVersion]}`,
  );

  await Promise.all([
    ...imagesSupabasePostgres.map((image) =>
      containerRuntimeClient.image.pull(ImageName.fromString(image)),
    ),
    ...imagesAlpinePostgres.map((image) =>
      containerRuntimeClient.image.pull(ImageName.fromString(image)),
    ),
  ]);
  // Container manager will be initialized lazily when first needed
  // And auto cleaned up after all tests complete
}
