import { assertArrayIncludes } from "@std/assert";
import { delay } from "@std/async/delay";
import { afterAll, describe, it } from "@std/testing/bdd";

import { MariadbTestContainer } from "../containers/mariadb.ts";

const DB_NAME = "test";

const container = await MariadbTestContainer.start("yobasystems/alpine-mariadb", { port: 3306, password: "test" });
await delay(250);

await container.create(DB_NAME);

const client = await container.client(DB_NAME);

await delay(250);

describe("Mariadb", () => {
  afterAll(async () => {
    await client.close();
    await container.stop();
  });

  it("should spin up a mariadb container", async () => {
    const res = await client.query("show databases");
    assertArrayIncludes(res, [{ "Database": DB_NAME }]);
  });
});
