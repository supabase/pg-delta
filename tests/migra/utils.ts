import { readdir, readFile } from "node:fs/promises";

export async function getFixtures() {
  // use TEST_MIGRA_FIXTURES to run specific tests, e.g. `TEST_MIGRA_FIXTURES=constraints,dependencies pnpm test`
  const folders = process.env.TEST_MIGRA_FIXTURES
    ? process.env.TEST_MIGRA_FIXTURES.split(",")
    : await readdir(new URL("./fixtures", import.meta.url));
  const files = [
    "a.sql",
    "b.sql",
    "additions.sql",
    "expected.sql",
    "expected2.sql",
  ];
  const fixtures = await Promise.all(
    folders.map(async (folder) => {
      const [a, b, additions, expected, expected2] = await Promise.all(
        files.map(async (file) => {
          const content = await readFile(
            new URL(`./fixtures/${folder}/${file}`, import.meta.url),
            "utf-8",
          );
          if (content === "") {
            return null;
          }
          return content;
        }),
      );
      if (!(a && b && expected)) {
        throw new Error(`Missing fixtures for ${folder}`);
      }
      return {
        folder,
        a,
        b,
        additions,
        expected,
        expected2,
      };
    }),
  );

  return fixtures;
}
