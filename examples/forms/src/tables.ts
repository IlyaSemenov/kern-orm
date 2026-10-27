import { defineTable } from "kern-orm"
import * as t from "kern-orm/types"

export const form = defineTable("form", {
  id: t.uuid.primaryKey().hasDefault(),
  name: t.text,
  published: t.boolean,
})

export const field = defineTable(
  "form_field",
  {
    id: t.uuid.primaryKey().hasDefault(),
    formId: t.uuid.columnName("form_id"),
    /** Order of the field in its form. */
    position: t.integer,
    label: t.text,
    /** Field of the same form that must be answered before this field is shown, if any. */
    conditionFieldId: t.uuid.nullable().columnName("condition_field_id"),
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
  /** User who reviews the submission, once assigned. */
  reviewerId: t.uuid.nullable().columnName("reviewer_id"),
  createdAt: t.timestamptz.columnName("created_at"),
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

/** Tenant-only: a comment of a user on an answer or on a whole submission. */
export const comment = defineTable("form_comment", {
  id: t.uuid.primaryKey(),
  submissionId: t.uuid.columnName("submission_id"),
  /** Field of the answer that the comment is on, or `null` for a comment on the whole submission. */
  fieldId: t.uuid.nullable().columnName("field_id"),
  authorId: t.uuid.columnName("author_id"),
  text: t.text,
  createdAt: t.timestamptz.columnName("created_at"),
})

/** SaaS-only: a SaaS tenant. */
export const tenant = defineTable("tenant", {
  id: t.uuid.primaryKey(),
  subdomain: t.text.unique(),
})
