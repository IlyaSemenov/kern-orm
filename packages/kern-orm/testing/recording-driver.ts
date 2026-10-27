import type { Connection, Driver, DriverResult, SqlStatement, TransactionFailure } from "kern-orm"

/** Executed statement with the connection that ran it: `pool` or the number of an acquired connection. */
export interface RecordedStatement {
  connection: "pool" | number
  text: string
  parameters: readonly unknown[]
}

/** Release of an acquired connection, with the failure of its transaction if there was one. */
export interface RecordedRelease {
  connection: number
  failure?: TransactionFailure
}

/** Options of `createRecordingDriver`. */
export interface RecordingDriverOptions {
  /** Answers a statement; it can wait or throw to fail it, and the command tag defaults to the first word of the statement. */
  respond?: (statement: SqlStatement) => Partial<DriverResult> | Promise<Partial<DriverResult>>
  /** Called on every release after it is recorded; it can throw to fail the release. */
  release?: (failure: TransactionFailure | undefined) => void | Promise<void>
}

/** In-memory driver that records statements and releases of connections. */
export function createRecordingDriver(options: RecordingDriverOptions = {}) {
  const { respond = (): Partial<DriverResult> => ({}), release = () => {} } = options
  const statements: RecordedStatement[] = []
  const releases: RecordedRelease[] = []
  let acquired = 0
  // Acquired connections that are not released yet, which closing waits for.
  let held = 0
  let closing: PromiseWithResolvers<void> | undefined

  async function execute(
    connection: RecordedStatement["connection"],
    statement: SqlStatement,
  ): Promise<DriverResult> {
    statements.push({ connection, text: statement.text, parameters: statement.parameters })
    const { command = statement.text.split(" ", 1)[0]!, rows = [] } = await respond(statement)
    return { command, rows }
  }

  const driver: Driver = {
    execute: statement => execute("pool", statement),
    acquire() {
      const id = ++acquired
      held++
      // An acquired connection answers its statements one at a time in the order of calls, as the driver contract requires.
      let queue: Promise<unknown> = Promise.resolve()
      const connection: Connection = {
        execute(statement) {
          const result = queue.then(() => execute(id, statement))
          queue = result.catch(() => {})
          return result
        },
        async release(failure) {
          releases.push(failure ? { connection: id, failure } : { connection: id })
          try {
            await release(failure)
          } finally {
            if (--held === 0) {
              closing?.resolve()
            }
          }
        },
      }
      return Promise.resolve(connection)
    },
    close() {
      closing ??= Promise.withResolvers()
      if (held === 0) {
        closing.resolve()
      }
      return closing.promise
    },
  }

  return { driver, statements, releases }
}
