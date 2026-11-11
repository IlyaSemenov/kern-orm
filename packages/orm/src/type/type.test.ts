import { describe, expect, it } from "bun:test"

import { defineType as defineDbType, isType as isDbType } from "kern-db"

import { orderingOperators } from "../expression/operators/ordering"
import { sql } from "../expression/sql"

import { numeric } from "./builtins/numeric"
import { text } from "./builtins/text"
import { defineType, describeRejectedDbType, isType } from "./type"

describe("defineType", () => {
  const dbVector = defineDbType({ sqlType: "vector" })
    .transform({
      decode: text => JSON.parse(text) as number[],
      encode: (value: number[]) => JSON.stringify(value),
    })
    .withParameters((dimensions: number) => `vector(${dimensions})`)

  it("defines a type of the text representations as they are", () => {
    const ltree = defineType({ sqlType: "ltree" })

    expect(ltree.sqlType).toBe("ltree")
    expect(ltree.castType).toBe("ltree")
    expect(ltree.isNullable).toBe(false)
    expect(ltree.decode(ltree.encode("a.b"))).toBe("a.b")
    expect(ltree.operators).toEqual({})
  })

  it("defines a type from a type of kern-db, with its values and type parameters", () => {
    const vector = defineType(dbVector)

    expect(vector.sqlType).toBe("vector")
    expect(vector.with(1536).sqlType).toBe("vector(1536)")
    expect(vector.with(1536).castType).toBe("vector")
    expect(vector.with(3).nullable().isNullable).toBe(true)
    expect(vector.decode("[1,2]")).toEqual([1, 2])
    expect(vector.operators).toEqual({})
  })

  it("defines a type from another type, with its values and type parameters and without its operators", () => {
    const plain = defineType(numeric.nullable())

    expect(plain.operators).toEqual({})
    expect(plain.sqlType).toBe("numeric")
    expect(plain.isNullable).toBe(true)
    expect(plain.encode).toBe(numeric.encode)
    expect(plain.with(10, 2).sqlType).toBe("numeric(10,2)")
    expect(plain.with(10, 2).operators).toEqual({})
    expect(plain.transform({ decode: Number }).decode("12.50")).toBe(12.5)
    expect(isType(plain.with(10, 2))).toBe(true)
  })

  it("defines a type that encodes and decodes by the functions of its type of kern-db", () => {
    const vector = defineType(dbVector).withOperators(orderingOperators)

    expect(vector.encode).toBe(dbVector.encode)
    expect(vector.decode).toBe(dbVector.decode)
    expect(vector.nullable().with(3).decode).toBe(dbVector.decode)
  })

  it("defines a type that is a type of kern-db, unlike a column of it", () => {
    const vector = defineType(dbVector)

    expect(isDbType(vector)).toBe(true)
    expect(isDbType(vector.withOperators(orderingOperators).with(3).nullable())).toBe(true)
    expect(isDbType(vector.columnName("embedding"))).toBe(false)
  })

  it("defines a type that cannot be changed", () => {
    expect(Object.isFrozen(defineType(dbVector))).toBe(true)
    expect(Object.isFrozen(defineType(dbVector).nullable())).toBe(true)
  })
})

describe("isType", () => {
  it("takes a type, and neither a type of kern-db without operators nor a column", () => {
    const dbType = defineDbType({ sqlType: "ltree" })

    expect(isType(defineType(dbType))).toBe(true)
    expect(isType(dbType)).toBe(false)
    expect(isType(defineType(dbType).unique())).toBe(false)
    // @ts-expect-error A type of kern-db is not a type of kern-orm.
    expect(() => sql(dbType)).toThrow("sql() accepts a type")
  })
})

describe("describeRejectedDbType", () => {
  it("hints defineType for a type of kern-db, and describes no value that is not a type of kern-db", () => {
    const dbType = defineDbType({ sqlType: "ltree" })

    expect(describeRejectedDbType(dbType)).toBe(
      "a type of kern-db, which has no operators; take a built-in type from kern-orm/types, or create a type from it with defineType() of kern-orm",
    )
    expect(describeRejectedDbType(defineType(dbType).unique())).toBeUndefined()
    expect(describeRejectedDbType("ltree")).toBeUndefined()
  })
})

describe("operators", () => {
  it("stay the same on a type derived from the type they were added to", () => {
    const amount = numeric.withOperators({
      isZero: self => sql<boolean>`${self} = 0`,
    })
    const { operators } = amount

    expect(Object.isFrozen(operators)).toBe(true)
    expect(amount.nullable().operators).toBe(operators)
    expect(amount.transform({ decode: Number }).operators).toBe(operators)
    expect(amount.with(10, 2).operators).toBe(operators)
    expect(amount.withParameters((precision: number) => `numeric(${precision})`).operators).toBe(
      operators,
    )
    expect(amount.of<"0">().operators).toBe(operators)
  })
})

describe("of", () => {
  it("narrows the values only in types, keeping the type", () => {
    expect<unknown>(text.of<"a" | "b">()).toBe(text)
  })
})
