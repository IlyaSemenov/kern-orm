# Custom Drivers

To run kern-db on a PostgreSQL client that has no [driver](./drivers), write a function that returns a `Driver` for your client, and pass the driver to `createDatabase`:

```ts [src/acme-driver.ts]
import type { AcmeClient, AcmeConnection, AcmeError } from "acme-postgres"
import type { Driver, DriverResult, SqlStatement } from "kern-db"
import { ConnectionError, toDriverError } from "kern-db"

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
        throw toDriverError(error, { unsent: true })
      })
      // The last statement sent, and whether a statement failed with ConnectionError, after which it may still run, or the connection may be lost.
      let last: Promise<void> = Promise.resolve()
      let broken = false
      function track<T>(promise: Promise<T>): Promise<T> {
        // Keeping only the end of the statement does not hold its rows.
        last = promise.then(
          () => {},
          (error: unknown) => {
            broken ||= error instanceof ConnectionError
          },
        )
        return promise
      }
      return {
        execute: statement => track(execute(connection, statement)),
        executeScript: text => track(classifyError(connection.simpleQuery(text))),
        async release() {
          // The status of the transaction is read after the statements sent before the release.
          await last
          await connection.release({ destroy: broken || connection.transactionStatus !== "idle" })
        },
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
- Reject a failure to get a connection with `ConnectionError` whose `unsent` is `true`, by passing the error to `toDriverError` with `{ unsent: true }`.
  Pass `unsent: true` also for a statement or script whenever your client tells that it did not send it, such as when it could not open a connection for it, and only then.
- Reject every statement on a reserved connection after the connection is lost, rather than send it on a new connection.
- Replace an idle connection whose backend exited, such as after a restart of the server, for the next statement once your client has read that the connection closed.
- Reject a statement or script on the pool that leaves its connection in a transaction, such as `BEGIN`, with `ConnectionError`, and close the connection or roll the transaction back.
  A script whose statement PostgreSQL rejected in that transaction may reject with that `QueryError` instead.
- In `release`, wait for the statements sent on the connection, and return it to the pool only when it is outside a transaction and no statement on it failed with `ConnectionError`; otherwise close it.
  Read the status of the transaction that PostgreSQL reported in `ReadyForQuery` after the last statement, also when PostgreSQL rejected that statement.
- In `close`, reject new statements and scripts on the pool and new connections at once with `ConnectionError` whose `unsent` is `true`, wait for the statements already sent, for the reserved connections, and for those still waiting for a connection, and then close the connections.

## Test the driver

Call `describeDriverContract` from a test file to check the driver in PostgreSQL, with the functions of your test runner:

```ts
import { after, before, describe, it } from "node:test"

import { describeDriverContract } from "kern-db/testing"

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
    // Port 1 of the local host refuses connections.
    createUnreachableDriver: () => acmeDriver(createAcmeClient("postgres://127.0.0.1:1/postgres")),
  },
  { describe, it, before, after },
)
```

With `bun:test` and Vitest, pass `{ describe, it, before: beforeAll, after: afterAll }`.

Point the clients to an empty database; the tests leave it unchanged.
Pass `max` of `createDriver` to your client: the tests choose how many connections each of them needs.

To skip the tests without a database, call `describeDriverContract` in a block that your test runner skips, such as `describe("driver", { skip: !DATABASE_URL }, () => { ... })` of `node:test`, or `describe.skipIf(!DATABASE_URL)("driver", () => { ... })` of `bun:test` and Vitest.
