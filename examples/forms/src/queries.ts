import type { DbOf } from "kern-orm"
import { defineExpression, defineHelper, desc, or } from "kern-orm"
import { defineDependency } from "ripple-di"

import { formsSchema, tenantSchema } from "./schemas"

/** Shared query executable by every `Db` whose schema contains the form tables. */
export const publishedForms = formsSchema.form.where({ published: true }).select("id", "name")

/** Selects the fields of a form shown in its editor, in their order in the form. */
export const selectFormFields = defineHelper(formsSchema.field, field =>
  field.select("id", "label").orderBy("position", "id"),
)

/** Selects a form with its fields, the same for the forms of a tenant and the templates of the SaaS. */
export const selectForm = defineHelper(formsSchema.form, form =>
  form.select("id", "name").select(columns => ({
    fields: columns.fields.use(selectFormFields),
  })),
)

/** Tells whether a form has a field with a label, the same for the forms of a tenant and the templates of the SaaS. */
export const hasFieldLabel = defineExpression(formsSchema.form, (form, label: string) =>
  form.fields.where({ label }).exists(),
)

/** Returns the numbers of fields of the published forms by name through the `Db` of a tenant or of the SaaS. */
export async function listFieldCounts(db: DbOf<typeof formsSchema>) {
  return await db.form
    .where({ published: true })
    .orderBy("name", "id")
    .pluck(form => form.fields.count())
}

/** Publishes a form only if it has a field with a label, in one statement, through the `Db` of a tenant or of the SaaS. */
export async function publishWithFieldLabel(
  db: DbOf<typeof formsSchema>,
  formId: string,
  label: string,
) {
  await db.form.find(formId).update(form => ({
    published: hasFieldLabel(form, label),
  }))
}

/** Returns a form with its fields through the `Db` of a tenant or of the SaaS. */
export async function getForm(db: DbOf<typeof formsSchema>, formId: string) {
  return await db.form.find(formId).use(selectForm)
}

/** Returns a form with its fields and the number of published forms in one statement through the `Db` of a tenant or of the SaaS. */
export async function getFormPage(db: DbOf<typeof formsSchema>, formId: string) {
  return await db.$select({
    form: db.form.find(formId).use(selectForm),
    publishedCount: db.form.where({ published: true }).count(),
  })
}

/** Returns a field with the name of its form through the `Db` of a tenant or of the SaaS. */
export async function getField(db: DbOf<typeof formsSchema>, fieldId: string) {
  return await db.field
    .find(fieldId)
    .select("id", "label")
    .select(field => ({
      formName: field.form.get("name"),
    }))
}

/** Returns the labels of the fields of a form in their order through the `Db` of a tenant or of the SaaS. */
export async function getFieldLabels(db: DbOf<typeof formsSchema>, formId: string) {
  return await db.field.where({ formId }).orderBy("position", "id").pluck("label")
}

/** Selects a form as a card of a list, the same for a form that a query reads and one that an insert creates. */
export const selectFormCard = defineHelper(formsSchema.form, form =>
  form
    .select("id", "name")
    .select(columns => ({
      fieldCount: columns.fields.count(),
    }))
    .map(card => ({
      ...card,
      title: card.fieldCount === 0 ? `${card.name} (empty)` : card.name,
    })),
)

/** Returns the cards of the published forms of a page through the `Db` of a tenant or of the SaaS. */
export async function listFormCards(db: DbOf<typeof formsSchema>, limit: number) {
  return await db.form
    .use(selectFormCard)
    .where({ published: true })
    .orderBy("name", "id")
    .limit(limit)
}

/** Creates a form and returns its card through the `Db` of a tenant or of the SaaS. */
export async function createFormCard(db: DbOf<typeof formsSchema>, name: string) {
  return await db.form.insert({ name, published: false }).use(selectFormCard)
}

/** Returns the numbers of the fields of each form by the identifier of the form through the `Db` of a tenant or of the SaaS. */
export async function getFieldCountsById(db: DbOf<typeof formsSchema>) {
  return await db.form
    .select(form => ({
      id: form.id,
      fieldCount: form.fields.count(),
    }))
    .transform(forms => new Map(forms.map(form => [form.id, form.fieldCount])))
}

/** Returns a line of each form with the labels of its fields, for a list of forms, through the `Db` of a tenant or of the SaaS. */
export async function listFormHeadlines(db: DbOf<typeof formsSchema>) {
  return await db.form
    .orderBy("name", "id")
    .select(form => ({
      name: form.name,
      labels: form.fields
        .orderBy("position", "id")
        .pluck("label")
        .map(label => label.toLowerCase())
        .transform(labels => labels.join(", ")),
    }))
    .map(form => `${form.name}: ${form.labels}`)
}

/** Returns the labels of the fields of a form in their order, each with the label of the field it is shown after and the labels of the fields shown after it, through the `Db` of a tenant or of the SaaS. */
export async function listFieldConditions(db: DbOf<typeof formsSchema>, formId: string) {
  return await db.field
    .where({ formId })
    .orderBy("position")
    .select("label")
    .select(field => ({
      shownAfter: field.condition.get("label"),
      dependents: field.dependents.orderBy("position").pluck("label"),
    }))
}

/** Returns the published forms by name with the number of their fields and their labels in order, for a list of forms of a tenant or of the SaaS. */
export async function listFormSummaries(db: DbOf<typeof formsSchema>) {
  return await db.form
    .where({ published: true })
    .orderBy("name", "id")
    .select("id", "name")
    .select(form => ({
      fieldCount: form.fields.count(),
      labels: form.fields.orderBy("position").stringAgg("label", ", ").coalesce(""),
    }))
}

/**
 * Returns the published forms and the forms that have a field with a label, through the `Db` of a tenant or of the SaaS.
 *
 * Each form tells whether it has such a field, and those that have it come first.
 */
export async function listFormsByFieldLabel(db: DbOf<typeof formsSchema>, label: string) {
  return await db.form
    .where(form => or(form.published, hasFieldLabel(form, label)))
    .orderBy(form => desc(hasFieldLabel(form, label)))
    .orderBy("name", "id")
    .select(form => ({
      name: form.name,
      hasField: hasFieldLabel(form, label),
    }))
}

/** Returns the published forms by name with their first `fieldCount` fields, for a list of forms of a tenant or of the SaaS. */
export async function listFormPreviews(db: DbOf<typeof formsSchema>, fieldCount: number) {
  return await db.form
    .where({ published: true })
    .orderBy("name", "id")
    .select("id", "name")
    .select(form => ({
      fields: form.fields.use(selectFormFields).limit(fieldCount),
    }))
}

/** Returns the submissions of a form with the emails of their users through the `Db` of a tenant. */
export async function listSubmissions(db: DbOf<typeof tenantSchema>, formId: string) {
  return await db.submission
    .where({ formId })
    .select("id")
    .select(submission => ({
      user: submission.user.select("id", "email"),
    }))
}

/** Returns a submission for its review through the `Db` of a tenant: its user and reviewer, the fields of its form in their order with their answers and the comments on them, and the comments on the whole submission. */
export async function getSubmissionReview(db: DbOf<typeof tenantSchema>, submissionId: string) {
  return await db.submission.find(submissionId).select(submission => ({
    user: submission.user.get("email"),
    reviewer: submission.reviewer.get("email"),
    fields: db.field
      .where({ formId: submission.formId })
      .orderBy("position")
      .select(field => ({
        label: field.label,
        answer: db.answer
          .findBy({ submissionId: submission.id, fieldId: field.id })
          .optional()
          .select(answer => ({
            value: answer.value,
            comments: answer.comments.orderBy("createdAt").pluck("text"),
          })),
      })),
    comments: submission.comments.where({ fieldId: null }).orderBy("createdAt").pluck("text"),
  }))
}

/** Returns the users of a tenant by email with the numbers of the submissions they filled in and reviewed, and their comments with the answers they are on. */
export async function listUserActivity(db: DbOf<typeof tenantSchema>) {
  return await db.user
    .orderBy("email")
    .select("email")
    .select(user => ({
      submitted: user.submissions.count(),
      reviewed: user.reviews.count(),
      comments: user.comments.orderBy("createdAt").select(comment => ({
        text: comment.text,
        answer: comment.answer.get("value"),
      })),
    }))
}

/**
 * Published forms of a tenant by name with their fields, the number of their submissions, and their latest submissions with the comments on them.
 *
 * Pages of the list call `limit` and `offset` and execute through the `Db` of a tenant.
 */
export const formActivity = tenantSchema.form
  .where({ published: true })
  .orderBy("name", "id")
  .select("id", "name")
  .select(form => ({
    fields: form.fields.orderBy("position").select(field => ({
      label: field.label,
      shownAfter: field.condition.get("label"),
    })),
    submissionCount: form.submissions.count(),
    latestSubmissions: form.submissions
      .orderBy({ createdAt: "desc" })
      .limit(3)
      .select(submission => ({
        user: submission.user.get("email"),
        reviewer: submission.reviewer.get("email"),
        answerCount: submission.answers.count(),
        comments: submission.comments.orderBy("createdAt", "id").select(comment => ({
          author: comment.author.get("email"),
          text: comment.text,
        })),
      })),
  }))

/** `Db` of the form tables for shared code, which the code that runs it provides: the `Db` of a tenant or of the SaaS. */
export const useFormsDb = defineDependency<DbOf<typeof formsSchema>>()

/** Returns the names of the published forms through the `Db` that `useFormsDb` provides. */
export async function getPublishedFormNames() {
  return await useFormsDb().form.where({ published: true }).pluck("name")
}
