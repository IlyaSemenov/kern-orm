import { describe, expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"
import * as t from "kern-db/types"

import { describePostgres } from "../../testing/postgres"
import { runChange } from "../migration"

import { alterTable, createTable, dropTable, renameTable } from "./tables"
import { applyStep, inHelperSchema } from "./testing"

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

  it("ends a definition before another with a line break when it contains a line comment", () => {
    expect(
      createTable(
        "form",
        { width: "integer -- in pixels", height: "integer -- in pixels" },
        { constraints: { form_width_check: "CHECK (width > 0) -- positive" } },
      ).up,
    ).toBe(
      'CREATE TABLE "form" (\n  "width" integer -- in pixels\n,\n  "height" integer -- in pixels\n,\n  CONSTRAINT "form_width_check" CHECK (width > 0) -- positive\n)',
    )
  })

  it("creates a singleton table with its singleton index, and drops them", () => {
    expect(createTable("license", { token: "text" }, { singleton: true })).toEqual({
      up: 'CREATE TABLE "license" (\n  "token" text\n)\n;\nCREATE UNIQUE INDEX "license_singleton_idx" ON "license" ((true))',
      down: 'DROP INDEX "license_singleton_idx"\n;\nDROP TABLE "license"',
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

describe("alterTable", () => {
  it("drops constraints and columns before it adds columns and constraints, and undoes each on rollback", () => {
    expect(
      alterTable("form", {
        dropColumns: {
          legacy: "text",
        },
        dropConstraints: {
          form_legacy_check: "CHECK (legacy <> '')",
          form_price_check: "CHECK (price > 0)",
        },
        addColumns: {
          slug: "text",
        },
        addConstraints: {
          form_price_check: "CHECK (price >= 0)",
          form_slug_key: "UNIQUE (slug)",
        },
      }),
    ).toEqual({
      up: 'ALTER TABLE "form" DROP CONSTRAINT "form_price_check", DROP CONSTRAINT "form_legacy_check", DROP COLUMN "legacy", ADD COLUMN "slug" text, ADD CONSTRAINT "form_price_check" CHECK (price >= 0), ADD CONSTRAINT "form_slug_key" UNIQUE (slug)',
      down: 'ALTER TABLE "form" DROP CONSTRAINT "form_slug_key", DROP CONSTRAINT "form_price_check", DROP COLUMN "slug", ADD COLUMN "legacy" text, ADD CONSTRAINT "form_legacy_check" CHECK (legacy <> \'\'), ADD CONSTRAINT "form_price_check" CHECK (price > 0)',
    })
  })

  it("changes columns after the drops and before the adds, and changes them back on rollback", () => {
    expect(
      alterTable("form", {
        dropConstraints: {
          form_price_check: "CHECK (price <> '')",
        },
        changeColumns: {
          price: [
            { type: "text", using: "price::text" },
            { type: "integer", using: "price::integer" },
          ],
        },
        addConstraints: {
          form_price_check: "CHECK (price > 0)",
        },
      }),
    ).toEqual({
      up: 'ALTER TABLE "form" DROP CONSTRAINT "form_price_check", ALTER COLUMN "price" TYPE integer USING price::integer, ADD CONSTRAINT "form_price_check" CHECK (price > 0)',
      down: 'ALTER TABLE "form" DROP CONSTRAINT "form_price_check", ALTER COLUMN "price" TYPE text USING price::text, ADD CONSTRAINT "form_price_check" CHECK (price <> \'\')',
    })
  })

  it("rejects an unknown change, empty changes, a change that changeColumn rejects, and a changed column that it drops or adds", () => {
    const toInteger = [{ type: "text" }, { type: "integer" }] as const
    expect([
      getThrownError(() => alterTable("form", { addColumn: { slug: "text" } } as object)),
      getThrownError(() => alterTable("form", { addColumns: {} })),
      getThrownError(() =>
        alterTable("form", { changeColumns: { slug: [{ notNull: true }, { notNull: true }] } }),
      ),
      getThrownError(() =>
        alterTable("form", { dropColumns: { price: "text" }, changeColumns: { price: toInteger } }),
      ),
      getThrownError(() =>
        alterTable("form", { changeColumns: { price: toInteger }, addColumns: { price: "text" } }),
      ),
    ]).toEqual([
      new Error("Cannot alter table form: unknown change addColumn"),
      new Error("Cannot alter table form: the changes are empty"),
      new Error("Cannot change column slug of table form: the states change nothing"),
      new Error("Cannot alter table form: column price is both changed and dropped"),
      new Error("Cannot alter table form: column price is both changed and added"),
    ])
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
        "table form",
      ],
      down: [],
    })
  })

  it("createTable creates the columns and constraints after a definition that ends with a line comment", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        createTable(
          "form",
          { width: "integer -- in pixels", height: "integer" },
          {
            constraints: {
              form_width_check: "CHECK (width > 0) -- positive",
              form_height_check: "CHECK (height > 0)",
            },
          },
        ),
      ),
    )

    expect(result.up).toEqual([
      "column form.height integer",
      "column form.width integer",
      "constraint form.form_height_check CHECK ((height > 0))",
      "constraint form.form_width_check CHECK ((width > 0))",
      "table form",
    ])
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

  it("dropTable of a singleton table drops it, and its rollback creates it again with its singleton index", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        dropTable("license", { token: "text" }, { singleton: true }),
        "CREATE TABLE license (token text); CREATE UNIQUE INDEX license_singleton_idx ON license ((true))",
      ),
    )

    expect(result.before).toEqual([
      "column license.token text",
      "index CREATE UNIQUE INDEX license_singleton_idx ON migrations_helpers.license USING btree ((true))",
      "table license",
    ])
    expect(result.up).toEqual([])
    expect(result.down).toEqual(result.before)
  })

  it("renameTable renames a table, and its rollback renames it back", async () => {
    const result = await testTransaction(() =>
      applyStep(database, renameTable("form", "survey"), "CREATE TABLE form (id integer)"),
    )

    expect(result).toEqual({
      before: ["column form.id integer", "table form"],
      up: ["column survey.id integer", "table survey"],
      down: ["column form.id integer", "table form"],
    })
  })

  it("alterTable adds columns with constraints on them, and its rollback drops them", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        alterTable("job", {
          addColumns: {
            max_items: "integer",
            sealed: "boolean NOT NULL DEFAULT false",
          },
          addConstraints: {
            job_max_items_check: "CHECK (max_items >= 1)",
            job_sealed_check: "CHECK (NOT sealed OR max_items IS NOT NULL)",
          },
        }),
        "CREATE TABLE job (id integer); INSERT INTO job (id) VALUES (1)",
      ),
    )

    expect(result.up).toEqual([
      "column job.id integer",
      "column job.max_items integer",
      "column job.sealed boolean NOT NULL DEFAULT false",
      "constraint job.job_max_items_check CHECK ((max_items >= 1))",
      "constraint job.job_sealed_check CHECK (((NOT sealed) OR (max_items IS NOT NULL)))",
      "table job",
    ])
    expect(result.down).toEqual(result.before)
  })

  it("alterTable drops a column with its constraint and replaces another constraint, and its rollback restores them", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        alterTable("form", {
          dropColumns: {
            legacy: "text",
          },
          dropConstraints: {
            form_legacy_check: "CHECK (legacy <> '')",
            form_price_check: "CHECK (price > 0)",
          },
          addConstraints: {
            form_price_check: "CHECK (price >= 0)",
          },
        }),
        "CREATE TABLE form (price integer CONSTRAINT form_price_check CHECK (price > 0), legacy text CONSTRAINT form_legacy_check CHECK (legacy <> ''))",
      ),
    )

    expect(result.up).toEqual([
      "column form.price integer",
      "constraint form.form_price_check CHECK ((price >= 0))",
      "table form",
    ])
    expect(result.down).toEqual(result.before)
  })

  it("alterTable changes the type of a column while it replaces the constraint that checks it, and its rollback restores them", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        alterTable("form", {
          dropConstraints: {
            form_price_check: "CHECK (price <> '')",
          },
          changeColumns: {
            price: [
              { type: "text", using: "price::text" },
              { type: "integer", using: "price::integer" },
            ],
          },
          addConstraints: {
            form_price_check: "CHECK (price > 0)",
          },
        }),
        "CREATE TABLE form (price text CONSTRAINT form_price_check CHECK (price <> ''))",
      ),
    )

    expect(result.up).toEqual([
      "column form.price integer",
      "constraint form.form_price_check CHECK ((price > 0))",
      "table form",
    ])
    expect(result.down).toEqual(result.before)
  })

  it("alterTable converts a column with a using that reads a column that it drops, and its rollback converts it back", async () => {
    const step = alterTable("form", {
      dropColumns: {
        legacy_amount: "integer",
      },
      changeColumns: {
        amount: [
          { type: "text", using: "amount::text" },
          { type: "integer", using: "coalesce(amount::integer, legacy_amount)" },
        ],
      },
    })

    const result = await testTransaction(() =>
      inHelperSchema(database, async () => {
        await database.script(`
          CREATE TABLE form (id integer PRIMARY KEY, amount text, legacy_amount integer);
          INSERT INTO form (id, amount, legacy_amount) VALUES (1, '3', NULL), (2, NULL, 7);
        `)
        await runChange(database, step.up)
        const up = await database.query`SELECT amount::text FROM form ORDER BY id`.pluck(t.text)
        await runChange(database, step.down!)
        const down =
          await database.query`SELECT pg_typeof(amount)::text || ' ' || amount || ' ' || coalesce(legacy_amount::text, 'NULL') FROM form ORDER BY id`.pluck(
            t.text,
          )
        return { up, down }
      }),
    )

    expect(result).toEqual({ up: ["3", "7"], down: ["text 3 NULL", "text 7 NULL"] })
  })
})
