// Database for tests of the runner scenarios, whose driver records every statement and release as a JSON line of the file at LOG.
import { appendFileSync } from "node:fs"

import { createDatabase, createStatement } from "kern-orm"

function record(text) {
  appendFileSync(process.env.LOG, `${JSON.stringify({ pid: process.pid, text })}\n`)
  return { command: text.split(" ", 1)[0], rows: [] }
}

const driver = {
  execute: statement => Promise.resolve(record(statement.text)),
  acquire() {
    // A connection runs its statements one at a time in the order of calls.
    let queue = Promise.resolve()
    return Promise.resolve({
      execute(statement) {
        const result = queue.then(() => record(statement.text))
        queue = result.catch(() => {})
        return result
      },
      release() {
        record("release")
      },
    })
  },
  close: () => Promise.resolve(),
}

export const database = createDatabase({ driver, test: true })

/** Executes a statement named `text`. */
export async function run(text) {
  await database.execute(createStatement(text))
}
