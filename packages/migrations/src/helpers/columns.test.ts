import { describe, expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"
import * as t from "kern-db/types"

import { describePostgres } from "../../testing/postgres"
import { runChange } from "../migration"

import {
  addColumn,
  addColumns,
  changeColumn,
  changeColumns,
  dropColumn,
  dropColumns,
  renameColumn,
} from "./columns"
import { dropConstraint } from "./constraints"
import { dropIndex } from "./indexes"
import { combineSteps } from "./step"
import { applyStep, describeHelperSchema, inHelperSchema } from "./testing"

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

describe("addColumns", () => {
  it("adds quoted columns of definitions in one statement, and drops them", () => {
    expect(
      addColumns("form", {
        slug: "text",
        order: "integer NOT NULL DEFAULT 0",
      }),
    ).toEqual({
      up: 'ALTER TABLE "form" ADD COLUMN "slug" text, ADD COLUMN "order" integer NOT NULL DEFAULT 0',
      down: 'ALTER TABLE "form" DROP COLUMN "order", DROP COLUMN "slug"',
    })
  })

  it("ends a definition before another with a line break when it contains a line comment", () => {
    expect(
      addColumns("form", {
        width: "integer -- in pixels",
        height: "integer -- in pixels",
      }).up,
    ).toBe(
      'ALTER TABLE "form" ADD COLUMN "width" integer -- in pixels\n, ADD COLUMN "height" integer -- in pixels',
    )
  })

  it("rejects an empty record", () => {
    expect(getThrownError(() => addColumns("form", {}))).toEqual(
      new Error("Cannot alter table form: the changes are empty"),
    )
  })
})

describe("dropColumns", () => {
  it("drops columns in one statement, and adds them again as addColumns does", () => {
    expect(
      dropColumns("form", {
        slug: "text",
        order: "integer",
      }),
    ).toEqual({
      up: 'ALTER TABLE "form" DROP COLUMN "order", DROP COLUMN "slug"',
      down: 'ALTER TABLE "form" ADD COLUMN "slug" text, ADD COLUMN "order" integer',
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

  it("ends a type and its using before the SQL after them with a line break when they contain a line comment", () => {
    expect(
      changeColumn(
        "form",
        "position",
        { type: "text -- digits", using: "position::text", notNull: false },
        { type: "integer -- count", using: "position::integer -- digits", notNull: true },
      ),
    ).toEqual({
      up: 'ALTER TABLE "form" ALTER COLUMN "position" TYPE integer -- count\n USING position::integer -- digits\n, ALTER COLUMN "position" SET NOT NULL',
      down: 'ALTER TABLE "form" ALTER COLUMN "position" TYPE text -- digits\n USING position::text\n, ALTER COLUMN "position" DROP NOT NULL',
    })
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

describe("changeColumns", () => {
  it("changes columns in one statement, writing the actions of each column in turn, and changes them back", () => {
    expect(
      changeColumns("form", {
        position: [
          { type: "text", using: "position::text", default: "''" },
          { type: "integer", using: "position::integer", default: "0" },
        ],
        slug: [{ notNull: false }, { notNull: true }],
      }),
    ).toEqual({
      up: 'ALTER TABLE "form" ALTER COLUMN "position" DROP DEFAULT, ALTER COLUMN "position" TYPE integer USING position::integer, ALTER COLUMN "position" SET DEFAULT 0, ALTER COLUMN "slug" SET NOT NULL',
      down: 'ALTER TABLE "form" ALTER COLUMN "position" DROP DEFAULT, ALTER COLUMN "position" TYPE text USING position::text, ALTER COLUMN "position" SET DEFAULT \'\', ALTER COLUMN "slug" DROP NOT NULL',
    })
  })

  it("rejects an empty record and a change that changeColumn rejects", () => {
    expect([
      getThrownError(() => changeColumns("form", {})),
      getThrownError(() =>
        changeColumns("form", {
          slug: [{ notNull: false }, { notNull: true }],
          position: [{ type: "integer" }, { type: "integer" }],
        }),
      ),
    ]).toEqual([
      new Error("Cannot alter table form: the changes are empty"),
      new Error("Cannot change column position of table form: the states change nothing"),
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
      before: ["column form.id integer", "table form"],
      up: ["column form.id integer", "column form.order integer NOT NULL DEFAULT 0", "table form"],
      down: ["column form.id integer", "table form"],
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

    expect(result.up).toEqual(["column form.id integer", "table form"])
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

    expect(result.up).toEqual(["column form.id integer", "table form"])
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
        const before = await describeHelperSchema(database)
        await runChange(database, step.up)
        await runChange(database, step.down!)
        return {
          before,
          down: await describeHelperSchema(database),
          slugs: await database.query`SELECT slug FROM form`.pluck(t.text),
        }
      }),
    )

    expect(result.down).toEqual(result.before)
    expect(result.slugs).toEqual([""])
  })

  it("addColumns adds columns, and its rollback drops a generated column before the column of its expression", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        addColumns("form", {
          position: "integer NOT NULL DEFAULT 0",
          next_position: "integer GENERATED ALWAYS AS (position + 1) STORED",
        }),
        "CREATE TABLE form (id integer)",
      ),
    )

    expect(result).toEqual({
      before: ["column form.id integer", "table form"],
      up: [
        "column form.id integer",
        'column form.next_position integer GENERATED ALWAYS AS (("position" + 1)) STORED',
        "column form.position integer NOT NULL DEFAULT 0",
        "table form",
      ],
      down: ["column form.id integer", "table form"],
    })
  })

  it("addColumns adds the columns after a definition that ends with a line comment", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        addColumns("form", {
          width: "integer -- in pixels",
          height: "integer",
        }),
        "CREATE TABLE form (id integer)",
      ),
    )

    expect(result.up).toEqual([
      "column form.height integer",
      "column form.id integer",
      "column form.width integer",
      "table form",
    ])
    expect(result.down).toEqual(result.before)
  })

  it("dropColumns drops columns, and its rollback adds them again", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        dropColumns("form", {
          slug: "text",
          order: "integer NOT NULL DEFAULT 0",
        }),
        'CREATE TABLE form (id integer, slug text, "order" integer NOT NULL DEFAULT 0)',
      ),
    )

    expect(result.up).toEqual(["column form.id integer", "table form"])
    expect(result.down).toEqual(result.before)
  })

  it("renameColumn renames a column, and its rollback renames it back", async () => {
    const result = await testTransaction(() =>
      applyStep(database, renameColumn("form", "name", "title"), "CREATE TABLE form (name text)"),
    )

    expect(result).toEqual({
      before: ["column form.name text", "table form"],
      up: ["column form.title text", "table form"],
      down: ["column form.name text", "table form"],
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

  it("changeColumn makes the changes after a type and a using that end with a line comment", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        changeColumn(
          "form",
          "position",
          {
            type: "text -- digits",
            using: "position::text -- digits",
            notNull: false,
            default: null,
          },
          {
            type: "integer -- count",
            using: "position::integer -- count",
            notNull: true,
            default: "0",
          },
        ),
        "CREATE TABLE form (position text)",
      ),
    )

    expect(result).toEqual({
      before: ["column form.position text", "table form"],
      up: ["column form.position integer NOT NULL DEFAULT 0", "table form"],
      down: ["column form.position text", "table form"],
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
      before: ["column form.slug text", "table form"],
      up: ["column form.slug text NOT NULL", "table form"],
      down: ["column form.slug text", "table form"],
    })
  })

  it("changeColumns converts columns with a using that reads another column before the change, and its rollback converts them back", async () => {
    const step = changeColumns("size", {
      height: [
        { type: "text", using: "height::text", notNull: false },
        { type: "integer", using: "height::integer", notNull: true },
      ],
      width: [
        { type: "text", using: "(width - length(height::text))::text", default: "''" },
        { type: "integer", using: "length(height) + width::integer", default: "0" },
      ],
    })

    const result = await testTransaction(() =>
      inHelperSchema(database, async () => {
        await database.script(`
          CREATE TABLE size (id integer PRIMARY KEY, width text DEFAULT '', height text);
          INSERT INTO size (id, width, height) VALUES (1, '10', '20');
        `)
        const listSizes = () =>
          database.query`SELECT width::text || 'x' || height::text FROM size ORDER BY id`.pluck(
            t.text,
          )
        await runChange(database, step.up)
        await database.script("INSERT INTO size (id, height) VALUES (2, 5)")
        const up = await listSizes()
        await runChange(database, step.down!)
        return { up, down: await listSizes() }
      }),
    )

    expect(result).toEqual({
      up: ["12x20", "0x5"],
      down: ["10x20", "-1x5"],
    })
  })
})
