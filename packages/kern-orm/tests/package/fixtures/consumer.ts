// Uses every entry point of the published packages without connecting to a database.
import { postgresJsDriver } from "@kern-orm/postgres-js"
import type { ResultOf } from "kern-orm"
import { createDatabase, defineSchema, defineTable } from "kern-orm"
import type { TestFixture } from "kern-orm/testing"
import { createTestHelpers } from "kern-orm/testing"
import * as t from "kern-orm/types"
import postgres from "postgres"

const form = defineTable("form", {
  id: t.uuid,
  name: t.text,
})

const driver = postgresJsDriver(postgres())
const database = createDatabase({ driver })
const db = database.bind(defineSchema({ form }), { schemaName: "app" })

const query = db.form.where({ name: "Survey" }).select("id")
const record: ResultOf<typeof query> = { id: "form-id" }

// The hooks never run, so the fixture never opens.
const { useTestFixture } = createTestHelpers(createDatabase({ driver, test: true }), {
  before: () => {},
  after: () => {},
})
useTestFixture(async () => ({ formId: "form-id" })) satisfies TestFixture<{ formId: string }>

const { text, parameters } = query.toSQL()
console.log(JSON.stringify({ text, parameters, record }))
await database.close()
