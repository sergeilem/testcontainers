import { assertArrayIncludes } from "@std/assert";
import { delay } from "@std/async/delay";
import { afterAll, describe, it } from "@std/testing/bdd";

import { MariadbTestContainer } from "../containers/mariadb.ts";

const container = await MariadbTestContainer.start("yobasystems/alpine-mariadb", { port: 3306, password: "test" });

await delay(250);

describe("Mariadb", () => {
  afterAll(async () => {
    await container.stop();
  });

  it("should spin up a mariadb container", async () => {
  });
});
