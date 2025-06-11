import { getContainerRuntimeClient, ImageName } from "testcontainers";
import { POSTGRES_VERSIONS } from "./constants.ts";

export async function setup() {
  const containerRuntimeClient = await getContainerRuntimeClient();
  await Promise.all(
    POSTGRES_VERSIONS.map((version) =>
      containerRuntimeClient.image.pull(
        ImageName.fromString(`postgres:${version}-alpine`),
      ),
    ),
  );
}
