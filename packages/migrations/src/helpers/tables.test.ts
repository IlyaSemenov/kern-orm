import { describe, expect, it } from "bun:test"

import { describePostgres } from "../../testing/postgres"

import { createTable, dropTable, renameTable } from "./tables"
import { applyStep } from "./testing"

const formColumns = {
  id: "integer PRIMARY KEY",
  order: "integer NOT NULL",
}

const formConstraints = {
  form_order_check: 'CHECK ("order" > 0)',
}

describe("createTable", () => {
  it("creates a table of quoted columns and named constraints, and drops it", () => {
    expect(
      createTable("form", formColumns, { constraints: { form_order_key: 'UNIQUE ("order")' } }),
    ).toEqual({
      up: 'CREATE TABLE "form" (\n  "id" integer PRIMARY KEY,\n  "order" integer NOT NULL,\n  CONSTRAINT "form_order_key" UNIQUE ("order")\n)',
      down: 'DROP TABLE "form"',
    })
  })
})

describe("dropTable", () => {
  it("drops a table, and creates it again as createTable does", () => {
    expect(dropTable("form", formColumns)).toEqual({
      up: 'DROP TABLE "form"',
      down: 'CREATE TABLE "form" (\n  "id" integer PRIMARY KEY,\n  "order" integer NOT NULL\n)',
    })
  })
})

describe("renameTable", () => {
  it("renames a table, and renames it back", () => {
    expect(renameTable("form", "survey")).toEqual({
      up: 'ALTER TABLE "form" RENAME TO "survey"',
      down: 'ALTER TABLE "survey" RENAME TO "form"',
    })
  })
})

describePostgres("table helpers in PostgreSQL", ({ database, testTransaction }) => {
  it("createTable creates a table with its columns and constraints, and its rollback drops it", async () => {
    const result = await testTransaction(() =>
      applyStep(database, createTable("form", formColumns, { constraints: formConstraints })),
    )

    expect(result).toEqual({
      before: [],
      up: [
        "column form.id integer NOT NULL",
        "column form.order integer NOT NULL",
        'constraint form.form_order_check CHECK (("order" > 0))',
        "constraint form.form_pkey PRIMARY KEY (id)",
        "index CREATE UNIQUE INDEX form_pkey ON migrations_helpers.form USING btree (id)",
      ],
      down: [],
    })
  })

  it("dropTable drops a table, and its rollback creates it again", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        dropTable("form", formColumns, { constraints: formConstraints }),
        'CREATE TABLE form (id integer PRIMARY KEY, "order" integer NOT NULL CONSTRAINT form_order_check CHECK ("order" > 0))',
      ),
    )

    expect(result.up).toEqual([])
    expect(result.down).toEqual(result.before)
  })

  it("renameTable renames a table, and its rollback renames it back", async () => {
    const result = await testTransaction(() =>
      applyStep(database, renameTable("form", "survey"), "CREATE TABLE form (id integer)"),
    )

    expect(result).toEqual({
      before: ["column form.id integer"],
      up: ["column survey.id integer"],
      down: ["column form.id integer"],
    })
  })
})
