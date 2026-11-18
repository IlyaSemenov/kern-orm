// Fake clients with prepared results for measuring the public drivers without PostgreSQL.

import { EventEmitter } from "node:events"

import type { Driver, TextValue } from "kern-orm"
import { nodePostgresDriver } from "kern-orm/db/node-postgres"
import { postgresJsDriver } from "kern-orm/db/postgres-js"

/** Creates a public driver over a fake client with the metadata and rows of its real client. */
export function createResultDriver(
  client: "node-postgres" | "postgres.js",
  width: number,
  rows: TextValue[][],
): Driver {
  if (client === "node-postgres") {
    const fields = Array.from({ length: width }, (_, index) => ({
      name: `c${index}`,
      tableID: 0,
      columnID: 0,
      dataTypeID: 25,
      dataTypeSize: -1,
      dataTypeModifier: -1,
      format: "text",
    }))
    const result = { command: "SELECT", rowCount: rows.length, fields, rows }
    const connection = Object.assign(new EventEmitter(), {
      query: () => Promise.resolve(result),
      getTransactionStatus: () => "I",
      release() {},
    })
    const pool = Object.assign(new EventEmitter(), {
      connect: () => Promise.resolve(connection),
      end: () => Promise.resolve(),
    })
    return nodePostgresDriver(pool as unknown as Parameters<typeof nodePostgresDriver>[0])
  }
  const columns = Array.from({ length: width }, (_, index) => ({
    name: `c${index}`,
    type: 25,
    table: 0,
    number: 0,
  }))
  const rawRows = rows.map(row => row.map(value => (value === null ? null : Buffer.from(value))))
  const result = Object.assign([], { command: "SELECT", count: rows.length, columns })
  const sql = {
    options: { transform: { column: {}, value: {}, row: {} } },
    typed: (value: unknown, type: number) => ({ value, type }),
    unsafe: () => ({
      raw: () => ({
        async forEach(visit: (row: (Buffer | null)[]) => void) {
          for (const row of rawRows) visit(row)
          return result
        },
      }),
    }),
    end: () => Promise.resolve(),
  }
  return postgresJsDriver(sql as unknown as Parameters<typeof postgresJsDriver>[0])
}
