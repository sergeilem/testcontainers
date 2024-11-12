import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { ensureFile } from "@std/fs";
import { toPascalCase } from "@std/text";
import { resolveRefs } from "json-refs";
import { jsonSchemaToZod } from "json-schema-to-zod";
import { format } from "prettier";

import { assertConfig, type Config } from "./asserts/events.ts";
import { getDefinitions, getEventType, getImports } from "./types.ts";
import { jsonSchema } from "./utilities/json-schema.ts";

/**
 * Consumes a list of *.json files stored under given paths and generates a new
 * events file ready for consumption by an event store instance.
 *
 * @param options.paths   - Paths containing *.json event configuration files.
 * @param options.output  - Target file to generate the events to.
 * @param options.modules - List of modules to print events for.
 *
 * @example
 *
 * ```ts
 * import { printEvents } from "@valkyr/event-store";
 *
 * await printEvents({
 *   paths: [
 *    "path/to/events-1",
 *    "path/to/events-2"
 *   ],
 *   output: "path/to/events.ts",
 * });
 * ```
 */
export async function printEvents({ paths, outputs, modules = [] }: Options) {
  const { names, types, validators, definitions } = await getEventStoreContainer(paths, [
    ...modules.map((module) => module.events).flat(),
  ]);
  const content = new TextEncoder().encode(
    await format(
      `
      // This is an auto generated file. Do not modify this file!
      // deno-fmt-ignore-file
      
      import { type Empty, type Event as TEvent, type EventToRecord } from "@valkyr/event-store";
      import { type AnyZodObject, z } from "zod";
  
      export const events = new Set([${names.sort().map((event) => `"${event}"`).join(",")}] as const);

      export const validators = {
        data: new Map<Event["type"], AnyZodObject>([
          ${Array.from(validators.data.entries()).sort(([a], [b]) => a > b ? 1 : -1).map(([key, value]) => `["${key}", ${value}]`).join(",")}
        ]),
        meta: new Map<Event["type"], AnyZodObject>([
          ${Array.from(validators.meta.entries()).sort(([a], [b]) => a > b ? 1 : -1).map(([key, value]) => `["${key}", ${value}]`).join(",")}
        ]),
      }

      export type EventRecord = EventToRecord<Event>;

      export type Event = ${names.sort().map((name) => toPascalCase(name)).join(" | ")};

      ${types.sort().join("\n\n")}

      ${definitions.join("\n\n")}
    `,
      {
        parser: "typescript",
        printWidth: 120,
      },
    ),
  );
  for (const output of outputs) {
    await ensureFile(output);
    await Deno.writeFile(
      output,
      content,
      {
        create: true,
      },
    );
  }
}

/*
 |--------------------------------------------------------------------------------
 | Utilities
 |--------------------------------------------------------------------------------
 */

async function getEventStoreContainer(
  paths: string[],
  module: any[] = [],
): Promise<EventStoreContainer> {
  const container: EventStoreContainer = {
    names: [],
    types: [],
    props: new Set(),
    validators: {
      data: new Map<string, any>(),
      meta: new Map<string, any>(),
    },
    definitions: [],
    imports: [],
  };

  const defs = new Map<string, any>();

  const configs = [...(await getLocalConfigs(paths)), ...getModuleConfigs(module)];
  for (const { event, definitions } of configs) {
    const type = event.type;
    container.names.push(type);
    container.types.push(getEventType(event));
    if (event.data !== undefined) {
      container.props.add({ name: type, props: jsonSchema.propertyNames(event.data) });
      container.validators.data.set(type, await getEventValidator(type, event.data));
    }
    if (event.meta !== undefined) {
      container.validators.meta.set(type, await getEventValidator(type, event.meta));
    }
    if (definitions !== undefined) {
      for (const key in definitions) {
        if (defs.has(key)) {
          throw new Error(`Config Duplicate Definition Error: Key '${key}' is already defined`);
        }
        defs.set(key, definitions[key]);
      }
    }
  }

  container.imports = getImports(configs);
  container.definitions = getDefinitions(defs);

  return container;
}

async function getLocalConfigs(paths: string[], events: Config[] = []): Promise<Config[]> {
  for (const path of paths) {
    for (const entity of await readdir(path, { withFileTypes: true })) {
      if (entity.isDirectory()) {
        await resolveLocalConfigs(join(path, entity.name), events);
      }
      if (entity.isFile() === true && entity.name.endsWith(".json")) {
        const config = JSON.parse(new TextDecoder().decode(await readFile(join(path, entity.name))));
        assertConfig(config);
        events.push(config);
      }
    }
  }
  return events;
}

async function resolveLocalConfigs(path: string, events: Config[]) {
  for (const entity of await readdir(path, { withFileTypes: true })) {
    if (entity.isDirectory()) {
      await resolveLocalConfigs(join(path, entity.name), events);
    }
    if (entity.isFile() === true && entity.name.endsWith(".json")) {
      const config = JSON.parse(new TextDecoder().decode(await readFile(join(path, entity.name))));
      assertConfig(config);
      events.push(config);
    }
  }
}

function getModuleConfigs(configs: any[]): Config[] {
  for (const config of configs) {
    assertConfig(config);
  }
  return configs;
}

async function getEventValidator(name: string, data: any) {
  const schema = {
    $schema: "http://json-schema.org/draft-04/schema#",
    id: `valkyrjs/schemas/v1/${name}.json`,
    title: name,
    type: "object",
    properties: populateProperties(data),
    required: Object.keys(data),
    additionalProperties: false,
  };
  const { resolved } = await resolveRefs(schema);
  return jsonSchemaToZod(resolved);
}

function populateProperties(props: any) {
  for (const key in props) {
    const prop = props[key];
    if (prop.type === "object") {
      prop.required = Object.keys(prop.properties);
      prop.additionalProperties = prop.additionalProperties === true;
    }
  }
  return props;
}

/*
 |--------------------------------------------------------------------------------
 | Types
 |--------------------------------------------------------------------------------
 */

/**
 * Options bag to pass to the {@link printEvents} method.
 */
type Options = {
  /**
   * Absolute paths to the folders the event configuration files is stored.
   *
   * @example
   *
   * ```ts
   * await printEvents({
   *   paths: ["path/to/events-1", "path/to/events-2"]
   *   outputs: ["path/to/events.ts"],
   *   modules: []
   * });
   * ```
   */
  paths: string[];

  /**
   * List of modules that provides their own events to be included in the output.
   *
   * @example
   *
   * ```ts
   * import { foo } from "foo"; // valkyr compliant module
   *
   * await printEvents({
   *   paths: ["path/to/events-1", "path/to/events-2"]
   *   outputs: ["path/to/events.ts"],
   *   modules: [foo]
   * });
   * ```
   */
  modules?: {
    events: any[];
  }[];

  /**
   * Absolute path to the folder the generated events should be written.
   *
   * @example
   *
   * ```ts
   * await printEvents({
   *   paths: ["path/to/events-1", "path/to/events-2"]
   *   outputs: ["path/to/events.ts"],
   *   modules: []
   * });
   * ```
   */
  outputs: string[];
};

type EventStoreContainer = {
  names: string[];
  types: string[];
  props: Set<{ name: string; props: string[] }>;
  validators: {
    data: Map<string, any>;
    meta: Map<string, any>;
  };
  definitions: string[];
  imports: string[];
};
