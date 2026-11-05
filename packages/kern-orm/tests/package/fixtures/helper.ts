// Exports values and functions whose inferred types name types of the package, as a module of a consumer does.
// The package test emits their declarations, which fail, such as with TS4023 or TS4058, when they name a type that the package does not export.
// Each export covers a kind of such code; the type tests of `declaration-consumer/` import some of them to check the emitted types, and nothing uses the others.
import type { DbOf, QueryStateOf, SelectQuery, SelectQueryKind } from "kern-orm"
import {
  caseWhen,
  coalesce,
  defineExpression,
  defineHelper,
  defineSchema,
  defineTable,
  greatest,
  literal,
  many,
  matches,
  one,
  param,
} from "kern-orm"
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
    form: one(form, { from: "formId", to: "id", required: true }),
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

/** Returns `$select` of a `Db` of the schema, standing for `export const select = db.$select` in this module without a `Db`; see the file header. */
export function getSelect(db: DbOf<typeof schema>) {
  return db.$select
}

/** Expression of `length`, whose type names the operators of numbers; see the file header. */
export const nameLength = param(t.text, "name").length()

/** Expression of `trim`, whose type names the operators of text; see the file header. */
export const trimmedName = param(t.text, "name").trim()

/** Table with columns of the shared `integer` and `text` types; see the file header. */
export const counter = defineTable("counter", {
  label: t.text,
  value: t.integer,
})

/** Selects computed values from a column, a relation aggregate, and a condition; see the file header. */
export const selectComputedValues = schema.form.select(form => ({
  name: coalesce(form.name, ""),
  fieldCount: greatest(form.fields.count(), 1),
  weight: caseWhen(t.integer, [[form.fields.exists(), 1]], 0),
}))

/** Selects a column or a literal by a flag; see the file header. */
export function selectNameOrLiteral(withName: boolean) {
  return schema.form.select(form => ({
    name: withName ? form.name : literal(null),
  }))
}

/** Value of a function of a query, as an expression; see the file header. */
export const fallbackName = coalesce(schema.form.take().get("name"), "")

/** Selects the names of all forms and the forms with their fields in one statement through a `Db` of the schema; see the file header. */
export function selectFormPage(db: DbOf<typeof schema>) {
  return db.$select({
    names: db.form.pluck("name"),
    forms: namesWithFields,
  })
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

/** Expression with an argument that reads a relation; see the file header. */
export const hasFieldId = defineExpression(schema.form, (form, id: string) =>
  form.fields.where({ id }).exists(),
)

/** Expression of an object of column values; see the file header. */
export const isNamed = defineExpression(schema.form, (form, name: string) =>
  matches(form, { name }),
)

/** Query of a value of the records of a relation of each form; see the file header. */
export const fieldCounts = schema.form.pluck(form => form.fields.count())

/** Query of an aggregate of a value of the records of a relation; see the file header. */
export const largestFieldCount = schema.form.max(form => form.fields.count())

/** Renames a form after the largest ID of its fields; see the file header. */
export function renameFromField(id: string) {
  return schema.form.find(id).update(form => ({
    name: coalesce(form.fields.max("id"), "Empty"),
  }))
}

/** Query that selects the records of a relation; see the file header. */
export const namesWithFields = schema.form.select("name").select(form => ({
  fields: form.fields.select("id"),
}))

/** Query of `$select` of a value of each form and of the records of a relation; see the file header. */
export const formPage = schema.$select({
  names: schema.form.pluck("name"),
  forms: namesWithFields,
})

/** Renames a form and returns its fields after the update; see the file header. */
export function renameForm(id: string, name: string) {
  return schema.form.find(id).update({ name }).select("id", "name")
}

/** Inserts a form and returns its ID; see the file header. */
export function insertForm(name: string) {
  return schema.form.insert({ id: "form-id", name }).get("id")
}

/** Deletes the forms of a name and returns the records of a relation of each; see the file header. */
export const deleteFormsWithFields = schema.form
  .where({ name: "Draft" })
  .delete()
  .select(form => ({
    fields: form.fields.pluck("id"),
  }))

/** Methods of a query that changes rows, standing for `export const select = mutation.select` and the like; see the file header. */
export const mutationMethods = {
  select: deleteFormsWithFields.select,
  get: schema.form.find("form-id").delete().get,
  pluck: deleteFormsWithFields.pluck,
  toSQL: deleteFormsWithFields.toSQL,
}

/** Upserts a form by SQL text and returns its record through a `Db` of the schema; see the file header. */
export function upsertForm(db: DbOf<typeof schema>, name: string) {
  return db.$query`INSERT INTO ${db.form} (name) VALUES (${name}) ON CONFLICT (name) DO NOTHING RETURNING id, name`
    .select({
      id: t.uuid,
      name: t.text,
    })
    .take()
    .optional()
}

/** Methods of a query of SQL text, standing for `export const select = query.select` and the like; see the file header. */
export function getSqlQueryMethods(db: DbOf<typeof schema>) {
  const query = db.$query`SELECT name FROM ${db.form}`
  return {
    select: query.select,
    get: query.get,
    pluck: query.pluck,
    take: query.take,
    optional: query.select({ name: t.text }).take().optional,
    nullable: query.select({ name: t.text }).take().nullable,
    toSQL: query.toSQL,
  }
}

/** Relations of the table of forms that its queries hold; see the file header. */
export const formContext = schema.form.context

/** Methods of a query, standing for `export const take = query.take` and the like; see the file header. */
export const formMethods = {
  where: schema.form.where,
  select: schema.form.select,
  clearSelect: schema.form.clearSelect,
  take: schema.form.take,
  find: schema.form.find,
  findBy: schema.form.findBy,
  get: schema.form.get,
  pluck: schema.form.pluck,
  orderBy: schema.form.orderBy,
  limit: schema.form.limit,
  offset: schema.form.offset,
  optional: schema.form.optional,
  nullable: schema.form.nullable,
  required: schema.form.required,
  use: schema.form.use,
  insert: schema.form.insert,
  insertMany: schema.form.insertMany,
  update: schema.form.update,
  delete: schema.form.delete,
  all: schema.form.all,
  toSQL: schema.form.toSQL,
}

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

/** Replaces the fields of a query over forms of any state and kind with the expression of the name; see the file header. */
export function pluckName<
  S extends QueryStateOf<typeof form> & { readonly aggregate: false },
  Kind extends SelectQueryKind,
>(query: SelectQuery<S, Kind>) {
  return query.pluck(form => form.name)
}

/** Selects the name with a helper from a record query over forms of any state and kind; see the file header. */
export function selectNameWithHelper<
  S extends QueryStateOf<typeof form> & { readonly value: false },
  Kind extends SelectQueryKind,
>(query: SelectQuery<S, Kind>, id: string) {
  return query.use(withName, id)
}
