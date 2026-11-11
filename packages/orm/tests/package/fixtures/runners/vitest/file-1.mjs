// A test file with its own fixture and a hook that runs in the test transaction of each test.
import { beforeEach, test } from "vitest"

import { run } from "../database.mjs"

import { useTestFixture } from "./helpers.mjs"

useTestFixture(() => run("file data"))

beforeEach(() => run("before each"))

test("runs in the fixture of its file", () => run("test"))
