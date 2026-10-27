// Exports values and functions whose inferred types name types of the package, as a module of a consumer does.
// The package test emits their declarations, which fail, such as with TS4023 or TS4058, when they name a type that the package does not export.
// Each export covers a kind of such code; the type tests of `declaration-consumer/` import some of them to check the emitted types, and nothing uses the others.
import type { DbOf, QueryStateOf, SelectQuery, SelectQueryKind } from "kern-orm"
import { defineHelper, defineSchema, defineTable, many, one } from "kern-orm"
import * as t from "kern-orm/types"

const form = defineTable("form", {
  id: t.uuid.primaryKey(),
  name: t.text.unique(),
})

const field = defineTable(
  "form_field",
  {
    id: t.uuid,
    formId: t.uuid,
  },
  { primaryKey: ["formId", "id"] },
)

/** Schema with relations; see the file header. */
export const schema = defineSchema({ form, field }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
  field: {
    form: one(form, { from: "formId", to: "id" }),
  },
})

/** Selects the names of all forms through a `Db` of the schema or of a schema that includes it; see the file header. */
export function selectNames(db: DbOf<typeof schema>) {
  return db.form.pluck("name")
}

/** Returns `$execute` of a `Db` of the schema, standing for `export const execute = db.$execute` in this module without a `Db`; see the file header. */
export function getExecute(db: DbOf<typeof schema>) {
  return db.$execute
}

/** Helper with an argument; see the file header. */
export const withName = defineHelper(schema.form, (form, id: string) =>
  form.where({ id }).select("name"),
)

/** Helper that returns either the query it receives or one that selects a column; see the file header. */
export const maybeWithName = defineHelper(schema.form, (form, includeName: boolean) =>
  includeName ? form.select("name") : form,
)

/** Helper that selects a value of the records of a relation; see the file header. */
export const withFieldIds = defineHelper(schema.form, form =>
  form.select(columns => ({
    fields: columns.fields.pluck("id"),
  })),
)

/** Query that selects the records of a relation; see the file header. */
export const namesWithFields = schema.form.select("name").select(form => ({
  fields: form.fields.select("id"),
}))

/** Relations of the table of forms that its queries hold; see the file header. */
export const formContext = schema.form.context

/** Selects the name from a record query over forms of any state and kind; see the file header. */
export function selectName<
  S extends QueryStateOf<typeof form> & { readonly value: false },
  Kind extends SelectQueryKind,
>(query: SelectQuery<S, Kind>) {
  return query.select("name")
}

/** Selects the name as a title from a record query over forms of any state and kind; see the file header. */
export function selectNameAsTitle<
  S extends QueryStateOf<typeof form> & { readonly value: false },
  Kind extends SelectQueryKind,
>(query: SelectQuery<S, Kind>) {
  return query.select(form => ({
    title: form.name,
  }))
}
