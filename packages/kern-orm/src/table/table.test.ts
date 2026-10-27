import { describe, expect, it } from "bun:test"

import * as t from "../types"

import type { Column } from "./column"
import type { TableOptions } from "./table"
import { containsKey, defineTable, findColumn, isKey } from "./table"

describe("defineTable", () => {
  it("rejects column keys reserved for column reference members", () => {
    expect(() =>
      defineTable("form", {
        $name: t.text,
      }),
    ).toThrow('Column key "$name" of table "form" must not start with "$"')
  })

  it("rejects the __proto__ column key", () => {
    expect(() =>
      defineTable("form", {
        ["__proto__"]: t.text,
      }),
    ).toThrow('Column key "__proto__" of table "form" is not allowed')
  })

  it("rejects a nullable primary key column", () => {
    expect(() =>
      defineTable("form", {
        // @ts-expect-error A primary key column is not nullable.
        id: t.uuid.nullable().primaryKey(),
      }),
    ).toThrow('Primary key column "id" of table "form" must not be nullable')
  })

  it("rejects a column definition that is neither a type nor a column", () => {
    expect(() =>
      defineTable("form", {
        // @ts-expect-error A column definition is a type or a column.
        id: "uuid",
      }),
    ).toThrow('Column "id" of table "form" must be a type or a column')
  })

  it("freezes column attributes, so that tables sharing a column cannot change it", () => {
    const id = t.uuid.primaryKey()
    const form = defineTable("form", {
      id,
    })
    expect(Object.isFrozen(form.columns.id.attributes)).toBe(true)
  })

  describe("keys", () => {
    it("defines the keys marked on the columns, followed by the unique keys of the options", () => {
      const field = defineTable(
        "form_field",
        {
          id: t.uuid.primaryKey(),
          formId: t.uuid,
          position: t.integer,
          code: t.text.unique(),
        },
        { unique: [["formId", "position"]] },
      )

      expect(field.keys.primaryKey).toEqual(["id"])
      expect(field.keys.unique).toEqual([["code"], ["formId", "position"]])
    })

    it("takes a primary key of several columns from the options, in its order", () => {
      const membership = defineTable(
        "membership",
        {
          userId: t.uuid,
          groupId: t.uuid,
        },
        { primaryKey: ["groupId", "userId"] },
      )

      expect(membership.keys.primaryKey).toEqual(["groupId", "userId"])
      expect(membership.keys.unique).toEqual([])
    })

    it("has no keys for a table that declares none, also with undefined options", () => {
      const log = defineTable("log", {
        message: t.text,
      })
      const audit = defineTable(
        "audit",
        {
          message: t.text,
        },
        undefined,
      )

      expect(log.keys.primaryKey).toBeUndefined()
      expect(log.keys.unique).toEqual([])
      expect(audit.keys.unique).toEqual([])
    })

    it("keeps the keys of its options frozen when the arrays change", () => {
      const primaryKey: ["userId", "groupId"] = ["userId", "groupId"]
      const membership = defineTable(
        "membership",
        {
          userId: t.uuid,
          groupId: t.uuid,
        },
        { primaryKey },
      )
      const listed: string[] = primaryKey
      listed[0] = "groupId"

      expect(membership.keys.primaryKey).toEqual(["userId", "groupId"])
      expect(Object.isFrozen(membership.keys)).toBe(true)
      expect(Object.isFrozen(membership.keys.primaryKey)).toBe(true)
      expect(Object.isFrozen(membership.keys.unique)).toBe(true)
    })

    it("rejects several columns marked with primaryKey()", () => {
      expect(() =>
        defineTable("membership", {
          userId: t.uuid.primaryKey(),
          groupId: t.uuid.primaryKey(),
        }),
      ).toThrow(
        'Table "membership" marks columns "userId" and "groupId" with primaryKey(); list the columns of a primary key of several columns in the options',
      )
    })

    it("rejects a primary key both on a column and in the options", () => {
      expect(() =>
        defineTable(
          "membership",
          {
            userId: t.uuid.primaryKey(),
            groupId: t.uuid,
          },
          // @ts-expect-error A column is marked with primaryKey().
          { primaryKey: ["userId", "groupId"] },
        ),
      ).toThrow(
        'Table "membership" declares its primary key both on column "userId" and in the options',
      )
    })

    it("rejects a key of the options with fewer than two columns", () => {
      expect(() =>
        defineTable(
          "user",
          {
            email: t.text,
          },
          // @ts-expect-error A key of one column is marked on the column.
          { unique: [["email"]] },
        ),
      ).toThrow(
        'A key in the options of table "user" must list at least two columns; mark a key of one column with primaryKey() or unique()',
      )
    })

    it("rejects a key of the options that lists an unknown column or a column twice", () => {
      expect(() =>
        defineTable(
          "membership",
          {
            userId: t.uuid,
          },
          // @ts-expect-error The table has no column "groupId".
          { primaryKey: ["userId", "groupId"] },
        ),
      ).toThrow('A key in the options of table "membership" lists unknown column "groupId"')
      expect(() =>
        defineTable(
          "membership",
          {
            userId: t.uuid,
          },
          // @ts-expect-error A key of the options lists inherited properties as no columns.
          { primaryKey: ["userId", "toString"] },
        ),
      ).toThrow('A key in the options of table "membership" lists unknown column "toString"')
      expect(() =>
        defineTable(
          "membership",
          {
            userId: t.uuid,
          },
          { primaryKey: ["userId", "userId"] },
        ),
      ).toThrow('A key in the options of table "membership" lists column "userId" twice')
    })

    it("rejects a nullable column of the primary key of the options", () => {
      expect(() =>
        defineTable(
          "membership",
          {
            userId: t.uuid,
            groupId: t.uuid.nullable(),
          },
          // @ts-expect-error A primary key column is not nullable.
          { primaryKey: ["userId", "groupId"] },
        ),
      ).toThrow('Primary key column "groupId" of table "membership" must not be nullable')
    })

    it("rejects two keys of the same columns, in any order", () => {
      expect(() =>
        defineTable(
          "membership",
          {
            userId: t.uuid,
            groupId: t.uuid,
          },
          { primaryKey: ["userId", "groupId"], unique: [["groupId", "userId"]] },
        ),
      ).toThrow('Table "membership" declares the key of columns "groupId", "userId" twice')
    })

    it("rejects unique keys of the options that are not an array", () => {
      const options = { unique: "email" } as unknown as TableOptions<"email">

      expect(() =>
        defineTable(
          "user",
          {
            email: t.text,
          },
          options,
        ),
      ).toThrow('Unique keys in the options of table "user" must be an array')
    })
  })
})

describe("findColumn", () => {
  const form = defineTable("form", {
    name: t.text,
  })

  it("finds a column by its key", () => {
    expect(findColumn(form, "name")).toBe(form.columns.name)
  })

  it("finds no column under a missing key or a key of the object prototype", () => {
    expect(findColumn(form, "missing")).toBeUndefined()
    expect(findColumn(form, "toString")).toBeUndefined()
    expect(findColumn(form, "constructor")).toBeUndefined()
  })
})

describe("isKey and containsKey", () => {
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

  it("tell whether the columns are exactly a key, primary or unique, in any order", () => {
    expect(isKey(membership, ["groupId", "userId"])).toBe(true)
    expect(isKey(membership, ["code"])).toBe(true)
    expect(isKey(membership, ["userId"])).toBe(false)
    expect(isKey(membership, ["userId", "groupId", "role"])).toBe(false)
  })

  it("tell whether the columns include a key, primary or unique", () => {
    expect(containsKey(membership, ["role", "groupId", "userId"])).toBe(true)
    expect(containsKey(membership, ["role", "code"])).toBe(true)
    expect(containsKey(membership, ["userId", "role"])).toBe(false)
  })

  it("find no key of a table without keys", () => {
    const log = defineTable("log", {
      id: t.uuid,
    })

    expect(isKey(log, ["id"])).toBe(false)
    expect(containsKey(log, ["id"])).toBe(false)
  })

  it("read the keys of a table whose type does not tell them", () => {
    const id: Column<typeof t.uuid> = t.uuid.primaryKey()
    const widened = defineTable("widened", {
      id,
    })
    const pick = (keyed: boolean) =>
      defineTable("picked", {
        id: keyed ? t.uuid.primaryKey() : t.uuid,
      })

    expect(isKey(widened, ["id"])).toBe(true)
    expect(isKey(pick(true), ["id"])).toBe(true)
    expect(containsKey(pick(false), ["id"])).toBe(false)
  })
})
