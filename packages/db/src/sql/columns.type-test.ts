import { describe, expectTypeOf, test } from "bun:test"

import { jsonb } from "../type/builtins/json"
import { integer } from "../type/builtins/numeric"
import { text } from "../type/builtins/text"

import type { SqlColumn, SqlColumns, SqlColumnsOptions } from "./columns"
import { createSqlColumns } from "./columns"

const id = { key: "id", name: "id", type: integer } as const
const runAt = { key: "runAt", name: "run_at", type: text } as const
const note = { key: "note", name: "note", type: text.nullable() } as const

/** Record of the columns that `createSqlColumns` creates from columns `C`. */
type RecordOf<C extends readonly SqlColumn[]> =
  ReturnType<typeof createSqlColumns<C>> extends SqlColumns<infer R, boolean> ? R : never

describe("createSqlColumns", () => {
  test("types the record by the keys and the types of its columns", () => {
    expectTypeOf(createSqlColumns([id, runAt, note])).toEqualTypeOf<
      SqlColumns<{ id: number; runAt: string; note: string | null }, false>
    >()
    expectTypeOf(
      createSqlColumns([{ key: "payload", name: "payload", type: jsonb }], { alias: "j" }),
    ).toEqualTypeOf<SqlColumns<{ payload: unknown }, false>>()
  })

  test("types columns that the types do not tell apart as a record of any keys", () => {
    const columns: SqlColumn[] = [id, runAt]

    // oxlint-disable-next-line typescript/no-explicit-any -- the values of columns of any type
    expectTypeOf<RecordOf<typeof columns>>().toEqualTypeOf<{ [key: string]: any }>()
  })

  test("types a column that the list does not guarantee as optional, as select of kern-orm by keys does", () => {
    const some = Math.random() < 0.5 ? id : runAt
    const key = Math.random() < 0.5 ? "id" : "runAt"
    const rest: (typeof runAt)[] = []
    const either = Math.random() < 0.5 ? ([id] as const) : ([runAt] as const)

    expectTypeOf<RecordOf<[typeof some]>>().toEqualTypeOf<{ id?: number; runAt?: string }>()
    expectTypeOf<
      RecordOf<[{ key: typeof key; name: string; type: typeof integer }]>
    >().toEqualTypeOf<{
      id?: number
      runAt?: number
    }>()
    expectTypeOf<RecordOf<[typeof id, ...typeof rest]>>().toEqualTypeOf<{
      id: number
      runAt?: string
    }>()
    expectTypeOf<RecordOf<[...typeof rest, typeof id]>>().toEqualTypeOf<{
      id: number
      runAt?: string
    }>()
    expectTypeOf<RecordOf<typeof either>>().toEqualTypeOf<{ id: number } | { runAt: string }>()
  })

  test("types each list of a union of lists by the values of its own columns", () => {
    const textId = { key: "id", name: "id", type: text } as const

    expectTypeOf<
      RecordOf<readonly [typeof id, typeof runAt] | readonly [typeof textId]>
    >().toEqualTypeOf<{ id: number; runAt: string } | { id: string }>()
  })

  test("keeps the keys of other columns beside a column of an unknown key", () => {
    const other: SqlColumn = note
    // oxlint-disable-next-line typescript/no-explicit-any -- the values of a column of any type
    type Expected = { [key: string]: any; id: number }

    expectTypeOf<RecordOf<[typeof id, typeof other]>>().toEqualTypeOf<Expected>()
  })

  test("reads under a key of an index signature the values of every column", () => {
    const ids: (typeof id)[] = []

    expectTypeOf<RecordOf<[SqlColumn<string, typeof text>, ...typeof ids]>>().toEqualTypeOf<{
      [key: string]: string | number | undefined
    }>()
  })

  test("reads under a key that the list does not guarantee the values of every column that it may name", () => {
    expectTypeOf<
      RecordOf<
        [
          SqlColumn<"outside" | `key${number}`, typeof integer>,
          SqlColumn<"key1" | "x", typeof text>,
        ]
      >
    >().toEqualTypeOf<{
      [key: `key${number}`]: string | number | undefined
      outside?: number
      x?: string
    }>()
  })

  test("reads under a key the values of the columns that name it, not those of every column beside a key of an index signature", () => {
    expectTypeOf<
      RecordOf<[typeof id, SqlColumn<"id" | `key${number}`, typeof text>, SqlColumn<"meta">]>
    >().toEqualTypeOf<{
      // oxlint-disable-next-line typescript/no-explicit-any -- the values of a column of any type
      [key: `key${number}`]: any
      id: number | string
      // oxlint-disable-next-line typescript/no-explicit-any -- the values of a column of any type
      meta: any
    }>()
  })

  test("rejects a key of another column", () => {
    // @ts-expect-error The columns have no such column.
    createSqlColumns([id], { key: ["runAt"] })
  })

  test("tells whether the columns have their key from the options, as boolean when their type does not tell", () => {
    const withKey: SqlColumnsOptions<"id"> = { key: ["id"] }
    const maybe = Math.random() < 0.5 ? ({ key: ["id"] } as const) : undefined

    expectTypeOf(createSqlColumns([id], { key: ["id"] })).toEqualTypeOf<
      SqlColumns<{ id: number }, true>
    >()
    expectTypeOf(createSqlColumns([id], { alias: "j" })).toEqualTypeOf<
      SqlColumns<{ id: number }, false>
    >()
    expectTypeOf(createSqlColumns([id], withKey)).toEqualTypeOf<
      SqlColumns<{ id: number }, boolean>
    >()
    expectTypeOf(createSqlColumns([id], maybe)).toEqualTypeOf<SqlColumns<{ id: number }, boolean>>()
  })
})

describe("nullable", () => {
  test("requires the columns in by unless the columns have their key, and rejects a column that can be NULL", () => {
    const withKey = createSqlColumns([id, runAt, note], { key: ["id"] })
    const withoutKey = createSqlColumns([id, runAt, note])

    expectTypeOf(withKey.nullable()).toEqualTypeOf<
      SqlColumns<{ id: number; runAt: string; note: string | null } | null, true>
    >()
    expectTypeOf(withoutKey.nullable({ by: ["runAt"] })).toEqualTypeOf<
      SqlColumns<{ id: number; runAt: string; note: string | null } | null, false>
    >()
    // @ts-expect-error Columns without their key take the columns in `by`.
    withoutKey.nullable()
    // @ts-expect-error A column that can be `NULL` does not tell a missing row.
    withKey.nullable({ by: ["note"] })
  })

  test("rejects in by a column that the list does not guarantee", () => {
    const rest: (typeof runAt)[] = []
    const columns = createSqlColumns([id, ...rest])

    columns.nullable({ by: ["id"] })
    // @ts-expect-error A column that the fragment may not select does not tell a missing row.
    columns.nullable({ by: ["runAt"] })
  })

  test("takes in by a column only when every list of a union of lists guarantees it", () => {
    const some = Math.random() < 0.5 ? id : runAt
    const both = Math.random() < 0.5 ? ([id, note] as const) : ([runAt, id] as const)
    const either = Math.random() < 0.5 ? ([id, note] as const) : ([some] as const)

    createSqlColumns(both).nullable({ by: ["id"] })
    // @ts-expect-error A column that one of the lists may leave out does not tell a missing row.
    createSqlColumns(either).nullable({ by: ["id"] })
  })

  test("takes in by a column named as a member of Object.prototype whose values are unknown", () => {
    createSqlColumns([{ key: "toString", name: "to_string", type: jsonb }]).nullable({
      by: ["toString"],
    })
  })
})
