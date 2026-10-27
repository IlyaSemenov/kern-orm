import { randomUUID } from "node:crypto"

import type { DbOf } from "kern-orm"

import type { formsSchema } from "./schemas"

/**
 * Copies a form of `sourceDb`, such as a template of the SaaS, into `targetDb`, such as the `Db` of a tenant, as an unpublished form with its fields, and returns the ID of the copy.
 *
 * The copy runs in one transaction, which statements of both `Db` join, so it is copied as a whole or not at all.
 */
export async function copyForm(
  sourceDb: DbOf<typeof formsSchema>,
  targetDb: DbOf<typeof formsSchema>,
  formId: string,
): Promise<string> {
  return await targetDb.$transaction(async () => {
    const source = await sourceDb.form
      .find(formId)
      .select("name")
      .select(form => ({
        fields: form.fields.select("id", "position", "label", "conditionFieldId"),
      }))
    const copyId = await targetDb.form.insert({ name: source.name, published: false }).get("id")
    if (source.fields.length > 0) {
      // The copies of the fields get their IDs before the insert, so that a field refers to the copy of the field it is shown after in the same statement.
      const copyIdBySourceId = new Map(source.fields.map(field => [field.id, randomUUID()]))
      await targetDb.field.insertMany(
        source.fields.map(field => ({
          id: copyIdBySourceId.get(field.id)!,
          formId: copyId,
          position: field.position,
          label: field.label,
          conditionFieldId:
            field.conditionFieldId === null ? null : copyIdBySourceId.get(field.conditionFieldId)!,
        })),
      )
    }
    return copyId
  })
}
