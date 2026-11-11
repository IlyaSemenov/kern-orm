import { describe, expect, it } from "bun:test"

import type { TextValue } from "../driver"
import { array } from "../type/builtins/array"
import { jsonb } from "../type/builtins/json"
import { integer, numeric } from "../type/builtins/numeric"
import { defineType } from "../type/type"

import type { ParameterBinder } from "./fragment"
import { compileFragment, identifier, param, renderFragment, sql, SqlFragment } from "./fragment"

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

  it("binds the parameters of a fragment at each place of a statement, also the parameter of param", () => {
    const name = sql`${"Survey"}`
    const size = param(integer, 1)

    expect(compileFragment(sql`SELECT ${name}, ${name}, ${size}, ${size}`)).toEqual({
      text: "SELECT $1, $2, ($3::integer), ($4::integer)",
      parameters: ["Survey", "Survey", "1", "1"],
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

  it("is frozen", () => {
    expect(Object.isFrozen(sql`SELECT ${1}`)).toBe(true)
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
