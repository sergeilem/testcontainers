/**
 * @module
 *
 * Provides the ability to quickly run a Mariadb image in a docker instance.
 *
 * @example
 * ```ts
 * import { MariadbTestContainer } from "@sergeilem/testcontainers/Mariadb";
 *
 * const container = await MariadbTestContainer.start("yobasystems/alpine-mariadb");
 *
 * await container.create("test");
 * await container.client("test")`SELECT 1`;
 *
 * console.log(container.url("db")); // => mysql://mysql:test@127.0.0.1:5432/test
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
    return this.#connection.password;
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
      Env: [`MYSQL_ROOT_PASSWORD=${config.password ?? ""}`],
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
      password: config.password ?? "",
    });
  }

  /**
   * Stop and remove the Mariadb container.
   */
  async stop(): Promise<void> {
    await this.container.remove({ force: true });
  }

  /*
   |--------------------------------------------------------------------------------
   | Utilities
   |--------------------------------------------------------------------------------
   */

  /**
   * Return the connection URL for the Postgres container in the format:
   * `postgres://${user}:${pass}@${host}:${port}/${database}`.
   *
   * Make sure to start the container before accessing this method or it will
   * throw an error.
   *
   * @param name    - Name of the database to connect to.
   * @param options - Connection options to append to the URL.
   */
  url(database_name: string): MariadbConnectionUrl {
    return `mysql://${this.username}:${this.password}@${this.host}:${this.port}/${database_name}`;
  }
}

// mysql -u root -ptest -e 'show databases;'

/*
 |--------------------------------------------------------------------------------
 | Types
 |--------------------------------------------------------------------------------
 */

type MariadbConnectionUrl = `mysql://${string}:${string}@${string}:${number}/${string}`;

type MariadbConnectionInfo = {
  user: string;
  password: string;
  host: string;
  port: number;
};
