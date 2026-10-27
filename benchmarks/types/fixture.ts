// Schemas and Dbs of the benchmarks of queries: a schema of forms, and a tenant schema that includes it and adds answers.

import type { Driver } from "kern-orm"
import { createDatabase, defineSchema, defineTable, many, one } from "kern-orm"
import * as t from "kern-orm/types"

const form = defineTable("form", {
  id: t.uuid.primaryKey(),
  name: t.text,
  published: t.boolean,
})
const field = defineTable("field", {
  id: t.uuid.primaryKey(),
  formId: t.uuid,
  position: t.integer,
  label: t.text,
})
const answer = defineTable("answer", {
  id: t.uuid.primaryKey(),
  fieldId: t.uuid,
  value: t.text,
})

export const formsSchema = defineSchema({ form, field }).$relations({
  form: { fields: many(field, { from: "id", to: "formId" }) },
  field: { form: one(form, { from: "formId", to: "id" }) },
})
const tenantSchema = defineSchema(formsSchema, { answer }).$relations({
  field: { answers: many(answer, { from: "id", to: "fieldId" }) },
})

// The benchmarks only check the types of queries and never run them.
const database = createDatabase({ driver: {} as Driver })
export const formsDb = database.bind(formsSchema)
export const tenantDb = database.bind(tenantSchema)
