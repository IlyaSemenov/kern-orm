# Custom Drivers

To run kern-orm on a PostgreSQL client that has no [driver package](./drivers), write a function that returns a `Driver` for your client, and pass the driver to `createDatabase`:

```ts [src/acme-driver.ts]
import type { AcmeClient, AcmeConnection, AcmeError } from "acme-postgres"
import type { Driver, DriverResult, SqlStatement } from "kern-orm"
import { toDriverError } from "kern-orm"

/** Rejects with the error of `promise` as `QueryError` or `ConnectionError`. */
async function classifyError<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise
  } catch (error) {
    const { severity, code, constraint } = error as AcmeError
    throw toDriverError(error, { severity, code, constraint })
  }
}

async function execute(
  client: AcmeClient | AcmeConnection,
  statement: SqlStatement,
): Promise<DriverResult> {
  const result = await classifyError(
    client.query(statement.text, statement.parameters, {
      protocol: "extended",
      parse: false,
    }),
  )
  return {
    command: result.command,
    count: result.rowCount ?? 0,
    columns: result.fields.map(field => field.name),
    rows: result.rows,
  }
}

export function acmeDriver(client: AcmeClient): Driver {
  return {
    execute: statement => execute(client, statement),
    executeScript: text => classifyError(client.simpleQuery(text)),
    async acquire() {
      const connection = await client.reserve().catch((error: unknown) => {
        throw toDriverError(error)
      })
      return {
        execute: statement => execute(connection, statement),
        executeScript: text => classifyError(connection.simpleQuery(text)),
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
- Reject a statement or script with `QueryError` when PostgreSQL rejected it, and with `ConnectionError` after any other failure, by passing the error of your client and the fields of its PostgreSQL error to `toDriverError`.
  Pass the severity in English when your client gives it beside the translated one.
- Reject a failure to get a connection with `ConnectionError`, by passing the error to `toDriverError` without the fields.
- Reject every statement on a reserved connection after the connection is lost, rather than send it on a new connection.
- Replace an idle connection whose backend exited, such as after a restart of the server, for the next statement once your client has read that the connection closed.
- When `release` gets a failure, the last statement on the connection failed: return the connection to the pool only once it is idle, and never return a lost one.
- In `close`, reject new statements and scripts on the pool and new connections at once with `ConnectionError`, wait for the statements already sent, for the reserved connections, and for those still waiting for a connection, and then close the connections.

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

To skip the tests without a database, call `describeDriverContract` in a block that your test runner skips, such as `describe("driver", { skip: !DATABASE_URL }, () => { ... })` of `node:test`, or `describe.skipIf(!DATABASE_URL)("driver", () => { ... })` of `bun:test` and Vitest.
