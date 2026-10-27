// Fixture for one test file process, loaded with --import.
import { run } from "../database.mjs"

import { useTestFixture } from "./helpers.mjs"

useTestFixture(() => run("migrate"))
