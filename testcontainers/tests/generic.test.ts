import { delay } from "@std/async/delay";
import { afterAll, describe, it } from "@std/testing/bdd";

import { GenericTestContainer } from "../containers/generic.ts";

const config = { port: 15000, internalPort: 80, waitForLog: "start worker" };
const container = await GenericTestContainer.start("nginx", config);

await delay(250);

describe("Generic", () => {
  afterAll(async () => {
    await container.stop();
  });

  it("should spin up a generic container", async () => {
  });
});
