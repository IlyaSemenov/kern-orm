// Fixture of the whole run of a test file, and a test transaction around each test with its hooks.
import { aroundEach } from "vitest"

import { run } from "../database.mjs"

import { testTransaction, useTestFixture } from "./helpers.mjs"

useTestFixture(() => run("migrate"))

aroundEach(runTest => testTransaction(runTest))
