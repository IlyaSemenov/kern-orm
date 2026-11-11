// A test file with its own fixture.
import { test } from "node:test"

import { run } from "../database.mjs"

import { testTransaction, useTestFixture } from "./helpers.mjs"

useTestFixture(() => run("file data"))

test("runs in the fixture of its file", () => testTransaction(() => run("test")))
