// A test transaction around each test with its hooks, which takes the signal of the test.
import { afterAll, aroundEach } from "vitest"

import { database } from "../postgres.mjs"

import { testTransaction } from "./helpers.mjs"

afterAll(() => database.close())

aroundEach((runTest, { signal }) => testTransaction(runTest, { signal }))
