import { afterAll, beforeAll, describe, it, test } from "bun:test"
import { after, before, describe as nodeDescribe, it as nodeIt } from "node:test"

import {
  afterAll as vitestAfterAll,
  beforeAll as vitestBeforeAll,
  describe as vitestDescribe,
  it as vitestIt,
} from "vitest"

import type { DriverContractRunner } from "./driver-contract"

describe("DriverContractRunner", () => {
  test("takes the functions of node:test", () => {
    ;({ describe: nodeDescribe, it: nodeIt, before, after }) satisfies DriverContractRunner
  })

  test("takes the functions of bun:test", () => {
    ;({ describe, it, before: beforeAll, after: afterAll }) satisfies DriverContractRunner
  })

  test("takes the functions of Vitest", () => {
    ;({
      describe: vitestDescribe,
      it: vitestIt,
      before: vitestBeforeAll,
      after: vitestAfterAll,
    }) satisfies DriverContractRunner
  })
})
