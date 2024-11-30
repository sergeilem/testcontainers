/**
 * @module
 *
 * Provides the ability to quickly run a Generic image in a docker instance.
 *
 * @example
 * ```ts
 * import { GenericTestContainer } from "@sergeilem/testcontainers/Generic";
 *
 * const container = await GenericTestContainer.start("bitnami/nginx");
 * *
 * await container.stop();
 * ```
 */

import { delay } from "@std/async/delay";
import { getAvailablePort } from "@std/net";

import type { Container } from "../docker/libraries/container.ts";
import { docker } from "../mod.ts";

/**
 * Provides a simplified utility layer for starting, operating, and shutting down a
 * Generic docker container.
 *
 * Will automatically pull the requested docker image before starting the container.
 */
export class GenericTestContainer {
  readonly #connection: GenericConnectionInfo;

  private constructor(
    readonly container: Container,
    connection: GenericConnectionInfo,
  ) {
    this.#connection = connection;
  }

  /*
   |--------------------------------------------------------------------------------
   | Accessors
   |--------------------------------------------------------------------------------
   */

  /**
   * Generic container host.
   */
  get host(): string {
    return this.#connection.host;
  }

  /**
   * Generic container port.
   */
  get port(): number {
    return this.#connection.port;
  }

  /**
   * Generic container internal port.
   */
  get internalPort(): number {
    return this.#connection.internalPort;
  }

  /**
   * Generic container port.
   */
  get waitForLog(): string {
    return this.#connection.waitForLog;
  }

  /*
   |--------------------------------------------------------------------------------
   | Lifecycle
   |--------------------------------------------------------------------------------
   */

  /**
   * Start a new Generic container.
   *
   * @param config - Options for the Generic container.
   */
  static async start(image: string, config: Partial<GenericConnectionInfo> = {}): Promise<GenericTestContainer> {
    const port = getAvailablePort({ preferredPort: config.port });
    if (port === undefined) {
      throw new Error("Unable to assign to a random port");
    }
    const internalPort = config.internalPort;
    if (internalPort === undefined) {
      throw new Error("Unable to assign to a random internalPort");
    }
    const internalPortTcp = `${internalPort}/tcp`;
    if (config.waitForLog === undefined || config.waitForLog === "") {
      throw new Error("Unable to wait for empty string");
    }
    const waitForLog = config.waitForLog;
    const env = config.env ?? [];

    await docker.pullImage(image);

    const ExposedPorts: any = {};
    ExposedPorts[internalPortTcp] = {};
    const PortBindings: any = {};
    PortBindings[internalPortTcp] = [{ HostIp: "0.0.0.0", HostPort: String(port) }];
    const container = await docker.createContainer({
      Image: image,
      Env: env,
      ExposedPorts,
      HostConfig: { PortBindings },
    });

    await container.start();
    await container.waitForLog(waitForLog);

    await delay(250);

    return new GenericTestContainer(container, {
      host: config.host ?? "127.0.0.1",
      port,
      env,
      internalPort,
      waitForLog,
    });
  }

  /**
   * Stop and remove the Generic container.
   */
  async stop(): Promise<void> {
    await this.container.remove({ force: true });
  }
}

// mysql -u root -ptest -e 'show databases;'

/*
 |--------------------------------------------------------------------------------
 | Types
 |--------------------------------------------------------------------------------
 */

type GenericConnectionInfo = {
  host: string;
  port: number;
  env: string[];
  internalPort: number;
  waitForLog: string;
};
