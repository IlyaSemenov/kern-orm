import { describe, expect, it } from "bun:test"

import { describePostgres } from "../../testing/postgres"

import { addConstraint, changeConstraint, dropConstraint } from "./constraints"
import { applyStep } from "./testing"

describe("addConstraint", () => {
  it("adds a quoted constraint of a definition, and drops it", () => {
    expect(addConstraint("form", "form_price_check", "CHECK (price > 0)")).toEqual({
      up: 'ALTER TABLE "form" ADD CONSTRAINT "form_price_check" CHECK (price > 0)',
      down: 'ALTER TABLE "form" DROP CONSTRAINT "form_price_check"',
    })
  })
})

describe("dropConstraint", () => {
  it("drops a constraint, and adds it again as addConstraint does", () => {
    expect(dropConstraint("form", "form_price_check", "CHECK (price > 0)")).toEqual({
      up: 'ALTER TABLE "form" DROP CONSTRAINT "form_price_check"',
      down: 'ALTER TABLE "form" ADD CONSTRAINT "form_price_check" CHECK (price > 0)',
    })
  })
})

describe("changeConstraint", () => {
  it("replaces the definition of a constraint, and restores it on rollback", () => {
    expect(
      changeConstraint("form", "form_price_check", "CHECK (price > 0)", "CHECK (price >= 0)"),
    ).toEqual({
      up: 'ALTER TABLE "form" DROP CONSTRAINT "form_price_check"\n;\nALTER TABLE "form" ADD CONSTRAINT "form_price_check" CHECK (price >= 0)',
      down: 'ALTER TABLE "form" DROP CONSTRAINT "form_price_check"\n;\nALTER TABLE "form" ADD CONSTRAINT "form_price_check" CHECK (price > 0)',
    })
  })
})

describePostgres("constraint helpers in PostgreSQL", ({ database, testTransaction }) => {
  it("addConstraint adds a constraint, and its rollback drops it", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        addConstraint("form", "form_price_check", "CHECK (price > 0)"),
        "CREATE TABLE form (price integer)",
      ),
    )

    expect(result).toEqual({
      before: ["column form.price integer"],
      up: ["column form.price integer", "constraint form.form_price_check CHECK ((price > 0))"],
      down: ["column form.price integer"],
    })
  })

  it("dropConstraint drops a constraint, and its rollback adds it again", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        dropConstraint("form", "form_price_check", "CHECK (price > 0)"),
        "CREATE TABLE form (price integer CONSTRAINT form_price_check CHECK (price > 0))",
      ),
    )

    expect(result.up).toEqual(["column form.price integer"])
    expect(result.down).toEqual(result.before)
  })

  it("changeConstraint replaces the definition of a constraint, and its rollback restores it", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        changeConstraint("form", "form_price_check", "CHECK (price > 0)", "CHECK (price >= 0)"),
        "CREATE TABLE form (price integer CONSTRAINT form_price_check CHECK (price > 0))",
      ),
    )

    expect(result).toEqual({
      before: ["column form.price integer", "constraint form.form_price_check CHECK ((price > 0))"],
      up: ["column form.price integer", "constraint form.form_price_check CHECK ((price >= 0))"],
      down: ["column form.price integer", "constraint form.form_price_check CHECK ((price > 0))"],
    })
  })
})
