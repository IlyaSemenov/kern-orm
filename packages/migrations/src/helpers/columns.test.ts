import { describe, expect, it } from "bun:test"

import * as t from "kern-orm/types"

import { describePostgres } from "../../testing/postgres"
import { runChange } from "../migration"

import { addColumn, changeColumn, dropColumn, renameColumn } from "./columns"
import { dropConstraint } from "./constraints"
import { dropIndex } from "./indexes"
import { combineSteps } from "./step"
import { applyStep, describeSchema, inHelperSchema } from "./testing"

describe("addColumn", () => {
  it("adds a quoted column of a definition, and drops it", () => {
    expect(addColumn("form", "order", "integer NOT NULL DEFAULT 0")).toEqual({
      up: 'ALTER TABLE "form" ADD COLUMN "order" integer NOT NULL DEFAULT 0',
      down: 'ALTER TABLE "form" DROP COLUMN "order"',
    })
  })
})

describe("dropColumn", () => {
  it("drops a column, and adds it again as addColumn does", () => {
    expect(dropColumn("form", "slug", "text")).toEqual({
      up: 'ALTER TABLE "form" DROP COLUMN "slug"',
      down: 'ALTER TABLE "form" ADD COLUMN "slug" text',
    })
  })
})

describe("renameColumn", () => {
  it("renames a column, and renames it back", () => {
    expect(renameColumn("form", "name", "title")).toEqual({
      up: 'ALTER TABLE "form" RENAME COLUMN "name" TO "title"',
      down: 'ALTER TABLE "form" RENAME COLUMN "title" TO "name"',
    })
  })
})

describe("changeColumn", () => {
  it("changes the type with the using of each state, dropping the default before the type and setting it after", () => {
    expect(
      changeColumn(
        "form",
        "position",
        { type: "text", using: "position::text", default: "''" },
        { type: "integer", using: "position::integer", default: "0" },
      ),
    ).toEqual({
      up: 'ALTER TABLE "form" ALTER COLUMN "position" DROP DEFAULT, ALTER COLUMN "position" TYPE integer USING position::integer, ALTER COLUMN "position" SET DEFAULT 0',
      down: 'ALTER TABLE "form" ALTER COLUMN "position" DROP DEFAULT, ALTER COLUMN "position" TYPE text USING position::text, ALTER COLUMN "position" SET DEFAULT \'\'',
    })
  })

  it("sets the default again after a change of type when the default stays", () => {
    expect(
      changeColumn(
        "form",
        "count",
        { type: "integer", default: "0" },
        { type: "bigint", default: "0" },
      ),
    ).toEqual({
      up: 'ALTER TABLE "form" ALTER COLUMN "count" DROP DEFAULT, ALTER COLUMN "count" TYPE bigint, ALTER COLUMN "count" SET DEFAULT 0',
      down: 'ALTER TABLE "form" ALTER COLUMN "count" DROP DEFAULT, ALTER COLUMN "count" TYPE integer, ALTER COLUMN "count" SET DEFAULT 0',
    })
  })

  it("changes the type without emitting default actions when default is omitted from both states", () => {
    expect(changeColumn("form", "count", { type: "integer" }, { type: "bigint" })).toEqual({
      up: 'ALTER TABLE "form" ALTER COLUMN "count" TYPE bigint',
      down: 'ALTER TABLE "form" ALTER COLUMN "count" TYPE integer',
    })
  })

  it("sets and drops NOT NULL", () => {
    expect(changeColumn("form", "slug", { notNull: false }, { notNull: true })).toEqual({
      up: 'ALTER TABLE "form" ALTER COLUMN "slug" SET NOT NULL',
      down: 'ALTER TABLE "form" ALTER COLUMN "slug" DROP NOT NULL',
    })
  })

  it("sets, replaces, and drops a default without dropping it first", () => {
    expect([
      changeColumn("form", "slug", { default: null }, { default: "''" }),
      changeColumn("form", "slug", { default: "''" }, { default: "'untitled'" }),
    ]).toEqual([
      {
        up: 'ALTER TABLE "form" ALTER COLUMN "slug" SET DEFAULT \'\'',
        down: 'ALTER TABLE "form" ALTER COLUMN "slug" DROP DEFAULT',
      },
      {
        up: 'ALTER TABLE "form" ALTER COLUMN "slug" SET DEFAULT \'untitled\'',
        down: 'ALTER TABLE "form" ALTER COLUMN "slug" SET DEFAULT \'\'',
      },
    ])
  })

  it("rejects a property of one state, using without a change of type, and states that change nothing", () => {
    const reject = (from: object, to: object) => {
      try {
        changeColumn("form", "slug", from, to)
      } catch (error) {
        return (error as Error).message
      }
      return undefined
    }

    expect([
      reject({ type: "text", notNull: true }, { type: "integer" }),
      reject({ notNull: false, using: "slug::text" }, { notNull: true }),
      reject({ type: "text", notNull: true }, { type: "text", notNull: true }),
    ]).toEqual([
      "Cannot change column slug of table form: give notNull in both states or in neither",
      "Cannot change column slug of table form: using requires a change of type",
      "Cannot change column slug of table form: the states change nothing",
    ])
  })
})

describePostgres("column helpers in PostgreSQL", ({ database, testTransaction }) => {
  it("addColumn adds a column, and its rollback drops it", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        addColumn("form", "order", "integer NOT NULL DEFAULT 0"),
        "CREATE TABLE form (id integer)",
      ),
    )

    expect(result).toEqual({
      before: ["column form.id integer"],
      up: ["column form.id integer", "column form.order integer NOT NULL DEFAULT 0"],
      down: ["column form.id integer"],
    })
  })

  it("dropColumn drops a column, and its rollback adds it again", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        dropColumn("form", "slug", "text NOT NULL DEFAULT ''"),
        "CREATE TABLE form (id integer, slug text NOT NULL DEFAULT '')",
      ),
    )

    expect(result.up).toEqual(["column form.id integer"])
    expect(result.down).toEqual(result.before)
  })

  it("dropColumn after the steps that drop the standalone index and constraint of the column restores them on rollback", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        combineSteps(
          dropIndex("form", ["slug"], { unique: true }),
          dropConstraint("form", "form_slug_check", "CHECK (slug <> '')"),
          dropColumn("form", "slug", "text NOT NULL"),
        ),
        `
          CREATE TABLE form (id integer, slug text NOT NULL);
          CREATE UNIQUE INDEX form_slug_idx ON form (slug);
          ALTER TABLE form ADD CONSTRAINT form_slug_check CHECK (slug <> '');
        `,
      ),
    )

    expect(result.up).toEqual(["column form.id integer"])
    expect(result.down).toEqual(result.before)
  })

  it("dropColumn after changeColumn that gives the column a default restores a column with NOT NULL and without a default in a table with rows", async () => {
    const step = combineSteps(
      changeColumn("form", "slug", { default: null }, { default: "''" }),
      dropColumn("form", "slug", "text NOT NULL DEFAULT ''"),
    )

    const result = await testTransaction(() =>
      inHelperSchema(database, async () => {
        await database.script(`
          CREATE TABLE form (id integer PRIMARY KEY, slug text NOT NULL);
          INSERT INTO form (id, slug) VALUES (1, 'survey');
        `)
        const before = await describeSchema(database)
        await runChange(database, step.up)
        await runChange(database, step.down!)
        return {
          before,
          down: await describeSchema(database),
          slugs: await database.query`SELECT slug FROM form`.pluck(t.text),
        }
      }),
    )

    expect(result.down).toEqual(result.before)
    expect(result.slugs).toEqual([""])
  })

  it("renameColumn renames a column, and its rollback renames it back", async () => {
    const result = await testTransaction(() =>
      applyStep(database, renameColumn("form", "name", "title"), "CREATE TABLE form (name text)"),
    )

    expect(result).toEqual({
      before: ["column form.name text"],
      up: ["column form.title text"],
      down: ["column form.name text"],
    })
  })

  it("changeColumn converts the values with the using of each state and replaces a default that does not cast to the new type", async () => {
    const step = changeColumn(
      "form",
      "position",
      { type: "text", using: "to_char(position, 'FM9,999')", default: "''" },
      { type: "integer", using: "replace(position, ',', '')::integer", default: "0" },
    )

    const result = await testTransaction(() =>
      inHelperSchema(database, async () => {
        await database.script(`
          CREATE TABLE form (id integer PRIMARY KEY, position text DEFAULT '');
          INSERT INTO form (id, position) VALUES (1, '1,000'), (2, '25');
        `)
        const listPositions = () =>
          database.query`SELECT position::text FROM form ORDER BY id`.pluck(t.text)
        await runChange(database, step.up)
        await database.script("INSERT INTO form (id) VALUES (3)")
        const up = await listPositions()
        await runChange(database, step.down!)
        await database.script("INSERT INTO form (id) VALUES (4)")
        return { up, down: await listPositions() }
      }),
    )

    expect(result).toEqual({
      up: ["1000", "25", "0"],
      down: ["1,000", "25", "0", ""],
    })
  })

  it("changeColumn sets NOT NULL, and its rollback drops it", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        changeColumn("form", "slug", { notNull: false }, { notNull: true }),
        "CREATE TABLE form (slug text)",
      ),
    )

    expect(result).toEqual({
      before: ["column form.slug text"],
      up: ["column form.slug text NOT NULL"],
      down: ["column form.slug text"],
    })
  })
})
