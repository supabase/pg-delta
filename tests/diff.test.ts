import { readdir, readFile } from "node:fs/promises";
import { describe, test } from "vitest";

describe("diff", async () => {
  const folders = await readdir(new URL("./fixtures", import.meta.url));
  const files = [
    "a.sql",
    "b.sql",
    "additions.sql",
    "expected.sql",
    "expected2.sql",
  ];
  for (const folder of folders) {
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
    const fixture = {
      a,
      b,
      additions,
      expected,
      expected2,
    };
    test(`should diff ${folder}`, async () => {});
  }
});
