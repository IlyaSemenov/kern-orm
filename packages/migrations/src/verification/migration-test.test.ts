import { describe, expect, it } from "bun:test"

import type { MigrationTestOptions } from "./migration-test"
import { defineMigrationTest, findMigrationTestProblem } from "./migration-test"

const callback = async () => {}

describe("defineMigrationTest", () => {
  it("returns a plain object of the name and the callbacks", () => {
    expect(defineMigrationTest("fills slugs", { setup: callback, assertUp: callback })).toEqual({
      name: "fills slugs",
      setup: callback,
      assertUp: callback,
    })
  })

  it("rejects a misspelled callback, which would never run", () => {
    const test = { setup: callback, assertDonw: callback } as MigrationTestOptions

    expect(() => defineMigrationTest("fills slugs", test)).toThrow(
      'Migration test "fills slugs" has unknown property assertDonw',
    )
  })

  it("rejects assertUpError together with assertUp", () => {
    const test = { assertUp: callback, assertUpError: callback } as unknown as MigrationTestOptions

    expect(() => defineMigrationTest("rejects duplicates", test)).toThrow(
      'Migration test "rejects duplicates" has assertUpError together with assertUp or assertDown',
    )
  })
})

describe("findMigrationTestProblem", () => {
  it.each([
    [{ name: "seeds", assertUp: callback }],
    [{ name: "applies to rows", setup: callback }],
    [{ name: "rejects duplicates", setup: callback, assertUpError: callback }],
  ])("accepts %o", value => {
    expect(findMigrationTestProblem(value)).toBeUndefined()
  })

  it.each([
    [null, "is not an object with a name and callbacks"],
    [[{ name: "seeds", assertUp: callback }], "is not an object with a name and callbacks"],
    [{ name: " ", setup: callback }, "requires a non-blank name"],
    [{ setup: callback }, "requires a non-blank name"],
    [{ name: "seeds" }, "requires setup, assertUp, assertDown, or assertUpError"],
    [{ name: "seeds", assertUp: "SELECT 1" }, "requires assertUp as a function"],
    [
      { name: "seeds", assertDown: callback, assertUpError: callback },
      "has assertUpError together with assertUp or assertDown",
    ],
  ])("rejects %o", (value, problem) => {
    expect(findMigrationTestProblem(value)).toBe(problem)
  })
})
