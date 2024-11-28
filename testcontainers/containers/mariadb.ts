/**
 * @module
 *
 * Provides the ability to quickly run a Mariadb image in a docker instance.
 *
 * @example
 * ```ts
 * import { MariadbTestContainer } from "@sergeilem/testcontainers/Mariadb";
 *
 * const container = await MariadbTestContainer.start("Mariadb:16");
 *
 * await container.create("db");
 * await container.client("db")`SELECT 1`;
 *
 * console.log(container.url("db")); // => Mariadb://Mariadb:Mariadb@127.0.0.1:5432/db
 *
 * await container.stop();
 * ```
 */

import { delay } from "@std/async/delay";
import { getAvailablePort } from "@std/net";

import type { Container } from "../docker/libraries/container.ts";
import { docker } from "../mod.ts";

/**
 * Provides a simplified utility layer for starting, operating, and shutting down a
 * Mariadb docker container.
 *
 * Will automatically pull the requested docker image before starting the container.
 */
export class MariadbTestContainer {
  readonly #connection: MariadbConnectionInfo;

  private constructor(
    readonly container: Container,
    connection: MariadbConnectionInfo,
  ) {
    this.#connection = connection;
  }

  /*
   |--------------------------------------------------------------------------------
   | Accessors
   |--------------------------------------------------------------------------------
   */

  /**
   * MariadbQL container host.
   */
  get host(): string {
    return this.#connection.host;
  }

  /**
   * MariadbQL container port.
   */
  get port(): number {
    return this.#connection.port;
  }

  /**
   * MariadbQL username applied to the container.
   */
  get username(): string {
    return this.#connection.user;
  }

  /**
   * MariadbQL password applied to the container.
   */
  get password(): string {
    return this.#connection.pass;
  }

  /**
   * Execute a command in the Mariadb container.
   */
  get exec(): typeof this.container.exec {
    return this.container.exec.bind(this.container);
  }

  /*
   |--------------------------------------------------------------------------------
   | Lifecycle
   |--------------------------------------------------------------------------------
   */

  /**
   * Start a new Mariadb container.
   *
   * @param config - Options for the Mariadb container.
   */
  static async start(image: string, config: Partial<MariadbConnectionInfo> = {}): Promise<MariadbTestContainer> {
    const port = getAvailablePort({ preferredPort: config.port });
    if (port === undefined) {
      throw new Error("Unable to assign to a random port");
    }

    await docker.pullImage(image);

    const container = await docker.createContainer({
      Image: image,
      Env: [`MYSQL_USER=${config.user ?? "root"}`, `MYSQL_PASSWORD=${config.pass ?? ""}`],
      ExposedPorts: {
        "3306/tcp": {},
      },
      HostConfig: {
        PortBindings: { "3306/tcp": [{ HostIp: "0.0.0.0", HostPort: String(port) }] },
      },
    });

    await container.start();
    await container.waitForLog("Version:");

    await delay(250);

    return new MariadbTestContainer(container, {
      host: config.host ?? "127.0.0.1",
      port,
      user: config.user ?? "root",
      pass: config.pass ?? "",
    });
  }

  /**
   * Stop and remove the Mariadb container.
   */
  async stop(): Promise<void> {
    await this.container.remove({ force: true });
  }
}

/*
 |--------------------------------------------------------------------------------
 | Types
 |--------------------------------------------------------------------------------
 */

type MariadbConnectionInfo = {
  user: string;
  pass: string;
  host: string;
  port: number;
};
