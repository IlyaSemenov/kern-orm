// Opens the fixture of the whole run, as a project migrates its database once.
import { afterAll } from "bun:test"

import { lateResults, releases, run, statements, useTestFixture } from "./database"

useTestFixture(() => run("migrate"))

afterAll(() => {
  console.log(`RESULT ${JSON.stringify({ statements, releases, lateResults })}`)
})
