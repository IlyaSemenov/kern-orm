// Adds the matchers of `bun:test` that the tests use and Vitest lacks; Bun implements them after jest-extended.
import { toEndWith, toStartWith } from "jest-extended"
import { expect } from "vitest"

expect.extend({ toEndWith, toStartWith })
