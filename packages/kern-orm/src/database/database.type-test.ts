import { describe, test } from "bun:test"

import type { Database } from "./database"
import { identifier, sql } from "./sql/fragment"

declare const database: Database

describe("script", () => {
  test("takes a text, or a template of fragments", () => {
    void database.script("ANALYZE form")
    void database.script`ANALYZE ${identifier("form")}; ${sql`ANALYZE field`}`
  })

  test("rejects an object of the members of a fragment and a copy of a fragment, which only the functions of fragments create", () => {
    const shaped = { strings: ["ANALYZE form"], values: [] }
    const copy = { ...sql`ANALYZE form` }

    // @ts-expect-error A fragment is created by sql, identifier, or param.
    void database.script`${shaped}`
    // @ts-expect-error A copy of a fragment is not a fragment.
    void database.script`${copy}`
  })
})
