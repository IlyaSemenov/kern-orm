import { describe, expectTypeOf, test } from "bun:test"

import * as t from "../types"

import type { Column } from "./column"
import { toSnakeCase } from "./snake-case"
import type {
  AnyTableKeys,
  ColumnDefinitions,
  ContainsKey,
  IsKey,
  Table,
  TableKeys,
  TableOptions,
} from "./table"
import { createTableFactory, defineTable } from "./table"

declare const flag: boolean

describe("defineTable", () => {
  test("types the keys marked on the columns and those of the options", () => {
    const field = defineTable(
      "form_field",
      {
        id: t.uuid.primaryKey(),
        formId: t.uuid,
        position: t.integer,
        code: t.text.columnName("field_code").unique(),
      },
      { unique: [["formId", "position"]] },
    )
    const membership = defineTable(
      "membership",
      {
        userId: t.uuid,
        groupId: t.uuid,
      },
      { primaryKey: ["groupId", "userId"] },
    )
    const log = defineTable("log", {
      message: t.text,
    })

    expectTypeOf(field.keys).toEqualTypeOf<
      TableKeys<readonly ["id"], readonly ["code"] | readonly ["formId", "position"]>
    >()
    expectTypeOf(membership.keys).toEqualTypeOf<TableKeys<readonly ["groupId", "userId"], never>>()
    expectTypeOf(log.keys).toEqualTypeOf<TableKeys<undefined, never>>()
  })

  test("rejects keys of the options that a table cannot have", () => {
    defineTable(
      "user",
      {
        email: t.text,
        name: t.text,
      },
      // @ts-expect-error A key of one column is marked on the column.
      { unique: [["email"]] },
    )
    defineTable(
      "membership",
      {
        userId: t.uuid,
      },
      // @ts-expect-error The table has no column "groupId".
      { primaryKey: ["userId", "groupId"] },
    )
    defineTable(
      "membership",
      {
        userId: t.uuid,
        groupId: t.uuid.nullable(),
      },
      // @ts-expect-error A primary key column is not nullable.
      { primaryKey: ["userId", "groupId"] },
    )
    defineTable(
      "membership",
      {
        userId: t.uuid,
        groupId: t.text.transform({
          decode: value => value,
          encode: (value: string | null) => value ?? "",
        }),
      },
      // @ts-expect-error A primary key column is not nullable, as a type whose `encode` takes null is.
      { primaryKey: ["userId", "groupId"] },
    )
    defineTable(
      "membership",
      {
        userId: t.uuid.primaryKey(),
        groupId: t.uuid,
      },
      // @ts-expect-error A column is marked with primaryKey().
      { primaryKey: ["userId", "groupId"] },
    )
  })

  test("takes a primary key of columns that are not nullable, whose values may include null", () => {
    const event = defineTable(
      "event",
      {
        source: t.text,
        payload: t.jsonb,
      },
      { primaryKey: ["source", "payload"] },
    )
    expectTypeOf(event.keys).toEqualTypeOf<TableKeys<readonly ["source", "payload"], never>>()
  })

  test("gives the union of the keys of a union of options, which may be undefined", () => {
    const either = defineTable(
      "either",
      {
        a: t.uuid,
        b: t.uuid,
      },
      flag ? { primaryKey: ["a", "b"] } : { unique: [["a", "b"]] },
    )
    const optional = defineTable(
      "optional",
      {
        a: t.uuid.primaryKey(),
        b: t.uuid,
      },
      flag ? { unique: [["a", "b"]] } : undefined,
    )

    expectTypeOf(either.keys).toEqualTypeOf<
      TableKeys<readonly ["a", "b"], never> | TableKeys<undefined, readonly ["a", "b"]>
    >()
    expectTypeOf(optional.keys).toEqualTypeOf<
      TableKeys<readonly ["a"], never> | TableKeys<readonly ["a"], readonly ["a", "b"]>
    >()
  })

  test("gives AnyTableKeys where the types of the columns or of the options do not tell the keys", () => {
    const id: Column<typeof t.uuid> = t.uuid.primaryKey()
    const widened = defineTable("widened", {
      id,
    })
    const picked = defineTable("picked", {
      id: flag ? t.uuid.primaryKey() : t.uuid,
    })
    const doubled = defineTable("doubled", {
      a: t.uuid.primaryKey(),
      b: t.uuid.primaryKey(),
    })
    const options: TableOptions<"a" | "b"> = { primaryKey: ["a", "b"] }
    const optioned = defineTable(
      "optioned",
      {
        a: t.uuid,
        b: t.uuid,
      },
      options,
    )
    const columns = {
      a: t.uuid,
      b: t.uuid,
      c: t.uuid,
    }
    const choices = [
      defineTable("choice", columns, { primaryKey: flag ? ["a", "b"] : ["a", "c"] }),
      defineTable("choice", columns, { unique: flag ? [["a", "b"]] : [] }),
      defineTable("choice", columns, { unique: [flag ? ["a", "b"] : ["a", "c"]] }),
    ] as const
    const define = <D extends ColumnDefinitions>(definitions: D) =>
      defineTable("generic", definitions)

    expectTypeOf(widened.keys).toEqualTypeOf<AnyTableKeys>()
    expectTypeOf(picked.keys).toEqualTypeOf<AnyTableKeys>()
    expectTypeOf(doubled.keys).toEqualTypeOf<AnyTableKeys>()
    expectTypeOf(optioned.keys).toEqualTypeOf<AnyTableKeys>()
    expectTypeOf(choices[0].keys).toEqualTypeOf<AnyTableKeys>()
    expectTypeOf(choices[1].keys).toEqualTypeOf<AnyTableKeys>()
    expectTypeOf(choices[2].keys).toEqualTypeOf<AnyTableKeys>()
    expectTypeOf<ReturnType<typeof define>["keys"]>().toEqualTypeOf<AnyTableKeys>()
  })

  test("types whether the table holds at most one row, or boolean where the options do not tell it", () => {
    const columns = {
      token: t.text,
    }
    const options: TableOptions<"token"> = { singleton: true }

    expectTypeOf(
      defineTable("license", columns, { singleton: true }).singleton,
    ).toEqualTypeOf<true>()
    expectTypeOf(
      defineTable("license", columns, { singleton: false }).singleton,
    ).toEqualTypeOf<false>()
    expectTypeOf(defineTable("license", columns, {}).singleton).toEqualTypeOf<false>()
    expectTypeOf(defineTable("license", columns).singleton).toEqualTypeOf<false>()
    expectTypeOf(
      defineTable("license", columns, flag ? { singleton: true } : undefined).singleton,
    ).toEqualTypeOf<boolean>()
    expectTypeOf(defineTable("license", columns, options).singleton).toEqualTypeOf<boolean>()
    expectTypeOf<Table<"license">["singleton"]>().toEqualTypeOf<boolean>()
  })
})

describe("createTableFactory", () => {
  test("creates a function of the type of defineTable", () => {
    expectTypeOf(createTableFactory({ columnName: toSnakeCase })).toEqualTypeOf<
      typeof defineTable
    >()
  })

  test("types the keys of a table as defineTable does", () => {
    const defineSnakeCaseTable = createTableFactory({ columnName: toSnakeCase })
    const field = defineSnakeCaseTable(
      "form_field",
      {
        id: t.uuid.primaryKey(),
        formId: t.uuid,
        position: t.integer,
      },
      { unique: [["formId", "position"]] },
    )

    expectTypeOf(field.keys).toEqualTypeOf<
      TableKeys<readonly ["id"], readonly ["formId", "position"]>
    >()
  })

  test("requires a function from a key to a name", () => {
    // @ts-expect-error A factory without the function would change nothing.
    createTableFactory({})
    // @ts-expect-error The function returns a name.
    createTableFactory({ columnName: () => 1 })
    createTableFactory({ columnName: key => key.toUpperCase() })
  })
})

describe("IsKey and ContainsKey", () => {
  const membership = defineTable(
    "membership",
    {
      userId: t.uuid,
      groupId: t.uuid.columnName("group_id"),
      code: t.text.unique(),
      role: t.text,
    },
    { primaryKey: ["userId", "groupId"] },
  )
  type Membership = typeof membership

  test("tell whether the columns are exactly a key, or include one, primary or unique, in any order", () => {
    expectTypeOf<IsKey<Membership, "groupId" | "userId">>().toEqualTypeOf<true>()
    expectTypeOf<IsKey<Membership, "code">>().toEqualTypeOf<true>()
    expectTypeOf<IsKey<Membership, "userId">>().toEqualTypeOf<false>()
    expectTypeOf<IsKey<Membership, "userId" | "groupId" | "role">>().toEqualTypeOf<false>()

    expectTypeOf<ContainsKey<Membership, "userId" | "groupId" | "role">>().toEqualTypeOf<true>()
    expectTypeOf<ContainsKey<Membership, "code" | "role">>().toEqualTypeOf<true>()
    expectTypeOf<ContainsKey<Membership, "userId" | "role">>().toEqualTypeOf<false>()
  })

  test("find no key of a table without keys", () => {
    const log = defineTable("log", {
      id: t.uuid,
    })

    expectTypeOf<IsKey<typeof log, "id">>().toEqualTypeOf<false>()
    expectTypeOf<ContainsKey<typeof log, "id">>().toEqualTypeOf<false>()
  })

  test("are boolean for a table whose type does not tell its keys", () => {
    type Widened = Table<"membership", Membership["columns"]>
    type Erased = Table<
      "membership",
      Membership["columns"],
      Pick<Membership["keys"], "primaryKey" | "unique">
    >

    expectTypeOf<IsKey<Widened, "userId" | "groupId">>().toEqualTypeOf<boolean>()
    expectTypeOf<ContainsKey<Widened, "userId" | "groupId">>().toEqualTypeOf<boolean>()
    expectTypeOf<IsKey<Erased, "userId" | "groupId">>().toEqualTypeOf<boolean>()
  })

  test("give the union of the results of a union of tables or of their keys", () => {
    const user = defineTable("user", {
      id: t.uuid.primaryKey(),
    })
    const account = defineTable("account", {
      id: t.uuid.unique(),
    })
    const log = defineTable("log", {
      id: t.uuid,
    })
    type Either = Table<"either", typeof user.columns, typeof user.keys | typeof log.keys>

    expectTypeOf<IsKey<typeof user | typeof log, "id">>().toEqualTypeOf<boolean>()
    expectTypeOf<IsKey<Either, "id">>().toEqualTypeOf<boolean>()
    expectTypeOf<ContainsKey<typeof user | typeof account, "id">>().toEqualTypeOf<true>()
  })

  test("cannot be given other keys by typing a table as a table of other keys", () => {
    const user = defineTable("user", {
      id: t.uuid.primaryKey(),
      tenantId: t.uuid,
    })
    const member = defineTable("user", {
      id: t.uuid.primaryKey(),
      tenantId: t.uuid.unique(),
    })
    type Columns = typeof user.columns

    // @ts-expect-error Without the unique key.
    const reduced: Table<"user", typeof member.columns, TableKeys<readonly ["id"], never>> = member
    // @ts-expect-error Another unique key.
    const claimed: Table<
      "user",
      Columns,
      TableKeys<readonly ["id"], readonly ["id", "tenantId"]>
    > = user
    // @ts-expect-error Another primary key.
    const alternative: Table<
      "user",
      Columns,
      TableKeys<readonly ["id"] | readonly ["tenantId"], never>
    > = user
    const erased: Table<"user", Columns, Pick<typeof user.keys, "primaryKey" | "unique">> = user
    // @ts-expect-error The keys were erased by `Pick`, so their type tells none.
    const restored: Table<
      "user",
      Columns,
      TableKeys<readonly ["id"], readonly ["id", "tenantId"]>
    > = erased
    const widened: Table<"user", Columns> = user
    void [reduced, claimed, alternative, restored, widened]
  })
})
