# Test Containers

Test container solution for running third party solutions through docker. Forked from @valkyr/testcontainers.

## Quick Start - Generic

```ts
import { GenericTestContainer } from "@sergeilem/testcontainers/generic";

const config = { port: 15000, internalPort: 8080, waitForLog: "Ready" };
const container = await GenericTestContainer.start("testcontainers/helloworld", config);
await container.stop();
```

## Quick Start - MariaDB

```ts
import { MariadbTestContainer } from "@sergeilem/testcontainers/mariadb";

const DB_NAME = "test";

const container = await MariadbTestContainer.start("yobasystems/alpine-mariadb", { port: 3306, pass: "test" });

await container.create(DB_NAME);
const client = await container.client(DB_NAME);
const res = await client.query("show databases");

console.log(container.url("test")); // => mysql://root:test@127.0.0.1:5432/test

await client.close();
await container.stop();
```

## Quick Start - PostgreSQL

```ts
import { PostgresTestContainer } from "@sergeilem/testcontainers/postgres";

const container = await PostgresTestContainer.start("postgres:16");

await container.create("db");
await container.client("db")`SELECT 1`;

console.log(container.url("db")); // => postgres://postgres:postgres@127.0.0.1:5432/db

await container.stop();
```
