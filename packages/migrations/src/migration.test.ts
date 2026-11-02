import { describe, expect, it } from "bun:test"

import { MigrationError } from "./error"
import { toMigrationSteps } from "./migration"

describe("toMigrationSteps", () => {
  it("returns a step as the only step and an array of steps as it is", () => {
    const step = { up: "CREATE TABLE form (id integer)", down: "DROP TABLE form" }
    const steps = [step, { up: async () => {} }]

    expect(toMigrationSteps("0001_form", step)).toEqual([step])
    expect(toMigrationSteps("0001_form", steps)).toBe(steps)
  })

  // rake-db 2.37.48 recorded a migration that registered no changes as applied: https://github.com/romeerez/orchid-orm/issues/765
  it.each([
    ["no default export", undefined],
    ["a string", "CREATE TABLE form (id integer)"],
    ["an empty array", []],
  ])("rejects %s", (_, value) => {
    expect(() => toMigrationSteps("0001_form", value)).toThrow(
      new MigrationError(
        "Migration 0001_form must export a step or a non-empty array of steps as its default export",
        { key: "0001_form" },
      ),
    )
  })

  it("rejects a step with a misspelled down, which would do nothing on rollback", () => {
    const error = getError(() =>
      toMigrationSteps("0001_form", [{ up: "SELECT 1" }, { up: "SELECT 2", donw: "SELECT 3" }]),
    )

    expect(error).toBeInstanceOf(MigrationError)
    expect(error).toMatchObject({
      message: "Step 2 of migration 0001_form has unknown property donw",
      key: "0001_form",
      step: 2,
    })
  })

  it.each([
    ["is not an object with up and an optional down", null],
    ["requires up as a SQL script or a function", { down: "SELECT 1" }],
    ["requires down as a SQL script or a function, or no down", { up: "SELECT 1", down: 1 }],
  ])("rejects a step that %s", (problem, step) => {
    expect(() => toMigrationSteps("0001_form", [step])).toThrow(
      `Step 1 of migration 0001_form ${problem}`,
    )
  })
})

/** Returns the error that `callback` throws. */
function getError(callback: () => unknown): unknown {
  try {
    callback()
  } catch (error) {
    return error
  }
  throw new Error("Expected an error")
}
