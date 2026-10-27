import type { DbOf } from "kern-orm"
import { defineHelper } from "kern-orm"
import { defineDependency } from "ripple-di"

import type { tenantSchema } from "./schemas"
import { formsSchema } from "./schemas"

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

/** Returns a form with its fields through the `Db` of a tenant or of the SaaS. */
export async function getForm(db: DbOf<typeof formsSchema>, formId: string) {
  return await db.form.find(formId).use(selectForm)
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

/** `Db` of the form tables for shared code, which the code that runs it provides: the `Db` of a tenant or of the SaaS. */
export const useFormsDb = defineDependency<DbOf<typeof formsSchema>>()

/** Returns the names of the published forms through the `Db` that `useFormsDb` provides. */
export async function getPublishedFormNames() {
  return await useFormsDb().form.where({ published: true }).pluck("name")
}
