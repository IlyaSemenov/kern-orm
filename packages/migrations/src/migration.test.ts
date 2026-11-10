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

  it("accepts a step with outsideTransaction as the only step of its migration", () => {
    const step = {
      up: "CREATE INDEX form_name_idx ON form (name)",
      down: "DROP INDEX form_name_idx",
      outsideTransaction: { up: "CREATE INDEX CONCURRENTLY form_name_idx ON form (name)" },
    }

    expect(toMigrationSteps("0002_index_form", step)).toEqual([step])
    expect(toMigrationSteps("0002_index_form", [step])).toEqual([step])
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
    ["requires up as a non-blank SQL script or a function", { down: "SELECT 1" }],
    [
      "requires down as a non-blank SQL script or a function, or no down",
      { up: "SELECT 1", down: 1 },
    ],
    [
      "requires outsideTransaction as an object with up, down, or both",
      { up: "SELECT 1", outsideTransaction: "SELECT 2" },
    ],
    [
      "requires outsideTransaction as an object with up, down, or both",
      { up: "SELECT 1", outsideTransaction: {} },
    ],
    [
      "has unknown property outsideTransaction.donw",
      {
        up: "SELECT 1",
        down: "SELECT 2",
        outsideTransaction: { up: "SELECT 3", donw: "SELECT 4" },
      },
    ],
    [
      "requires outsideTransaction.up as a non-blank SQL script or a function, or no outsideTransaction.up",
      { up: "SELECT 1", outsideTransaction: { up: " " } },
    ],
    [
      "requires outsideTransaction.down as a non-blank SQL script or a function, or no outsideTransaction.down",
      { up: "SELECT 1", down: "SELECT 2", outsideTransaction: { down: 1 } },
    ],
    [
      "has outsideTransaction.down without down, which rolls the step back in a transaction",
      { up: "SELECT 1", outsideTransaction: { down: "SELECT 2" } },
    ],
  ])("rejects a step that %s", (problem, step) => {
    expect(() => toMigrationSteps("0001_form", [step])).toThrow(
      `Step 1 of migration 0001_form ${problem}`,
    )
  })

  it("rejects a step with outsideTransaction beside other steps, since a migration records no progress of its steps", () => {
    const error = getError(() =>
      toMigrationSteps("0002_index_form", [
        { up: "ALTER TABLE form ADD COLUMN name text" },
        { up: "CREATE INDEX form_name_idx ON form (name)", outsideTransaction: { up: "SELECT 1" } },
      ]),
    )

    expect(error).toBeInstanceOf(MigrationError)
    expect(error).toMatchObject({
      message:
        "Step 2 of migration 0002_index_form has outsideTransaction, so it must be the only step of its migration",
      key: "0002_index_form",
      step: 2,
    })
  })

  it("rejects blank SQL text of up and down, such as of the template of a new migration", () => {
    expect(() => toMigrationSteps("0001_form", { up: " \n ", down: "DROP TABLE form" })).toThrow(
      "Step 1 of migration 0001_form requires up as a non-blank SQL script or a function",
    )
    expect(() =>
      toMigrationSteps("0001_form", { up: "CREATE TABLE form (id integer)", down: "" }),
    ).toThrow(
      "Step 1 of migration 0001_form requires down as a non-blank SQL script or a function, or no down",
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
