import { defineSchema, many, one } from "kern-orm"

import { answer, comment, field, form, submission, tenant, user } from "./tables"

/** Form tables and their relations, shared by tenant schemas and the SaaS schema, where forms are templates. */
export const formsSchema = defineSchema({ form, field }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
  field: {
    form: one(form, { from: "formId", to: "id", required: true }),
    condition: one(field, { from: "conditionFieldId", to: "id" }),
    dependents: many(field, { from: "id", to: "conditionFieldId" }),
  },
})

/** Schema of a tenant, whose users fill in forms and review and comment on the submissions. */
export const tenantSchema = defineSchema(formsSchema, {
  user,
  submission,
  answer,
  comment,
}).$relations({
  form: {
    submissions: many(submission, { from: "id", to: "formId" }),
  },
  field: {
    answers: many(answer, { from: "id", to: "fieldId" }),
  },
  user: {
    submissions: many(submission, { from: "id", to: "userId" }),
    reviews: many(submission, { from: "id", to: "reviewerId" }),
    comments: many(comment, { from: "id", to: "authorId" }),
  },
  submission: {
    form: one(form, { from: "formId", to: "id", required: true }),
    user: one(user, { from: "userId", to: "id", required: true }),
    reviewer: one(user, { from: "reviewerId", to: "id" }),
    answers: many(answer, { from: "id", to: "submissionId" }),
    comments: many(comment, { from: "id", to: "submissionId" }),
  },
  answer: {
    submission: one(submission, { from: "submissionId", to: "id", required: true }),
    field: one(field, { from: "fieldId", to: "id", required: true }),
    comments: many(comment, { from: ["submissionId", "fieldId"], to: ["submissionId", "fieldId"] }),
  },
  comment: {
    author: one(user, { from: "authorId", to: "id", required: true }),
    // Not required: a comment on the whole submission has no field.
    answer: one(answer, { from: ["submissionId", "fieldId"], to: ["submissionId", "fieldId"] }),
  },
})

export const saasSchema = defineSchema(formsSchema, { tenant })
