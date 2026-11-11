import { describe, expect, it } from "bun:test"

import * as t from "kern-db/types"

import { describePostgres } from "../../testing/postgres"
import type { MigrationChange, MigrationDatabase } from "../migration"
import { runChange } from "../migration"

import { combineSteps, invertStep } from "./step"
import { inHelperSchema } from "./testing"

describe("invertStep", () => {
  it("swaps up and down", () => {
    expect(invertStep({ up: "CREATE TABLE form ()", down: "DROP TABLE form" })).toEqual({
      up: "DROP TABLE form",
      down: "CREATE TABLE form ()",
    })
  })

  it("swaps up and down of the changes outside a transaction too", () => {
    expect(
      invertStep({
        up: "CREATE INDEX form_name_idx ON form (name)",
        down: "DROP INDEX form_name_idx",
        outsideTransaction: {
          up: "CREATE INDEX CONCURRENTLY form_name_idx ON form (name)",
          down: "DROP INDEX CONCURRENTLY form_name_idx",
        },
      }),
    ).toStrictEqual({
      up: "DROP INDEX form_name_idx",
      down: "CREATE INDEX form_name_idx ON form (name)",
      outsideTransaction: {
        up: "DROP INDEX CONCURRENTLY form_name_idx",
        down: "CREATE INDEX CONCURRENTLY form_name_idx ON form (name)",
      },
    })
    expect(
      invertStep({
        up: "CREATE INDEX form_name_idx ON form (name)",
        down: "DROP INDEX form_name_idx",
        outsideTransaction: { up: "CREATE INDEX CONCURRENTLY form_name_idx ON form (name)" },
      }),
    ).toStrictEqual({
      up: "DROP INDEX form_name_idx",
      down: "CREATE INDEX form_name_idx ON form (name)",
      outsideTransaction: { down: "CREATE INDEX CONCURRENTLY form_name_idx ON form (name)" },
    })
  })

  it("rejects a step without down", () => {
    expect(() => invertStep({ up: "UPDATE form SET slug = ''" })).toThrow(
      "Cannot invert a step without down",
    )
  })

  it("rejects a step with a misspelled down instead of hiding it", () => {
    const step = { up: "CREATE TABLE form ()", donw: "DROP TABLE form" }

    expect(() => invertStep(step)).toThrow("The step of invertStep has unknown property donw")
  })
})

describe("combineSteps", () => {
  it("joins the scripts of up in order and those of down in reverse order, skipping a step without down", () => {
    expect(
      combineSteps(
        { up: "CREATE TABLE form ()", down: "DROP TABLE form" },
        { up: "UPDATE app SET version = 2" },
        { up: "CREATE TABLE tag ()", down: "DROP TABLE tag" },
      ),
    ).toEqual({
      up: "CREATE TABLE form ()\n;\nUPDATE app SET version = 2\n;\nCREATE TABLE tag ()",
      down: "DROP TABLE tag\n;\nDROP TABLE form",
    })
  })

  it("keeps the change of one step and leaves out down when no step has one", () => {
    const up = async () => {}

    expect(combineSteps({ up }, { up: "UPDATE app SET version = 2" }).down).toBeUndefined()
    expect(combineSteps({ up, down: "DROP TABLE form" })).toEqual({ up, down: "DROP TABLE form" })
  })

  it("runs the functions and scripts of each direction in order, waiting for each", async () => {
    const statements: string[] = []
    let gate = Promise.withResolvers<void>()
    const database: MigrationDatabase = {
      query: () => {
        throw new Error("Unexpected query")
      },
      script: async (text: string | TemplateStringsArray) => {
        statements.push(String(text))
      },
      execute: () => {
        throw new Error("Unexpected statement")
      },
    }
    const wait = (name: string) => async () => {
      statements.push(`${name} started`)
      await gate.promise
      statements.push(`${name} ended`)
    }
    const step = combineSteps(
      { up: "CREATE TABLE form ()", down: "DROP TABLE form" },
      { up: wait("convert"), down: wait("restore") },
      { up: "CREATE TABLE tag ()", down: "DROP TABLE tag" },
    )
    /** Runs `change` and lists the statements before and after the function of the middle step resolves. */
    const run = async (change: MigrationChange) => {
      statements.length = 0
      gate = Promise.withResolvers<void>()
      const running = runChange(database, change)
      await new Promise(resolve => setTimeout(resolve, 10))
      const waiting = [...statements]
      gate.resolve()
      await running
      return { waiting, done: [...statements] }
    }

    expect(await run(step.up)).toEqual({
      waiting: ["CREATE TABLE form ()", "convert started"],
      done: ["CREATE TABLE form ()", "convert started", "convert ended", "CREATE TABLE tag ()"],
    })
    expect(await run(step.down!)).toEqual({
      waiting: ["DROP TABLE tag", "restore started"],
      done: ["DROP TABLE tag", "restore started", "restore ended", "DROP TABLE form"],
    })
  })

  it("rejects a step with a misspelled down instead of hiding it", () => {
    const step = { up: "CREATE TABLE form ()", donw: "DROP TABLE form" }

    expect(() => combineSteps({ up: "CREATE TABLE tag ()" }, step)).toThrow(
      "Step 2 of combineSteps has unknown property donw",
    )
  })

  it("rejects a step with outsideTransaction, which must be the only step of its migration", () => {
    const step = {
      up: "CREATE INDEX form_name_idx ON form (name)",
      outsideTransaction: { up: "CREATE INDEX CONCURRENTLY form_name_idx ON form (name)" },
    }

    expect(() => combineSteps(step)).toThrow(
      "Step 1 of combineSteps has outsideTransaction, so it must be the only step of its migration",
    )
  })

  it("rejects an empty list of steps", () => {
    expect(() => combineSteps()).toThrow("combineSteps requires at least one step")
  })
})

describePostgres("combineSteps in PostgreSQL", ({ database, testTransaction }) => {
  it("runs a script after one that ends with a line comment", async () => {
    const step = combineSteps(
      { up: "CREATE TABLE form (id integer) -- forms" },
      { up: "CREATE TABLE tag (id integer)" },
    )

    const tables = await testTransaction(() =>
      inHelperSchema(database, async () => {
        await runChange(database, step.up)
        return await database.query`
          SELECT table_name::text FROM information_schema.tables WHERE table_schema = 'migrations_helpers' ORDER BY table_name
        `.pluck(t.text)
      }),
    )

    expect(tables).toEqual(["form", "tag"])
  })
})
