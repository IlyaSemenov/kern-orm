import { expect, it } from "bun:test"

import { toSnakeCase } from "./snake-case"

it("starts a word at a capital letter", () => {
  expect(toSnakeCase("id")).toBe("id")
  expect(toSnakeCase("formId")).toBe("form_id")
  expect(toSnakeCase("conditionFieldId")).toBe("condition_field_id")
})

it("adds no underscore before a first capital letter", () => {
  expect(toSnakeCase("FormId")).toBe("form_id")
})

it("takes a run of capital letters for one word", () => {
  // Orchid ORM 1.78.47 gives i_d and user_i_d: https://github.com/romeerez/orchid-orm/blob/main/packages/pqb/src/utils.ts
  expect(toSnakeCase("ID")).toBe("id")
  expect(toSnakeCase("userID")).toBe("user_id")
})

it("starts the next word at the last capital letter of a run before a lowercase letter", () => {
  // Kysely 0.29.8 with its defaults gives jsondata and parse_htmldoc: https://github.com/kysely-org/kysely/blob/master/src/plugin/camel-case/camel-case.ts
  expect(toSnakeCase("JSONData")).toBe("json_data")
  expect(toSnakeCase("parseHTMLDoc")).toBe("parse_html_doc")
  expect(toSnakeCase("HTTPServer")).toBe("http_server")
})

it("keeps a plural s at the end of a key in the word of its run of capital letters", () => {
  // Drizzle 0.45.4 gives user_i_ds and ap_is: https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/casing.ts
  expect(toSnakeCase("userIDs")).toBe("user_ids")
  expect(toSnakeCase("APIs")).toBe("apis")
})

it("takes an s before another word for the end of a word of its own", () => {
  expect(toSnakeCase("URLIsValid")).toBe("url_is_valid")
  expect(toSnakeCase("JSONAsText")).toBe("json_as_text")
  // Case does not tell this plural from the words above, so such a key requires columnName.
  expect(toSnakeCase("IDsList")).toBe("i_ds_list")
})

it("keeps digits in their word", () => {
  expect(toSnakeCase("line2")).toBe("line2")
  expect(toSnakeCase("line2Text")).toBe("line2_text")
  expect(toSnakeCase("s3URL")).toBe("s3_url")
  expect(toSnakeCase("ipV4Address")).toBe("ip_v4_address")
})

it("keeps a key in snake case", () => {
  expect(toSnakeCase("form_id")).toBe("form_id")
})

it("adds no underscore after an underscore", () => {
  expect(toSnakeCase("form_Id")).toBe("form_id")
})

it("converts the capital letters of any alphabet", () => {
  expect(toSnakeCase("имяПоля")).toBe("имя_поля")
})
