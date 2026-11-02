import { describe, expect, it } from "bun:test"

import { describePostgres } from "../../testing/postgres"

import { createIndex, dropIndex } from "./indexes"
import { applyStep } from "./testing"

describe("createIndex", () => {
  it("creates an index of the name that PostgreSQL gives it, and drops it", () => {
    expect(createIndex("form_field", ["form_id", "position"])).toEqual({
      up: 'CREATE INDEX "form_field_form_id_position_idx" ON "form_field" (form_id, position)',
      down: 'DROP INDEX "form_field_form_id_position_idx"',
    })
  })

  it("creates an index with every option in the order of CREATE INDEX", () => {
    expect(
      createIndex("form_field", ["form_id", "position"], {
        unique: true,
        nullsNotDistinct: true,
        using: "btree",
        include: ["label"],
        where: "deleted_at IS NULL",
      }).up,
    ).toBe(
      'CREATE UNIQUE INDEX "form_field_form_id_position_label_idx" ON "form_field" USING btree (form_id, position) INCLUDE (label) NULLS NOT DISTINCT WHERE deleted_at IS NULL',
    )
  })

  it("names an index by its columns without their orderings, as PostgreSQL does", () => {
    expect(createIndex("form", ["created_at desc nulls last", "id DESC"]).up).toBe(
      'CREATE INDEX "form_created_at_id_idx" ON "form" (created_at desc nulls last, id DESC)',
    )
  })

  it("creates an index of expressions with its name", () => {
    expect(createIndex("form", ["lower(name)"], { name: "form_name_idx" })).toEqual({
      up: 'CREATE INDEX "form_name_idx" ON "form" (lower(name))',
      down: 'DROP INDEX "form_name_idx"',
    })
  })

  it("requires a name for an element other than a column with an ordering, a quoted or repeated column, and a name longer than PostgreSQL keeps", () => {
    const reject = (columns: string[], include?: string[]) => {
      try {
        createIndex("form", columns, { include })
      } catch (error) {
        return (error as Error).message
      }
      return undefined
    }

    expect([
      reject(["(true)"]),
      reject(['id COLLATE "C"']),
      reject(["id\u00a0DESC"]),
      reject(["id de\u017fc"]),
      reject(['"Name"']),
      reject(["id"], ["label DESC"]),
      reject(["id", "id DESC"]),
      reject(["c".repeat(56)]),
    ]).toEqual([
      "Cannot name the index of table form on (true): (true) is not a lowercase column name with an optional ordering, so pass name",
      'Cannot name the index of table form on id COLLATE "C": id COLLATE "C" is not a lowercase column name with an optional ordering, so pass name',
      "Cannot name the index of table form on id\u00a0DESC: id\u00a0DESC is not a lowercase column name with an optional ordering, so pass name",
      "Cannot name the index of table form on id de\u017fc: id de\u017fc is not a lowercase column name with an optional ordering, so pass name",
      'Cannot name the index of table form on "Name": "Name" is not a lowercase column name with an optional ordering, so pass name',
      "Cannot name the index of table form on id, label DESC: label DESC is not a lowercase column name, so pass name",
      "Cannot name the index of table form on id, id DESC: column id repeats, so pass name",
      `Cannot name the index of table form on ${"c".repeat(56)}: form_${"c".repeat(56)}_idx is longer than 63 bytes, so pass a shorter name`,
    ])
  })

  it("rejects an index without columns", () => {
    expect(() => createIndex("form", [])).toThrow(
      "Cannot create an index of table form without columns",
    )
  })
})

describe("dropIndex", () => {
  it("drops an index of the name that createIndex gives it, and creates it again", () => {
    expect(dropIndex("form_field", ["form_id"], { where: "deleted_at IS NULL" })).toEqual({
      up: 'DROP INDEX "form_field_form_id_idx"',
      down: 'CREATE INDEX "form_field_form_id_idx" ON "form_field" (form_id) WHERE deleted_at IS NULL',
    })
  })
})

describePostgres("index helpers in PostgreSQL", ({ database, testTransaction }) => {
  const createFormField =
    "CREATE TABLE form_field (form_id integer, position integer, label text, deleted_at timestamptz)"

  it("createIndex creates an index of the name that PostgreSQL gives an index without a name, and its rollback drops it", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        createIndex("form_field", ["form_id", "position DESC"], {
          unique: true,
          include: ["label"],
          where: "deleted_at IS NULL",
        }),
        createFormField,
      ),
    )
    const named = await testTransaction(() =>
      applyStep(
        database,
        {
          up: "CREATE UNIQUE INDEX ON form_field (form_id, position DESC) INCLUDE (label) WHERE deleted_at IS NULL",
        },
        createFormField,
      ),
    )

    expect(result.up).toEqual(named.up)
    expect(result.up).toContain(
      'index CREATE UNIQUE INDEX form_field_form_id_position_label_idx ON migrations_helpers.form_field USING btree (form_id, "position" DESC) INCLUDE (label) WHERE (deleted_at IS NULL)',
    )
    expect(result.down).toEqual(result.before)
  })

  it("dropIndex drops an index, and its rollback creates it again", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        dropIndex("form_field", ["form_id"], { using: "hash" }),
        `${createFormField}; CREATE INDEX ON form_field USING hash (form_id)`,
      ),
    )

    expect(result.up).toEqual(result.before.filter(line => !line.startsWith("index ")))
    expect(result.down).toEqual(result.before)
  })
})
