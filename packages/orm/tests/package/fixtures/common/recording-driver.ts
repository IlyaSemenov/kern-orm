// Driver of the fixtures without PostgreSQL, which records each statement with its connection and answers it with the rows that `respond` gives; it imports no package, so that the consumers of kern-orm and of kern-db share it.

/** Statement or release that the driver recorded, with its connection: `pool`, or the number of an acquired connection. */
export interface RecordedStatement {
  readonly connection: "pool" | number
  readonly text: string
  readonly parameters: readonly (string | null)[]
}

/** Result columns and rows that the driver answers a statement with. */
export interface Rows {
  readonly columns: readonly string[]
  readonly rows: readonly (readonly (string | null)[])[]
}

/** Creates a driver that records its statements and answers each with `respond`, by default with no rows. */
export function createRecordingDriver(
  respond: (text: string) => Rows = () => ({ columns: [], rows: [] }),
) {
  const statements: RecordedStatement[] = []
  let acquired = 0

  const execute =
    (connection: RecordedStatement["connection"]) =>
    async (statement: {
      readonly text: string
      readonly parameters: readonly (string | null)[]
    }) => {
      statements.push({ connection, text: statement.text, parameters: statement.parameters })
      const { columns, rows } = respond(statement.text)
      return { command: statement.text.split(" ", 1)[0]!, count: rows.length, columns, rows }
    }
  const executeScript = (connection: RecordedStatement["connection"]) => async (text: string) => {
    statements.push({ connection, text, parameters: [] })
  }

  const driver = {
    execute: execute("pool"),
    executeScript: executeScript("pool"),
    async acquire() {
      const connection = ++acquired
      return {
        execute: execute(connection),
        executeScript: executeScript(connection),
        release() {
          statements.push({ connection, text: "release", parameters: [] })
        },
      }
    },
    close: async () => {},
  }
  return { driver, statements }
}
