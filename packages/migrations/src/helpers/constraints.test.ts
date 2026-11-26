import { describe, expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"

import { describePostgres } from "../../testing/postgres"

import {
  addConstraint,
  addConstraints,
  changeConstraint,
  dropConstraint,
  dropConstraints,
} from "./constraints"
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

describe("addConstraints", () => {
  it("adds quoted constraints of definitions in one statement, and drops them", () => {
    expect(
      addConstraints("form", {
        form_price_check: "CHECK (price > 0)",
        form_slug_key: "UNIQUE (slug)",
      }),
    ).toEqual({
      up: 'ALTER TABLE "form" ADD CONSTRAINT "form_price_check" CHECK (price > 0), ADD CONSTRAINT "form_slug_key" UNIQUE (slug)',
      down: 'ALTER TABLE "form" DROP CONSTRAINT "form_slug_key", DROP CONSTRAINT "form_price_check"',
    })
  })

  it("rejects an empty record", () => {
    expect(getThrownError(() => addConstraints("form", {}))).toEqual(
      new Error("Cannot alter table form: the changes are empty"),
    )
  })
})

describe("dropConstraints", () => {
  it("drops constraints in one statement, and adds them again as addConstraints does", () => {
    expect(
      dropConstraints("form", {
        form_price_check: "CHECK (price > 0)",
        form_slug_key: "UNIQUE (slug)",
      }),
    ).toEqual({
      up: 'ALTER TABLE "form" DROP CONSTRAINT "form_slug_key", DROP CONSTRAINT "form_price_check"',
      down: 'ALTER TABLE "form" ADD CONSTRAINT "form_price_check" CHECK (price > 0), ADD CONSTRAINT "form_slug_key" UNIQUE (slug)',
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
      before: ["column form.price integer", "table form"],
      up: [
        "column form.price integer",
        "constraint form.form_price_check CHECK ((price > 0))",
        "table form",
      ],
      down: ["column form.price integer", "table form"],
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

    expect(result.up).toEqual(["column form.price integer", "table form"])
    expect(result.down).toEqual(result.before)
  })

  it("addConstraints adds constraints, and its rollback drops them", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        addConstraints("form", {
          form_price_check: "CHECK (price > 0)",
          form_slug_check: "CHECK (slug <> '') NOT VALID",
        }),
        "CREATE TABLE form (price integer, slug text)",
      ),
    )

    expect(result).toEqual({
      before: ["column form.price integer", "column form.slug text", "table form"],
      up: [
        "column form.price integer",
        "column form.slug text",
        "constraint form.form_price_check CHECK ((price > 0))",
        "constraint form.form_slug_check CHECK ((slug <> ''::text)) NOT VALID",
        "table form",
      ],
      down: ["column form.price integer", "column form.slug text", "table form"],
    })
  })

  it("addConstraints adds constraints, and its rollback drops a foreign key before the unique constraint that it references", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        addConstraints("form", {
          form_code_key: "UNIQUE (code)",
          form_parent_code_fkey: "FOREIGN KEY (parent_code) REFERENCES form (code)",
        }),
        "CREATE TABLE form (code text, parent_code text)",
      ),
    )

    expect(result.up).toEqual([
      "column form.code text",
      "column form.parent_code text",
      "constraint form.form_code_key UNIQUE (code)",
      "constraint form.form_parent_code_fkey FOREIGN KEY (parent_code) REFERENCES form(code)",
      "index CREATE UNIQUE INDEX form_code_key ON migrations_helpers.form USING btree (code)",
      "table form",
    ])
    expect(result.down).toEqual(result.before)
  })

  it("dropConstraints drops constraints, and its rollback adds them again", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        dropConstraints("form", {
          form_price_check: "CHECK (price > 0)",
          form_slug_check: "CHECK (slug <> '')",
        }),
        `
          CREATE TABLE form (price integer, slug text);
          ALTER TABLE form ADD CONSTRAINT form_price_check CHECK (price > 0), ADD CONSTRAINT form_slug_check CHECK (slug <> '');
        `,
      ),
    )

    expect(result.up).toEqual(["column form.price integer", "column form.slug text", "table form"])
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
      before: [
        "column form.price integer",
        "constraint form.form_price_check CHECK ((price > 0))",
        "table form",
      ],
      up: [
        "column form.price integer",
        "constraint form.form_price_check CHECK ((price >= 0))",
        "table form",
      ],
      down: [
        "column form.price integer",
        "constraint form.form_price_check CHECK ((price > 0))",
        "table form",
      ],
    })
  })
})
