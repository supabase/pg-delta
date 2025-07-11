import { getContainerRuntimeClient, ImageName } from "testcontainers";
import {
  POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG,
  POSTGRES_VERSIONS,
} from "./constants.ts";

export async function setup() {
  const containerRuntimeClient = await getContainerRuntimeClient();
  // pull all the images before running the tests
  const images = POSTGRES_VERSIONS.flatMap((postgresVersion) => [
    `supabase/postgres:${POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG[postgresVersion]}`,
    `postgres:${postgresVersion}-alpine`,
  ]);
  await Promise.all(
    images.map((image) =>
      containerRuntimeClient.image.pull(ImageName.fromString(image)),
    ),
  );
}
