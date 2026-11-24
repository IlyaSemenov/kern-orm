import { describe, expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"

import type { TextValue } from "../driver"
import { array } from "../type/builtins/array"
import { timestamptz } from "../type/builtins/datetime"
import { jsonb } from "../type/builtins/json"
import { integer, numeric } from "../type/builtins/numeric"
import { defineType } from "../type/type"

import type { ParameterBinder } from "./fragment"
import {
  compileFragment,
  identifier,
  joinSql,
  param,
  renderFragment,
  sql,
  SqlFragment,
} from "./fragment"

describe("sql", () => {
  it("makes the interpolated values parameters, numbered in the order of the text", () => {
    const at = new Date("2026-01-02T03:04:05.678Z")

    expect(
      compileFragment(
        sql`UPDATE form SET name = ${"Survey"}, published = ${true}, size = ${10n}, data = ${new Uint8Array([1])}, note = ${null} WHERE updated_at < ${at} LIMIT ${5}`,
      ),
    ).toEqual({
      text: "UPDATE form SET name = $1, published = $2, size = $3, data = $4, note = $5 WHERE updated_at < $6 LIMIT $7",
      parameters: ["Survey", "t", "10", "\\x01", null, "2026-01-02T03:04:05.678Z", "5"],
    })
  })

  it("keeps an interpolated fragment as SQL, numbering its parameters with those around it, at any depth", () => {
    const published = sql`published = ${true}`
    const condition = sql`name = ${"Survey"} AND (${published} OR ${sql`size > ${3}`})`

    expect(compileFragment(sql`SELECT ${1} FROM form WHERE ${condition} LIMIT ${5}`)).toEqual({
      text: "SELECT $1 FROM form WHERE name = $2 AND (published = $3 OR size > $4) LIMIT $5",
      parameters: ["1", "Survey", "t", "3", "5"],
    })
  })

  it("binds a value of a fragment at each place of a statement, and the parameter of a param once, numbering it at its first place", () => {
    const name = sql`${"Survey"}`
    const size = param(integer, 1)

    expect(
      compileFragment(
        sql`SELECT ${name}, ${size}, ${name}, ${sql`${size} + ${param(integer, 1)}`}, ${size}`,
      ),
    ).toEqual({
      text: "SELECT $1, ($2::integer), $3, ($2::integer) + ($4::integer), ($2::integer)",
      parameters: ["Survey", "1", "Survey", "1"],
    })
  })

  it("encodes a value each time the fragment is compiled, so a statement has the value as it is then", () => {
    const at = new Date("2026-01-02T03:04:05.678Z")
    const fragment = sql`SELECT ${at}`

    at.setUTCFullYear(2027)
    expect(compileFragment(fragment).parameters).toEqual(["2027-01-02T03:04:05.678Z"])
    at.setUTCFullYear(2028)
    expect(compileFragment(fragment).parameters).toEqual(["2028-01-02T03:04:05.678Z"])
  })

  it("rejects a value that is neither a fragment nor a value of a parameter without a type when it is created", () => {
    for (const value of [{ name: "Survey" }, [1, 2], () => 1, Symbol("value")]) {
      // @ts-expect-error The template takes neither an object, an array, a function, nor a symbol.
      expect(() => sql`SELECT ${value}`).toThrow("A parameter without a type takes a string")
    }
    // @ts-expect-error The template takes no undefined.
    expect(() => sql`SELECT ${undefined}`).toThrow("Query parameter is undefined")
  })

  it("is frozen, also as an instance of another class of fragments", () => {
    class CustomFragment extends SqlFragment {}

    expect(Object.isFrozen(sql`SELECT ${1}`)).toBe(true)
    expect(Object.isFrozen(new CustomFragment(["SELECT 1"], []))).toBe(true)
  })
})

describe("joinSql", () => {
  it("joins fragments with commas, numbering their parameters in the order of the text, in one fragment of their text and values", () => {
    const rows = [
      { id: 1, name: "Survey" },
      { id: 2, name: "Quiz" },
    ]
    const values = joinSql(rows.map(row => sql`(${row.id}, ${row.name})`))

    expect(values).toEqual(
      new SqlFragment(["(", ", ", "), (", ", ", ")"], [1, "Survey", 2, "Quiz"]),
    )
    expect(compileFragment(sql`INSERT INTO form (id, name) VALUES ${values}`)).toEqual({
      text: "INSERT INTO form (id, name) VALUES ($1, $2), ($3, $4)",
      parameters: ["1", "Survey", "2", "Quiz"],
    })
  })

  it("joins with a separator of its own, also one with parameters", () => {
    const conditions = [sql`published`, sql`name = ${"Survey"}`]

    expect(compileFragment(joinSql(conditions, sql` AND `))).toEqual({
      text: "published AND name = $1",
      parameters: ["Survey"],
    })
    expect(compileFragment(joinSql([1, 2], sql` + ${3} + `))).toEqual({
      text: "$1 + $2 + $3",
      parameters: ["1", "3", "2"],
    })
  })

  it("makes a value that is not a fragment a parameter, as the template of sql does", () => {
    expect(compileFragment(sql`SELECT FROM form WHERE id IN (${joinSql([1, 2, 3])})`)).toEqual({
      text: "SELECT FROM form WHERE id IN ($1, $2, $3)",
      parameters: ["1", "2", "3"],
    })
  })

  it("binds a param that several items interpolate once", () => {
    const now = param(timestamptz, "2026-01-02T03:04:05.678Z")

    expect(compileFragment(joinSql([sql`(${1}, ${now})`, sql`(${2}, ${now})`], sql`, `))).toEqual({
      text: "($1, ($2::timestamptz)), ($3, ($2::timestamptz))",
      parameters: ["1", "2026-01-02T03:04:05.678Z", "2"],
    })
  })

  it("rejects an empty array, a value that is not an array, a value that a parameter does not take without a type, and a separator that is not a fragment", () => {
    expect(getThrownError(() => joinSql([]))).toEqual(
      new TypeError("joinSql() takes at least one item"),
    )
    // @ts-expect-error The items are an array.
    expect(getThrownError(() => joinSql(sql`a`))).toEqual(
      new TypeError("joinSql() takes an array of fragments and values"),
    )
    // @ts-expect-error A parameter without a type takes no object.
    expect(getThrownError(() => joinSql([{ id: 1 }]))).toEqual(
      new TypeError(
        "A parameter without a type takes a string, a number, a bigint, a boolean, null, a Date, or a Uint8Array, not an object; pass JSON or an array with param()",
      ),
    )
    // @ts-expect-error The separator is a fragment.
    expect(getThrownError(() => joinSql([1, 2], " AND "))).toEqual(
      new TypeError("joinSql() takes a separator as a fragment, such as sql` AND `"),
    )
  })
})

describe("identifier", () => {
  it("quotes a name, keeping dots and doubling quotes", () => {
    expect(compileFragment(sql`SELECT FROM ${identifier('app.form "draft"')}`)).toEqual({
      text: 'SELECT FROM "app.form ""draft"""',
      parameters: [],
    })
  })

  it("makes a qualified name of several names", () => {
    expect(compileFragment(identifier("app", "form", "name")).text).toBe('"app"."form"."name"')
  })

  it("rejects a call without names or with an empty or non-string name", () => {
    const message = "identifier() takes names as non-empty strings"

    // @ts-expect-error A name is required.
    expect(() => identifier()).toThrow("identifier() takes at least one name")
    expect(() => identifier("app", "")).toThrow(message)
    // @ts-expect-error A name is a string.
    expect(() => identifier("app", undefined)).toThrow(message)
  })
})

describe("param", () => {
  it("encodes its value with the type and casts the parameter to the cast type, in parentheses", () => {
    expect(
      compileFragment(
        sql`SELECT ${param(jsonb, { choices: ["a"] })}, ${param(array(integer), [1, 2])}[1], ${param(numeric.with(10, 2), "1.50")}`,
      ),
    ).toEqual({
      text: "SELECT ($1::jsonb), ($2::integer[])[1], ($3::numeric)",
      parameters: ['{"choices":["a"]}', '{"1","2"}', "1.50"],
    })
  })

  it("encodes its value each time the fragment is compiled", () => {
    const value = { choices: ["a"] }
    const fragment = param(jsonb, value)

    value.choices.push("b")
    expect(compileFragment(fragment).parameters).toEqual(['{"choices":["a","b"]}'])
    value.choices.push("c")
    expect(compileFragment(fragment).parameters).toEqual(['{"choices":["a","b","c"]}'])
  })

  it("passes null as NULL without encoding it", () => {
    expect(compileFragment(param(integer.nullable(), null))).toEqual({
      text: "($1::integer)",
      parameters: [null],
    })
  })

  it("takes an object that copies the members of a type", () => {
    const type = { ...integer, operators: {} }

    expect(compileFragment(param(type, 1))).toEqual({ text: "($1::integer)", parameters: ["1"] })
  })

  it("rejects a value that is not a type, and an undefined value", () => {
    // @ts-expect-error The options of a type are not a type.
    expect(() => param({ sqlType: "ltree" }, "a.b")).toThrow(
      "param() takes a type and the value that it encodes",
    )
    // @ts-expect-error A type of text takes no undefined.
    expect(() => param(defineType({ sqlType: "ltree" }), undefined)).toThrow(
      "Query parameter is undefined",
    )
  })
})

describe("renderFragment", () => {
  it("binds the parameter of param by one key at every place of the fragment, and other parameters without a key", () => {
    const calls: [key: object | undefined, value: TextValue][] = []
    const binder: ParameterBinder = {
      bind(value) {
        calls.push([undefined, value])
        return "?"
      },
      bindParam(key, value) {
        calls.push([key, value])
        return "?p"
      },
    }
    const zone = param(defineType({ sqlType: "text" }), "UTC")
    const other = param(defineType({ sqlType: "text" }), "UTC")

    expect(renderFragment(sql`${zone} ${1} ${sql`${zone}`} ${other}`, binder)).toBe(
      "(?p::text) ? (?p::text) (?p::text)",
    )
    expect(calls.map(([, value]) => value)).toEqual(["UTC", "1", "UTC", "UTC"])
    const keys = calls.map(([key]) => key)
    expect(keys[1]).toBeUndefined()
    expect(keys[2]).toBe(keys[0])
    expect(keys[3]).not.toBe(keys[0])
  })

  it("rejects a value of a fragment created without its functions that a parameter does not take without a type", () => {
    const fragment = new SqlFragment(["SELECT ", ""], [{ name: "Survey" }])

    expect(() => compileFragment(fragment)).toThrow(
      "A parameter without a type takes a string, a number, a bigint, a boolean, null, a Date, or a Uint8Array, not an object",
    )
  })
})
