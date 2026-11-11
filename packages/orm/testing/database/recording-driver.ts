import type { Connection, Driver, DriverResult, SqlStatement } from "kern-orm/db"

/** Executed statement with the connection that ran it: `pool` or the number of an acquired connection. */
export interface RecordedStatement {
  connection: "pool" | number
  text: string
  parameters: readonly unknown[]
}

/** Executed script of statements without parameters with the connection that ran it, as for a statement. */
export interface RecordedScript {
  connection: RecordedStatement["connection"]
  script: string
}

/** Release of an acquired connection. */
export interface RecordedRelease {
  connection: number
}

/** Options of `createRecordingDriver`. */
export interface RecordingDriverOptions {
  /** Answers a statement, or a script without parameters, whose result it ignores; it can wait or throw to fail it, the command tag defaults to the first word of the statement, the number of rows of the command tag to the number of the rows, and the columns to none. */
  respond?: (statement: SqlStatement) => Partial<DriverResult> | Promise<Partial<DriverResult>>
  /** Called on every acquire before the connection is returned; it can wait to delay the connection or throw to fail the acquire. */
  acquire?: () => void | Promise<void>
  /** Called on every release after it is recorded; it can throw to fail the release. */
  release?: () => void | Promise<void>
}

/** In-memory driver that records statements, scripts, and releases of connections. */
export function createRecordingDriver(options: RecordingDriverOptions = {}) {
  const {
    respond = (): Partial<DriverResult> => ({}),
    acquire = () => {},
    release = () => {},
  } = options
  const statements: RecordedStatement[] = []
  const scripts: RecordedScript[] = []
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
    const {
      command = statement.text.split(" ", 1)[0]!,
      columns = [],
      rows = [],
      count = rows.length,
    } = await respond(statement)
    return { command, count, columns, rows }
  }

  async function executeScript(
    connection: RecordedStatement["connection"],
    text: string,
  ): Promise<void> {
    scripts.push({ connection, script: text })
    await respond({ text, parameters: [] })
  }

  const driver: Driver = {
    execute: statement => execute("pool", statement),
    executeScript: text => executeScript("pool", text),
    async acquire() {
      // Closing waits for a connection that is still being acquired, as the driver contract requires.
      held++
      try {
        await acquire()
      } catch (error) {
        if (--held === 0) {
          closing?.resolve()
        }
        throw error
      }
      const id = ++acquired
      // An acquired connection answers its statements one at a time in the order of calls, as the driver contract requires.
      let queue: Promise<unknown> = Promise.resolve()
      const connection: Connection = {
        execute(statement) {
          const result = queue.then(() => execute(id, statement))
          queue = result.catch(() => {})
          return result
        },
        executeScript(text) {
          const result = queue.then(() => executeScript(id, text))
          queue = result.catch(() => {})
          return result
        },
        async release() {
          releases.push({ connection: id })
          try {
            await release()
          } finally {
            if (--held === 0) {
              closing?.resolve()
            }
          }
        },
      }
      return connection
    },
    close() {
      closing ??= Promise.withResolvers()
      if (held === 0) {
        closing.resolve()
      }
      return closing.promise
    },
  }

  return { driver, statements, scripts, releases }
}
