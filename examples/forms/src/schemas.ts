import { defineSchema, many, one } from "kern-orm"

import { answer, field, form, submission, tenant, user } from "./tables"

/** Form tables and their relations, shared by tenant schemas and the SaaS schema, where forms are templates. */
export const formsSchema = defineSchema({ form, field }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
  field: {
    form: one(form, { from: "formId", to: "id" }),
  },
})

/** Schema of a tenant, whose users fill in forms. */
export const tenantSchema = defineSchema(formsSchema, { user, submission, answer }).$relations({
  field: {
    answers: many(answer, { from: "id", to: "fieldId" }),
  },
  submission: {
    form: one(form, { from: "formId", to: "id" }),
    user: one(user, { from: "userId", to: "id" }),
    answers: many(answer, { from: "id", to: "submissionId" }),
  },
  answer: {
    submission: one(submission, { from: "submissionId", to: "id" }),
    field: one(field, { from: "fieldId", to: "id" }),
  },
})

export const saasSchema = defineSchema(formsSchema, { tenant })
