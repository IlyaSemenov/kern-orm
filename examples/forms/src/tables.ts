import { defineTable } from "kern-orm"
import * as t from "kern-orm/types"

export const form = defineTable("form", {
  id: t.uuid.primaryKey(),
  name: t.text,
  published: t.boolean,
})

export const field = defineTable(
  "form_field",
  {
    id: t.uuid.primaryKey(),
    formId: t.uuid.columnName("form_id"),
    /** Order of the field in its form. */
    position: t.integer,
    label: t.text,
  },
  { unique: [["formId", "position"]] },
)

/** Tenant-only: a user of the tenant. */
export const user = defineTable("user", {
  id: t.uuid.primaryKey(),
  email: t.text.unique(),
})

/** Tenant-only: a form filled in by a user. */
export const submission = defineTable("form_submission", {
  id: t.uuid.primaryKey(),
  formId: t.uuid.columnName("form_id"),
  userId: t.uuid.columnName("user_id"),
})

/** Tenant-only: the answer of a submission to a form field. */
export const answer = defineTable(
  "form_answer",
  {
    id: t.uuid.primaryKey(),
    submissionId: t.uuid.columnName("submission_id"),
    fieldId: t.uuid.columnName("field_id"),
    value: t.text,
  },
  { unique: [["submissionId", "fieldId"]] },
)

/** SaaS-only: a SaaS tenant. */
export const tenant = defineTable("tenant", {
  id: t.uuid.primaryKey(),
  subdomain: t.text.unique(),
})
