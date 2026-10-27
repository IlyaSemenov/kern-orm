import { describe, expect, it } from "bun:test"

import type { AnyTable } from "../table/table"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { RelationMap } from "./relation"
import { addRelation, defineRelation, freezeRelations, many, one } from "./relation"

const form = defineTable("form", {
  id: t.uuid,
  ownerId: t.uuid,
  data: t.json,
})
const field = defineTable(
  "form_field",
  {
    id: t.uuid,
    formId: t.uuid,
    ownerId: t.uuid,
    position: t.integer,
  },
  { unique: [["formId", "ownerId"]] },
)
const other = defineTable("other", {
  id: t.uuid,
})

const keys = new Map<AnyTable, string>([
  [form, "form"],
  [field, "field"],
])

function defineFields(declaration: unknown) {
  return defineRelation(form, "form", "fields", declaration, table => keys.get(table))
}

describe("defineRelation", () => {
  it("defines a relation by the keys of its declaration", () => {
    expect(defineFields(many(field, { from: "id", to: "formId" }))).toEqual({
      kind: "many",
      name: "fields",
      key: "form",
      source: form,
      target: field,
      targetKey: "field",
      from: ["id"],
      to: ["formId"],
      required: false,
    })
  })

  it("defines a composite key", () => {
    const relation = defineFields(
      one(field, { from: ["id", "ownerId"], to: ["formId", "ownerId"] }),
    )

    expect(relation).toMatchObject({
      kind: "one",
      from: ["id", "ownerId"],
      to: ["formId", "ownerId"],
    })
  })

  it("rejects a value other than a declaration of many or one", () => {
    expect(() =>
      defineFields({ kind: "many", target: field, from: ["id"], to: ["formId"] }),
    ).toThrow('Relation "form.fields" must be declared with many or one')
  })

  it("rejects a name of a column of its table or one starting with $", () => {
    const declaration = many(field, { from: "id", to: "formId" })
    const define = (name: string) =>
      defineRelation(form, "form", name, declaration, table => keys.get(table))

    expect(() => define("ownerId")).toThrow(
      'Relation "form.ownerId": a relation name must differ from the column keys of table "form"',
    )
    expect(() => define("$fields")).toThrow(
      'Relation "form.$fields": a relation name must not start with "$"',
    )
    expect(() => define("toString")).not.toThrow()
  })

  it("rejects a target outside the schema", () => {
    expect(() => defineFields(many(other, { from: "id", to: "id" }))).toThrow(
      'Relation "form.fields" refers to table "other", which is not part of the schema',
    )
  })

  it("rejects keys of different numbers of columns", () => {
    const error =
      'Relation "form.fields" must list as many columns in "to" as in "from", at least one'
    const declare = (from: unknown, to: unknown) => defineFields(many(field, { from, to } as never))

    expect(() => declare(["id", "ownerId"], ["formId"])).toThrow(error)
    expect(() => declare("id", ["formId", "ownerId"])).toThrow(error)
    expect(() => declare([], [])).toThrow(error)
  })

  it("rejects a key that is not an own column of its table", () => {
    const declare = (from: string, to: string) => defineFields(many(field, { from, to } as never))

    expect(() => declare("formId", "formId")).toThrow(
      'Relation "form.fields": unknown column "formId" of table "form"',
    )
    expect(() => declare("id", "toString")).toThrow(
      'Relation "form.fields": unknown column "toString" of table "form_field"',
    )
  })

  it("rejects columns that SQL = does not compare as they are", () => {
    expect(() => defineFields(many(field, { from: "id", to: "position" } as never))).toThrow(
      'Relation "form.fields" cannot compare column "id" (uuid) with column "position" (integer) of table "form_field" by SQL =',
    )
    expect(() => defineFields(many(field, { from: "data", to: "formId" } as never))).toThrow(
      'Relation "form.fields" cannot compare column "data" (json) with column "formId" (uuid) of table "form_field" by SQL =',
    )
  })

  it("rejects a relation one whose columns to include no key of the target", () => {
    expect(() =>
      // @ts-expect-error The key of a field is its form and owner.
      defineFields(one(field, { from: "id", to: "formId" })),
    ).toThrow(
      'Relation "form.fields": columns "to" must include a key of table "form_field", primary or unique',
    )
  })

  it("keeps the keys of its declaration when the arrays change", () => {
    const from: string[] = ["id"]
    const declaration = many(field, { from, to: ["formId"] } as never)
    from[0] = "ownerId"

    expect(defineFields(declaration).from).toEqual(["id"])
  })

  describe("required", () => {
    const user = defineTable("user", {
      id: t.uuid.primaryKey(),
      groupId: t.uuid,
    })
    const post = defineTable("post", {
      id: t.uuid.primaryKey(),
      authorId: t.uuid,
      editorId: t.uuid.nullable(),
      groupId: t.uuid.nullable(),
    })
    const postKeys = new Map<AnyTable, string>([
      [user, "user"],
      [post, "post"],
    ])

    function defineTestRelation(declaration: unknown, source: AnyTable = post) {
      const key = postKeys.get(source)!
      return defineRelation(source, key, "related", declaration, table => postKeys.get(table))
    }

    it("is taken for a relation one as declared, and false where it is not set", () => {
      expect(
        defineTestRelation(one(user, { from: "authorId", to: "id", required: true })).required,
      ).toBe(true)
      expect(
        defineTestRelation(one(user, { from: "authorId", to: "id", required: false })).required,
      ).toBe(false)
      expect(defineTestRelation(one(user, { from: "authorId", to: "id" })).required).toBe(false)
      expect(defineTestRelation(one(user, { from: "editorId", to: "id" })).required).toBe(false)
    })

    it("is false for a relation one whose optional required is missing", () => {
      const keys: { from: "authorId"; to: "id"; required?: true } = { from: "authorId", to: "id" }

      expect(defineTestRelation(one(user, keys)).required).toBe(false)
    })

    it("rejects a required relation one with a nullable column from", () => {
      expect(() =>
        defineTestRelation(one(user, { from: "editorId", to: "id", required: true })),
      ).toThrow(
        'Relation "post.related" cannot be required: column "editorId" of table "post" is nullable',
      )
      expect(() =>
        defineTestRelation(
          one(user, { from: ["authorId", "groupId"], to: ["id", "groupId"], required: true }),
        ),
      ).toThrow(
        'Relation "post.related" cannot be required: column "groupId" of table "post" is nullable',
      )
    })

    it("is false for a relation many", () => {
      expect(defineTestRelation(many(post, { from: "id", to: "authorId" }), user).required).toBe(
        false,
      )
    })
  })
})

describe("addRelation", () => {
  const fields = defineFields(many(field, { from: "id", to: "formId" }))

  it("adds a definition once, however many times it is added", () => {
    const relations: RelationMap = new Map()
    addRelation(relations, "form", "fields", fields)
    addRelation(relations, "form", "fields", fields)

    expect(freezeRelations(relations)).toEqual({ form: { fields } })
  })

  it("rejects another definition of a relation of a table", () => {
    const relations: RelationMap = new Map()
    addRelation(relations, "form", "fields", fields)

    expect(() =>
      addRelation(
        relations,
        "form",
        "fields",
        defineFields(many(field, { from: "id", to: "formId" })),
      ),
    ).toThrow('Relation "form.fields" has two different definitions')
  })
})

describe("freezeRelations", () => {
  it("keeps keys that name properties of the object prototype as own properties", () => {
    const fields = defineFields(many(field, { from: "id", to: "formId" }))
    const relations: RelationMap = new Map([["__proto__", new Map([["toString", fields]])]])

    const frozen = freezeRelations(relations)

    expect(Object.keys(frozen)).toEqual(["__proto__"])
    expect(Object.keys(frozen["__proto__"]!)).toEqual(["toString"])
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(Object.isFrozen(frozen["__proto__"])).toBe(true)
  })
})
