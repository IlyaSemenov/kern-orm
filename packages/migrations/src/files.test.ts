import { describe, expect, it } from "bun:test"

import { getMigrationTestKey } from "./files"

describe("getMigrationTestKey", () => {
  it.each([
    ["0003_add_form_slug.migration-test.ts", "0003_add_form_slug"],
    ["0003_add_form_slug.edge-cases.migration-test.mjs", "0003_add_form_slug"],
    ["0003_add_form_slug.data.v2.migration-test.js", "0003_add_form_slug"],
    ["create_form.migration-test.mts", "create_form"],
  ])("returns the key of %s", (fileName, key) => {
    expect(getMigrationTestKey(fileName)).toBe(key)
  })

  it.each([
    "0003_add_form_slug.ts",
    "0003_add_form_slug.test.ts",
    "0003_add_form_slug.migration-test.json",
    "0003_add_form_slug.migration-test",
    ".migration-test.ts",
    "0003_add_form_slug-migration-test.ts",
  ])("returns undefined for %s", fileName => {
    expect(getMigrationTestKey(fileName)).toBeUndefined()
  })
})
