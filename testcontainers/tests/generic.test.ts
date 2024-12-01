import { delay } from "@std/async/delay";
import { afterAll, describe, it } from "@std/testing/bdd";

import { GenericTestContainer } from "../containers/generic.ts";

const config = { port: 15000, internalPort: 8080, waitForLog: "Ready", env: [] };
const container = await GenericTestContainer.start("testcontainers/helloworld", config);

await delay(250);

describe("Generic", () => {
  afterAll(async () => {
    await container.stop();
  });

  it("should spin up a generic container", async () => {
    await delay(500);
    // const internalHost = container.internalHost;
    // console.log(`Container internal host: ${internalHost}`);
  });
});
