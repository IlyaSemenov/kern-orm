import { describe, expect, it } from "bun:test"

import { integer } from "../type/builtins/numeric"
import { text } from "../type/builtins/text"

import { createSqlColumns, SqlColumns } from "./columns"
import { compileFragment, compileScript, sql, SqlFragment } from "./fragment"

const columns = [
  { key: "id", name: "id", type: integer },
  { key: "runAt", name: "run_at", type: text },
  { key: "note", name: "note", type: text.nullable() },
] as const

describe("createSqlColumns", () => {
  it("selects each column under its key as the name of its result column", () => {
    expect(createSqlColumns(columns).text).toBe(
      '"id" AS "id", "run_at" AS "runAt", "note" AS "note"',
    )
  })

  it("qualifies the columns with the alias and names the result columns with the prefix, which is the alias by default", () => {
    const job = createSqlColumns(columns, { alias: "j", prefix: "job" })

    expect(createSqlColumns(columns, { alias: "j" }).text).toBe(
      '"j"."id" AS "j__id", "j"."run_at" AS "j__runAt", "j"."note" AS "j__note"',
    )
    expect(createSqlColumns(columns, { prefix: "job" }).text).toBe(
      '"id" AS "job__id", "run_at" AS "job__runAt", "note" AS "job__note"',
    )
    expect(job.text).toBe(
      '"j"."id" AS "job__id", "j"."run_at" AS "job__runAt", "j"."note" AS "job__note"',
    )
    expect(job.fields).toEqual([
      { key: "id", column: "job__id", type: integer },
      { key: "runAt", column: "job__runAt", type: text },
      { key: "note", column: "job__note", type: columns[2].type },
    ])
  })

  it("quotes the names, the alias, and the prefix", () => {
    expect(
      createSqlColumns([{ key: 'a"b', name: 'c"d', type: text }], { alias: 'e"f', prefix: 'g"h' })
        .text,
    ).toBe('"e""f"."c""d" AS "g""h__a""b"')
  })

  it("is a fragment without parameters, frozen with its text and its fields, which a template and a script interpolate", () => {
    const job = createSqlColumns([columns[0]], { alias: "j", key: ["id"] })

    expect(job).toBeInstanceOf(SqlFragment)
    for (const value of [job, job.nullable()]) {
      expect(Object.isFrozen(value)).toBe(true)
      expect(Object.isFrozen(value.strings)).toBe(true)
      expect(Object.isFrozen(value.values)).toBe(true)
      expect(Object.isFrozen(value.fields)).toBe(true)
      expect(Object.isFrozen(value.fields[0])).toBe(true)
    }
    expect(compileFragment(sql`SELECT ${job} FROM job j WHERE id = ${1}`)).toEqual({
      text: 'SELECT "j"."id" AS "j__id" FROM job j WHERE id = $1',
      parameters: ["1"],
    })
    expect(compileScript(sql`SELECT ${job} FROM job j`)).toBe(
      'SELECT "j"."id" AS "j__id" FROM job j',
    )
  })

  it("rejects no columns, a column twice, a key that a record cannot have, and a value that is not a type", () => {
    expect(() => createSqlColumns([])).toThrow(
      "Columns of a record must include at least one column",
    )
    expect(() => createSqlColumns([columns[0], columns[0]])).toThrow(
      'Columns of a record include column "id" twice',
    )
    expect(() => createSqlColumns([{ key: "__proto__", name: "proto", type: text }])).toThrow(
      'Column "__proto__" cannot be a key of a record',
    )
    expect(() => createSqlColumns([{ key: "", name: "empty", type: text }])).toThrow(
      'Column "" cannot be a key of a record',
    )
    expect(() => createSqlColumns([{ key: "id", name: "", type: text }])).toThrow(
      'Column "id" must have a name as a non-empty string',
    )
    expect(() => createSqlColumns([{ key: "id", name: "id", type: "text" as never }])).toThrow(
      'Column "id" must have a type',
    )
  })

  it("rejects an empty alias or prefix, and a name of a result column that PostgreSQL may truncate in a server encoding, where a character other than ASCII takes up to 4 bytes", () => {
    expect(() => createSqlColumns(columns, { alias: "" })).toThrow(
      "The alias of columns must be a non-empty string",
    )
    expect(() => createSqlColumns(columns, { prefix: "" })).toThrow(
      "The prefix of columns must be a non-empty string",
    )
    expect(createSqlColumns(columns, { prefix: "p".repeat(56) }).fields[1]!.column).toHaveLength(63)
    expect(() => createSqlColumns(columns, { prefix: "p".repeat(57) })).toThrow(
      `Result column "${"p".repeat(57)}__runAt" has a name that may be longer than 63 bytes in a server encoding, where a character other than ASCII takes up to 4, and PostgreSQL truncates a longer name; set a shorter prefix or give the column a shorter key`,
    )
    expect(createSqlColumns(columns, { prefix: "é".repeat(14) }).fields[1]!.column).toBe(
      `${"é".repeat(14)}__runAt`,
    )
    expect(() => createSqlColumns(columns, { prefix: "é".repeat(15) })).toThrow(
      `Result column "${"é".repeat(15)}__id" has a name that may be longer than 63 bytes`,
    )
  })

  it("suggests a shorter column key when no prefix is set", () => {
    expect(() => createSqlColumns([{ key: "x".repeat(64), name: "id", type: integer }])).toThrow(
      "and PostgreSQL truncates a longer name; give the column a shorter key",
    )
  })

  it("rejects a name of a result column with a lone surrogate, which a driver replaces in the statement", () => {
    const message =
      'The result name for column "id" contains a lone surrogate, which a driver replaces when it encodes the statement'

    expect(() => createSqlColumns([columns[0]], { prefix: "job\uD83D" })).toThrow(message)
    expect(() =>
      createSqlColumns([{ key: "id", name: "id", type: integer }], { alias: "\uDE00" }),
    ).toThrow(message)
    expect(createSqlColumns([columns[0]], { prefix: "😀" }).fields[0]!.column).toBe("😀__id")
  })

  it("rejects a key of a column that the columns do not include or that is nullable", () => {
    // @ts-expect-error Types reject a key of another column.
    expect(() => createSqlColumns(columns, { key: ["jobId"] })).toThrow(
      'Columns of a record do not include column "jobId" of their key',
    )
    expect(() => createSqlColumns(columns, { key: ["note"] })).toThrow(
      'Column "note" is nullable, so its NULL does not tell a missing row of the record',
    )
    expect(() => createSqlColumns(columns, { key: [] })).toThrow(
      "The key of columns must have at least one column",
    )
  })
})

describe("nullable", () => {
  it("tells a missing row by the key of the columns, or by the columns of by, keeping the columns as they are", () => {
    const job = createSqlColumns(columns, { key: ["id"] })
    const byKey = job.nullable()
    const byRunAt = job.nullable({ by: ["runAt", "id"] })

    expect(job.presence).toBeUndefined()
    expect(byKey).toBeInstanceOf(SqlColumns)
    expect(byKey.presence).toEqual([0])
    expect(byRunAt.presence).toEqual([1, 0])
    expect(byRunAt.nullable().presence).toEqual([0])
    expect(byKey.text).toBe(job.text)
    expect(byKey.fields).toBe(job.fields)
    expect(Object.isFrozen(byRunAt)).toBe(true)
    expect(Object.isFrozen(byRunAt.presence)).toBe(true)
  })

  it("rejects columns without their key unless by gives the columns", () => {
    const job = createSqlColumns(columns)

    // @ts-expect-error Types require the columns in `by`.
    expect(() => job.nullable()).toThrow(
      "nullable() tells a missing row by the key of the record, which these columns do not include; pass the columns that are never NULL in a row in `by`",
    )
    expect(job.nullable({ by: ["id"] }).presence).toEqual([0])
  })

  it("rejects in by no columns, another column, a column twice, and a nullable column", () => {
    const job = createSqlColumns(columns, { key: ["id"] })

    // @ts-expect-error Types reject no columns.
    expect(() => job.nullable({ by: [] })).toThrow(
      "nullable() takes a non-empty array of the keys of columns in `by`",
    )
    // @ts-expect-error Types reject a key that is not in an array.
    expect(() => job.nullable({ by: "id" })).toThrow(
      "nullable() takes a non-empty array of the keys of columns in `by`",
    )
    // @ts-expect-error Types reject a key of another column.
    expect(() => job.nullable({ by: ["task"] })).toThrow(
      'nullable() takes in `by` a column of the record, not "task"',
    )
    expect(() => job.nullable({ by: ["id", "id"] })).toThrow(
      'nullable() takes column "id" in `by` twice',
    )
    // @ts-expect-error Types reject a column that can be `NULL`.
    expect(() => job.nullable({ by: ["note"] })).toThrow(
      'Column "note" is nullable, so its NULL does not tell a missing row of the record',
    )
  })
})
