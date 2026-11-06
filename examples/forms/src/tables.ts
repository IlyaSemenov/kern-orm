import { createTableFactory, toSnakeCase } from "kern-orm"
import * as t from "kern-orm/types"

const defineTable = createTableFactory({ columnName: toSnakeCase })

export const form = defineTable("form", {
  id: t.uuid.primaryKey().hasDefault(),
  name: t.text,
  published: t.boolean,
})

export const field = defineTable(
  "form_field",
  {
    id: t.uuid.primaryKey().hasDefault(),
    formId: t.uuid,
    /** Order of the field in its form. */
    position: t.integer,
    label: t.text,
    /** Field of the same form that must be answered before this field is shown, if any. */
    conditionFieldId: t.uuid.nullable(),
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
  formId: t.uuid,
  userId: t.uuid,
  /** User who reviews the submission, once assigned. */
  reviewerId: t.uuid.nullable(),
  createdAt: t.timestamptz,
})

/** Tenant-only: the answer of a submission to a form field. */
export const answer = defineTable(
  "form_answer",
  {
    id: t.uuid.primaryKey(),
    submissionId: t.uuid,
    fieldId: t.uuid,
    value: t.text,
  },
  { unique: [["submissionId", "fieldId"]] },
)

/** Tenant-only: a comment of a user on an answer or on a whole submission. */
export const comment = defineTable("form_comment", {
  id: t.uuid.primaryKey(),
  submissionId: t.uuid,
  /** Field of the answer that the comment is on, or `null` for a comment on the whole submission. */
  fieldId: t.uuid.nullable(),
  authorId: t.uuid,
  text: t.text,
  createdAt: t.timestamptz,
})

/** SaaS-only: a SaaS tenant. */
export const tenant = defineTable("tenant", {
  id: t.uuid.primaryKey(),
  subdomain: t.text.unique(),
})
