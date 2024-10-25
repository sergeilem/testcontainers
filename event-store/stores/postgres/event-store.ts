/**
 * @module
 *
 * This module contains an event store solution for postgres.
 *
 * @example
 * ```ts
 * import psql from "postgres";
 *
 * import { PGEventStore } from "@valkyr/event-store/pg";
 * import { z } from "zod";
 *
 * const eventStore = new PGEventStore<MyEvents>({
 *   database: "postgres://{user}:{password}@{url}:{port}/{database}",
 *   events: Set<[
 *     "EventA",
 *     "EventB"
 *   ] as const>,
 *   validators: new Map<MyEvents["type"], any>([
 *     ["EventA", z.object({ foo: z.string() }).strict()],
 *     ["EventB", z.object({ bar: z.string() }).strict()],
 *   ]),
 * });
 *
 * type MyEvents = EventA | EventB;
 *
 * type EventA = Event<"EventA", { foo: string }, { domain: string }>;
 * type EventB = Event<"EventB", { bar: string }, { domain: string }>;
 * ```
 */

import { type PostgresConnection, PostgresDatabase } from "@valkyr/drizzle";
import type { AnyZodObject } from "zod";

import { Contextor } from "~libraries/contextor.ts";
import { createEventRecord } from "~libraries/event.ts";
import { Projector } from "~libraries/projector.ts";
import { makeReducer } from "~libraries/reducer.ts";
import { Validator } from "~libraries/validator.ts";
import type { Unknown } from "~types/common.ts";
import type { Event, EventRecord, EventStatus, EventToRecord } from "~types/event.ts";
import type { EventReadOptions, EventStore, EventStoreHooks } from "~types/event-store.ts";
import type { InferReducerState, Reducer, ReducerConfig, ReducerLeftFold } from "~types/reducer.ts";
import type { ExcludeEmptyFields } from "~types/utilities.ts";
import { pushEventRecord } from "~utilities/event-store/push-event-record.ts";
import { pushEventRecordSequence } from "~utilities/event-store/push-event-record-sequence.ts";
import { pushEventRecordUpdates } from "~utilities/event-store/push-event-record-updates.ts";

import { type EventStoreDatabase, type EventStoreSchema, schema, type Transaction } from "./database.ts";
import { ContextProvider } from "./providers/context.ts";
import { EventProvider } from "./providers/event.ts";
import { SnapshotProvider } from "./providers/snapshot.ts";
import { contexts } from "./schemas/contexts.ts";
import { events } from "./schemas/events.ts";
import { snapshots } from "./schemas/snapshots.ts";

export { migrate } from "./database.ts";

/*
 |--------------------------------------------------------------------------------
 | Event Store
 |--------------------------------------------------------------------------------
 */

/**
 * Provides a solution to easily validate, generate, and project events to a
 * postgres database.
 */
export class PostgresEventStore<TEvent extends Event, TRecord extends EventRecord = EventToRecord<TEvent>> implements EventStore<TEvent, TRecord> {
  readonly #config: Config<TEvent, TRecord>;

  readonly #database: PostgresDatabase<EventStoreSchema>;
  readonly #events: EventList<TEvent>;
  readonly #validators: ValidatorConfig<TEvent>;
  readonly #snapshot: "manual" | "auto";

  readonly hooks: EventStoreHooks<TRecord>;

  readonly contexts: ContextProvider;
  readonly events: EventProvider<TRecord>;
  readonly snapshots: SnapshotProvider;

  readonly validator: Validator<TRecord>;
  readonly projector: Projector<TRecord>;
  readonly contextor: Contextor<TRecord>;

  constructor(config: Config<TEvent, TRecord>, tx?: Transaction) {
    this.#config = config;
    this.#database = new PostgresDatabase<EventStoreSchema>(config.database, schema);
    this.#events = config.events;
    this.#validators = config.validators;
    this.#snapshot = config.snapshot ?? "manual";

    this.hooks = config.hooks ?? {};

    this.contexts = new ContextProvider(tx ?? this.#database, contexts);
    this.events = new EventProvider(tx ?? this.#database, events);
    this.snapshots = new SnapshotProvider(tx ?? this.#database, snapshots);

    this.validator = new Validator<TRecord>();
    this.projector = new Projector<TRecord>();
    this.contextor = new Contextor<TRecord>(this.contexts.handle.bind(this.contexts));
  }

  /*
   |--------------------------------------------------------------------------------
   | Accessors
   |--------------------------------------------------------------------------------
   */

  /**
   * Access the event store database drizzle wrapped instance.
   */
  get db(): EventStoreDatabase {
    return this.#database.drizzle;
  }

  /*
   |--------------------------------------------------------------------------------
   | Events
   |--------------------------------------------------------------------------------
   */

  hasEvent(type: TRecord["type"]): boolean {
    return this.#events.has(type);
  }

  makeEvent<TEventType extends Event["type"]>(
    event: ExcludeEmptyFields<Extract<TEvent, { type: TEventType }>> & {
      stream?: string;
    },
  ): TRecord {
    return createEventRecord<TEvent, TRecord>(event as any);
  }

  async addEvent<TEventType extends Event["type"]>(
    event: ExcludeEmptyFields<Extract<TEvent, { type: TEventType }>> & {
      stream?: string;
    },
  ): Promise<string> {
    return this.pushEvent(createEventRecord<TEvent, TRecord>(event as any), false);
  }

  async addEventSequence<TEventType extends Event["type"]>(
    events: (ExcludeEmptyFields<Extract<TEvent, { type: TEventType }>> & { stream: string })[],
  ): Promise<void> {
    return this.pushEventSequence(
      events.map((event) => ({ record: createEventRecord<TEvent, TRecord>(event as any), hydrated: false })),
    );
  }

  async pushEvent(record: TRecord, hydrated = true): Promise<string> {
    return pushEventRecord(this as any, record, hydrated);
  }

  async pushEventSequence(records: { record: TRecord; hydrated?: boolean }[]): Promise<void> {
    const inserted = await this.#database.transaction(async (tx) => {
      return pushEventRecordSequence(
        new PostgresEventStore(this.#config, tx) as any,
        records.map<{ record: TRecord; hydrated: boolean }>((record) => {
          record.hydrated = record.hydrated === undefined ? true : record.hydrated;
          return record as { record: TRecord; hydrated: boolean };
        }),
      );
    });
    for (const { record, hydrated, status } of inserted) {
      await pushEventRecordUpdates(this as any, record, hydrated, status);
    }
  }

  async getEventStatus(event: TRecord): Promise<EventStatus> {
    const record = await this.events.getById(event.id);
    if (record) {
      return { exists: true, outdated: true };
    }
    return { exists: false, outdated: await this.events.checkOutdated(event) };
  }

  async getEvents(options?: EventReadOptions<TRecord>): Promise<TRecord[]> {
    return this.events.get(options);
  }

  async getEventsByStream(stream: string, options?: EventReadOptions<TRecord>): Promise<TRecord[]> {
    return this.events.getByStream(stream, options);
  }

  async getEventsByContext(key: string, options?: EventReadOptions<TRecord>): Promise<TRecord[]> {
    const rows = await this.contexts.getByKey(key);
    if (rows.length === 0) {
      return [];
    }
    return this.events.getByStreams(rows.map((row) => row.stream), options);
  }

  async replayEvents(stream?: string): Promise<void> {
    const events = stream !== undefined ? await this.events.getByStream(stream) : await this.events.get();
    for (const event of events) {
      await Promise.all([
        this.contextor.push(event),
        this.projector.project(event, { hydrated: true, outdated: false }),
      ]);
    }
  }

  /*
   |--------------------------------------------------------------------------------
   | Reducers
   |--------------------------------------------------------------------------------
   */

  makeReducer<TState extends Unknown>(
    folder: ReducerLeftFold<TState, TRecord>,
    config: ReducerConfig<TState, TRecord>,
  ): Reducer<TState, TRecord> {
    return makeReducer<TState, TRecord>(folder, config);
  }

  async reduce<TReducer extends Reducer>(
    streamOrContext: string,
    reducer: TReducer,
  ): Promise<ReturnType<TReducer["reduce"]> | undefined> {
    let cursor: string | undefined;
    let state: InferReducerState<TReducer> | undefined;

    const snapshot = await this.getSnapshot(streamOrContext, reducer);
    if (snapshot !== undefined) {
      cursor = snapshot.cursor;
      state = snapshot.state;
    }

    const events = reducer.type === "stream"
      ? await this.getEventsByStream(streamOrContext, { cursor, filter: reducer.filter })
      : await this.getEventsByContext(streamOrContext, { cursor, filter: reducer.filter });
    if (events.length === 0) {
      if (snapshot !== undefined) {
        return snapshot.state;
      }
      return undefined;
    }

    const result = reducer.reduce(events, state);
    if (this.#snapshot === "auto") {
      await this.snapshots.insert(name, streamOrContext, events.at(-1)!.created, result);
    }
    return result;
  }

  /*
   |--------------------------------------------------------------------------------
   | Snapshots
   |--------------------------------------------------------------------------------
   */

  async createSnapshot<TReducer extends Reducer>(streamOrContext: string, { name, type, filter, reduce }: TReducer): Promise<void> {
    const events = type === "stream" ? await this.getEventsByStream(streamOrContext, { filter }) : await this.getEventsByContext(streamOrContext, { filter });
    if (events.length === 0) {
      return undefined;
    }
    await this.snapshots.insert(name, streamOrContext, events.at(-1)!.created, reduce(events));
  }

  async getSnapshot<TReducer extends Reducer, TState = InferReducerState<TReducer>>(
    streamOrContext: string,
    reducer: TReducer,
  ): Promise<{ cursor: string; state: TState } | undefined> {
    const snapshot = await this.snapshots.getByStream(reducer.name, streamOrContext);
    if (snapshot === undefined) {
      return undefined;
    }
    return { cursor: snapshot.cursor, state: snapshot.state as TState };
  }

  async deleteSnapshot<TReducer extends Reducer>(streamOrContext: string, reducer: TReducer): Promise<void> {
    await this.snapshots.remove(reducer.name, streamOrContext);
  }

  /*
   |--------------------------------------------------------------------------------
   | Utilities
   |--------------------------------------------------------------------------------
   */

  /**
   * Get a zod event validator instance used to check if an event object matches
   * the expected definitions.
   *
   * @param type - Event to get validator for.
   */
  getValidator(type: TRecord["type"]): {
    data?: AnyZodObject;
    meta?: AnyZodObject;
  } {
    return {
      data: this.#validators.data.get(type),
      meta: this.#validators.meta.get(type),
    };
  }
}

/*
 |--------------------------------------------------------------------------------
 | Types
 |--------------------------------------------------------------------------------
 */

type Config<TEvent extends Event, TRecord extends EventRecord> = {
  database: PostgresConnection;
  events: EventList<TEvent>;
  validators: ValidatorConfig<TEvent>;
  snapshot?: "manual" | "auto";
  hooks?: EventStoreHooks<TRecord>;
};

type ValidatorConfig<TEvent extends Event> = {
  data: Map<TEvent["type"], AnyZodObject>;
  meta: Map<TEvent["type"], AnyZodObject>;
};

type EventList<E extends Event> = Set<E["type"]>;
