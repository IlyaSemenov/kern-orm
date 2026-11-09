# Custom Drivers

To run kern-orm on a PostgreSQL client that has no [driver package](./drivers), write a function that returns a `Driver` for your client, and pass the driver to `createDatabase`:

```ts [src/acme-driver.ts]
import type { AcmeClient, AcmeConnection } from "acme-postgres"
import type { Driver, DriverResult, SqlStatement } from "kern-orm"

async function execute(
  client: AcmeClient | AcmeConnection,
  statement: SqlStatement,
): Promise<DriverResult> {
  const result = await client.query(statement.text, statement.parameters, {
    protocol: "extended",
    parse: false,
  })
  return {
    command: result.command,
    count: result.rowCount ?? 0,
    columns: result.fields.map(field => field.name),
    rows: result.rows,
  }
}

export function acmeDriver(client: AcmeClient): Driver {
  return {
    closesReservedConnections: true,
    execute: statement => execute(client, statement),
    executeScript: text => client.simpleQuery(text),
    async acquire() {
      const connection = await client.reserve()
      return {
        execute: statement => execute(connection, statement),
        executeScript: text => connection.simpleQuery(text),
        release: failure => connection.release({ destroy: failure !== undefined }),
      }
    },
    close: () => client.end(),
  }
}
```

Follow these rules in the driver:

- Send parameters as text without declared types, so that PostgreSQL infers their types from the statement.
- Return values as their text without the parsers of your client, and `NULL` as `null`.
- Return `null` as the `command` of a statement that PostgreSQL completes without a command tag, such as an empty text.
- Send a statement with the extended protocol also without parameters, so that PostgreSQL rejects a text of several statements, and a script with the simple protocol.
- Run the statements and scripts of a reserved connection one at a time in the order of calls.
- Replace an idle connection whose backend exited, such as after a restart of the server, for the next statement once your client has read that the connection closed.
- When `release` gets a failure, return the connection to the pool only once it is idle, and never return a lost one.
- Set `closesReservedConnections` to `false` only if your client cannot close a reserved connection, such as postgres.js 3: such a driver keeps the connection reserved when it cannot tell that the connection is idle.
- In `close`, reject new statements and scripts on the pool and new connections at once, wait for the statements already sent, for the reserved connections, and for those still waiting for a connection, and then close the connections.

## Test the driver

Call `describeDriverContract` from a test file to check the driver in PostgreSQL, with the functions of your test runner:

```ts
import { after, before, describe, it } from "node:test"

import { describeDriverContract } from "kern-orm/testing"

const { DATABASE_URL } = process.env

describeDriverContract(
  {
    createDriver: options => acmeDriver(createAcmeClient(DATABASE_URL, options)),
    createDriverWithFailingParsers: () =>
      acmeDriver(
        createAcmeClient(DATABASE_URL, {
          parseValue() {
            throw new Error("parsed")
          },
        }),
      ),
  },
  { describe, it, before, after },
)
```

With `bun:test` and Vitest, pass `{ describe, it, before: beforeAll, after: afterAll }`.

Point the clients to an empty database; the tests leave it unchanged.
Pass `max` of `createDriver` to your client: the tests choose how many connections each of them needs.
For a driver whose `closesReservedConnections` is `false`, `describeDriverContract` leaves out the tests of a reserved connection left in a transaction or lost.

To skip the tests without a database, call `describeDriverContract` in a block that your test runner skips, such as `describe("driver", { skip: !DATABASE_URL }, () => { ... })` of `node:test`, or `describe.skipIf(!DATABASE_URL)("driver", () => { ... })` of `bun:test` and Vitest.
