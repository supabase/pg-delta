import { describe } from "vitest";
import { getTest } from "../../tests/utils.ts";
import { inspect } from "./inspect.ts";

describe("inspect", () => {
  const test = getTest(17);

  test("should inspect relations", async ({ db }) => {
    await db.a`
      create table cats(id serial primary key);
    `;
    const result = await inspect(db.a);
    console.log(JSON.stringify(result, null, 2));
  });
}, 30_000);
