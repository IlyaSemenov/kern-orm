import { describe, expect, it } from "bun:test"

import { defineCodec } from "../database/codec/codec"
import * as t from "../types"

import type { Column } from "./column"
import { toSnakeCase } from "./snake-case"
import type { TableOptions } from "./table"
import { containsKey, createTableFactory, defineTable, findColumn, findKey, isKey } from "./table"

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

  it("rejects a codec without operators as a column definition, naming defineType", () => {
    expect(() =>
      defineTable("form", {
        // @ts-expect-error A codec without operators is not a type.
        path: defineCodec({ sqlType: "ltree" }),
      }),
    ).toThrow(
      'Column "path" of table "form" must be a type or a column, not a codec without operators; create a type from it with defineType(codec)',
    )
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

  describe("singleton", () => {
    it("tells whether the table holds at most one row, as its option declares", () => {
      const columns = {
        token: t.text,
      }

      expect(defineTable("license", columns, { singleton: true }).singleton).toBe(true)
      expect(defineTable("license", columns, { singleton: false }).singleton).toBe(false)
      expect(defineTable("license", columns, {}).singleton).toBe(false)
      expect(defineTable("license", columns).singleton).toBe(false)
    })

    it("rejects an option that is not a boolean", () => {
      const options = { singleton: "yes" } as unknown as TableOptions<"token">

      expect(() =>
        defineTable(
          "license",
          {
            token: t.text,
          },
          options,
        ),
      ).toThrow('The singleton option of table "license" must be a boolean')
    })
  })
})

describe("createTableFactory", () => {
  const defineSnakeCaseTable = createTableFactory({ columnName: toSnakeCase })

  it("names a type and a column by the function, keeping the other attributes", () => {
    const field = defineSnakeCaseTable("form_field", {
      id: t.uuid.primaryKey().hasDefault(),
      formId: t.uuid,
      createdAt: t.timestamptz.unique(),
    })

    expect(field.name).toBe("form_field")
    expect(field.columns.id.attributes).toEqual({
      name: "id",
      keyKind: "primaryKey",
      hasDefault: true,
    })
    expect(field.columns.formId.attributes).toEqual({
      name: "form_id",
      keyKind: undefined,
      hasDefault: false,
    })
    expect(field.columns.createdAt.attributes).toEqual({
      name: "created_at",
      keyKind: "unique",
      hasDefault: false,
    })
  })

  it("names columns by any function", () => {
    // Orchid ORM 1.78.47 has only its own snakeCase, and declined a function of names: https://github.com/romeerez/orchid-orm/issues/197
    const defineCamelCaseTable = createTableFactory({
      columnName: key => key.replace(/_(.)/g, (_, letter: string) => letter.toUpperCase()),
    })
    const person = defineCamelCaseTable("person", {
      person_category_id: t.uuid,
    })

    expect(person.columns.person_category_id.attributes.name).toBe("personCategoryId")
  })

  it("calls the function once for each column without a name", () => {
    const keys: string[] = []
    const defineRecordingTable = createTableFactory({
      columnName: key => {
        keys.push(key)
        return key
      },
    })

    defineRecordingTable("form", {
      id: t.uuid,
      formId: t.uuid,
      lineTwo: t.text.columnName("line_2"),
    })

    expect(keys).toEqual(["id", "formId"])
  })

  it("keeps a name of columnName", () => {
    const field = defineSnakeCaseTable("form_field", {
      lineTwo: t.text.columnName("line_2"),
    })

    expect(field.columns.lineTwo.attributes.name).toBe("line_2")
  })

  it("leaves a column shared with other tables as it is", () => {
    const formId = t.uuid.unique()
    const field = defineSnakeCaseTable("form_field", {
      formId,
    })
    const plain = defineTable("plain", {
      formId,
    })

    expect(field.columns.formId.attributes.name).toBe("form_id")
    expect(formId.attributes.name).toBeUndefined()
    expect(plain.columns.formId).toBe(formId)
  })

  it("keeps column keys in the keys of the options", () => {
    const answer = defineSnakeCaseTable(
      "form_answer",
      {
        submissionId: t.uuid,
        fieldId: t.uuid,
      },
      { primaryKey: ["submissionId", "fieldId"] },
    )

    expect(answer.keys.primaryKey).toEqual(["submissionId", "fieldId"])
  })

  it("keeps the checks of defineTable", () => {
    expect(() =>
      defineSnakeCaseTable("form", {
        $name: t.text,
      }),
    ).toThrow('Column key "$name" of table "form" must not start with "$"')
    expect(() =>
      defineSnakeCaseTable("form", {
        ["__proto__"]: t.text,
      }),
    ).toThrow('Column key "__proto__" of table "form" is not allowed')
    expect(() =>
      defineSnakeCaseTable("form", {
        // @ts-expect-error A column definition is a type or a column.
        id: "uuid",
      }),
    ).toThrow('Column "id" of table "form" must be a type or a column')
    expect(() =>
      defineSnakeCaseTable(
        "form",
        {
          id: t.uuid,
        },
        // @ts-expect-error A key lists the columns of the table.
        { unique: [["id", "form_id"]] },
      ),
    ).toThrow('A key in the options of table "form" lists unknown column "form_id"')
  })

  it("rejects two keys that derive one name", () => {
    expect(() =>
      defineSnakeCaseTable("form_field", {
        formId: t.uuid,
        form_id: t.uuid,
      }),
    ).toThrow(
      'Columns "formId" and "form_id" of table "form_field" have one physical name "form_id"',
    )
  })

  it("rejects a derived name that columnName gives another column, in either order", () => {
    expect(() =>
      defineSnakeCaseTable("form_submission", {
        userId: t.uuid,
        owner: t.uuid.columnName("user_id"),
      }),
    ).toThrow(
      'Columns "userId" and "owner" of table "form_submission" have one physical name "user_id"',
    )
    expect(() =>
      defineSnakeCaseTable("form_submission", {
        owner: t.uuid.columnName("user_id"),
        userId: t.uuid,
      }),
    ).toThrow(
      'Columns "userId" and "owner" of table "form_submission" have one physical name "user_id"',
    )
  })

  it("allows one name of columnName on two columns", () => {
    const submission = defineSnakeCaseTable("form_submission", {
      owner: t.uuid.columnName("user_id"),
      author: t.uuid.columnName("user_id"),
    })

    expect(submission.columns.owner.attributes.name).toBe("user_id")
    expect(submission.columns.author.attributes.name).toBe("user_id")
  })

  it("rejects a derived name that is not a non-empty string", () => {
    const defineEmptyTable = createTableFactory({
      columnName: () => "",
    })
    const defineUntypedTable = createTableFactory({
      columnName: () => undefined as unknown as string,
    })

    expect(() =>
      defineEmptyTable("form", {
        id: t.uuid,
      }),
    ).toThrow('The name derived for column "id" of table "form" must be a non-empty string')
    expect(() =>
      defineUntypedTable("form", {
        id: t.uuid,
      }),
    ).toThrow('The name derived for column "id" of table "form" must be a non-empty string')
  })

  it("rejects an option that is not a function", () => {
    // @ts-expect-error The option is a function.
    expect(() => createTableFactory({ columnName: "form_id" })).toThrow(
      "The columnName option of createTableFactory must be a function",
    )
    // @ts-expect-error The option is required.
    expect(() => createTableFactory({})).toThrow(
      "The columnName option of createTableFactory must be a function",
    )
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

describe("isKey, findKey, and containsKey", () => {
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

  it("find the key of exactly the columns, in the order of the key", () => {
    expect(findKey(membership, ["groupId", "userId"])).toBe(membership.keys.primaryKey)
    expect(findKey(membership, ["code"])).toBe(membership.keys.unique[0])
    expect(findKey(membership, ["userId"])).toBeUndefined()
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
