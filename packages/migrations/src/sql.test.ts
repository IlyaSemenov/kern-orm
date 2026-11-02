import { describe, expect, it } from "bun:test"

import { describePostgres } from "../testing/postgres"

import { quoteDollar, quoteIdentifier, quoteLiteral } from "./sql"

describe("quoteIdentifier", () => {
  it("quotes a name, doubling its quotes", () => {
    expect(quoteIdentifier('my "form"')).toBe('"my ""form"""')
  })

  it("rejects an empty name", () => {
    expect(() => quoteIdentifier("")).toThrow("Cannot quote an empty name")
  })
})

describe("quoteLiteral", () => {
  it("quotes a string, doubling its quotes", () => {
    expect(quoteLiteral("it's")).toBe("'it''s'")
  })

  it("prefixes literals containing backslashes with E and doubles the backslashes", () => {
    expect(quoteLiteral("a\\'b")).toBe("E'a\\\\''b'")
  })
})

describe("quoteDollar", () => {
  it("quotes a body with the first dollar tag that it does not contain", () => {
    expect([quoteDollar(" x "), quoteDollar(" $$ "), quoteDollar(" $$ $_$ ")]).toEqual([
      "$$ x $$",
      "$_$ $$ $_$",
      "$__$ $$ $_$ $__$",
    ])
  })
})

describePostgres("quoteLiteral in PostgreSQL", ({ database, testTransaction, notices }) => {
  const values = ["it's", "a\\b", "a\\'b\\", "\\n", "line\nbreak", "$$", "я"]

  it("keeps the value of a string whatever standard_conforming_strings is", async () => {
    notices.length = 0

    const result = await testTransaction(async () => {
      const read = async () => {
        const { rows } = await database.execute({
          text: `SELECT ${values.map(quoteLiteral).join(", ")}`,
          parameters: [],
        })
        return rows[0]
      }
      await database.script("SET LOCAL standard_conforming_strings = on")
      const on = await read()
      await database.script("SET LOCAL standard_conforming_strings = off")
      return { on, off: await read() }
    })

    expect(result).toEqual({ on: values, off: values })
    expect(notices).toEqual([])
  })
})
