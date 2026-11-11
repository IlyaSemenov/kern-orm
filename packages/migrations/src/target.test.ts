import { describe, expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"
import type { Driver } from "kern-db"
import { createDatabase } from "kern-db"
import { bindSchema, defineSchema } from "kern-orm"
import postgres from "postgres"

import { checkTargetArguments, getTargetDatabase, isMigrationTarget } from "./target"

/** Driver that rejects every statement, which the tests below never run. */
const driver: Driver = {
  execute: () => Promise.reject(new Error("No statement runs")),
  executeScript: () => Promise.reject(new Error("No statement runs")),
  acquire: () => Promise.reject(new Error("No statement runs")),
  close: async () => {},
}
const database = createDatabase({ driver })

describe("isMigrationTarget", () => {
  it("recognizes a Db, a Database, and a Driver", () => {
    expect(isMigrationTarget(bindSchema(defineSchema({}), database))).toBe(true)
    expect(isMigrationTarget(database)).toBe(true)
    expect(isMigrationTarget(driver)).toBe(true)
  })

  it("recognizes a Db without reading its schema, whose function may need a context", () => {
    const db = bindSchema(defineSchema({}), database, {
      schemaName: () => {
        throw new Error("No tenant in the context")
      },
    })

    expect(isMigrationTarget(db)).toBe(true)
  })

  it("rejects another value, such as a client of PostgreSQL or an object with a database that is not one", () => {
    // postgres.js connects only at the first query.
    const sql = postgres("postgres://localhost/none")

    expect(isMigrationTarget(sql)).toBe(false)
    expect(isMigrationTarget({ $database: driver, $schemaName: undefined })).toBe(false)
    expect(isMigrationTarget({ $database: database })).toBe(false)
    expect(isMigrationTarget(null)).toBe(false)
    expect(isMigrationTarget(undefined)).toBe(false)
  })
})

describe("getTargetDatabase", () => {
  it("returns the database of a Db, a Database itself, and a new database over a Driver", () => {
    const fromDriver = getTargetDatabase(driver)

    expect(getTargetDatabase(bindSchema(defineSchema({}), database))).toBe(database)
    expect(getTargetDatabase(database)).toBe(database)
    expect(fromDriver).not.toBe(database)
    expect(typeof fromDriver.transaction).toBe("function")
  })

  it("throws TypeError for a value that is not a target", () => {
    expect(getThrownError(() => getTargetDatabase({} as never))).toEqual(
      new TypeError(
        "The target of migrations must be a Db of kern-orm, or a Database or a driver of kern-db",
      ),
    )
  })
})

describe("checkTargetArguments", () => {
  it("accepts a target with options without schemaName or with a schema name", () => {
    expect(() => checkTargetArguments(database, {})).not.toThrow()
    expect(() => checkTargetArguments(database, { schemaName: undefined })).not.toThrow()
    expect(() => checkTargetArguments(database, { schemaName: "tenant_acme" })).not.toThrow()
  })

  it("throws TypeError for a value that is not a target before checking the options", () => {
    expect(getThrownError(() => checkTargetArguments({}, { schemaName: "" }))).toEqual(
      new TypeError(
        "The target of migrations must be a Db of kern-orm, or a Database or a driver of kern-db",
      ),
    )
  })

  it.each([5, null, ""])("throws TypeError for schemaName %p", schemaName => {
    expect(
      getThrownError(() => checkTargetArguments(database, { schemaName: schemaName as never })),
    ).toEqual(new TypeError("schemaName must be a string that is not empty"))
  })
})
