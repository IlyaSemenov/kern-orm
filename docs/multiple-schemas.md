# Multiple Schemas

When several PostgreSQL schemas contain tables with the same structure, such as a schema per tenant and a shared one, define the tables once and reuse their definitions and queries across schemas.

This page follows a multi-tenant SaaS application:

- Each tenant has its own PostgreSQL schema, such as `tenant_1`, with its users, forms, and the submissions of forms with their answers.
- The shared `saas` PostgreSQL schema keeps the tenants, and the form templates that new tenants start with.

Forms and their fields have the same structure in both places, so they are defined once.

## Tables

Define the tables:

```ts
import { defineTable } from "kern-orm"
import * as t from "kern-orm/types"

export const form = defineTable("form", {
  id: t.uuid.primaryKey(),
  name: t.text,
  published: t.boolean,
})

export const field = defineTable("form_field", {
  id: t.uuid.primaryKey(),
  formId: t.uuid.columnName("form_id"),
  position: t.integer,
  label: t.text,
})

export const user = defineTable("user", {
  id: t.uuid.primaryKey(),
  email: t.text,
})

export const submission = defineTable("form_submission", {
  id: t.uuid.primaryKey(),
  formId: t.uuid.columnName("form_id"),
  userId: t.uuid.columnName("user_id"),
})

export const answer = defineTable("form_answer", {
  id: t.uuid.primaryKey(),
  submissionId: t.uuid.columnName("submission_id"),
  fieldId: t.uuid.columnName("field_id"),
  value: t.text,
})

export const tenant = defineTable("tenant", {
  id: t.uuid.primaryKey(),
  subdomain: t.text,
})
```

## Schemas

Put the common tables and their [relations](./schemas#relations) in `formsSchema`, then include it in the tenant and SaaS schemas next to their own tables and relations:

```ts
import { defineSchema, many, one } from "kern-orm"

export const formsSchema = defineSchema({ form, field }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
  field: {
    form: one(form, { from: "formId", to: "id", required: true }),
  },
})

export const tenantSchema = defineSchema(formsSchema, { user, submission, answer }).$relations({
  field: {
    answers: many(answer, { from: "id", to: "fieldId" }),
  },
  submission: {
    form: one(form, { from: "formId", to: "id", required: true }),
    user: one(user, { from: "userId", to: "id", required: true }),
    answers: many(answer, { from: "id", to: "submissionId" }),
  },
  answer: {
    submission: one(submission, { from: "submissionId", to: "id", required: true }),
    field: one(field, { from: "fieldId", to: "id", required: true }),
  },
})

export const saasSchema = defineSchema(formsSchema, { tenant })
```

`defineSchema` accepts any number of schemas and objects of tables, including schemas that share tables, and includes the relations of the schemas.
Include each table under one key, and use each key for one table.

The tenant schema adds the answers to the relations of the fields, while the SaaS schema has only those of `formsSchema`.
Declare each relation once, in the schema that the others include, such as `formsSchema` for the relations between forms and fields.

Build queries from `formsSchema` to reuse them for both tenant forms and templates, including their [related records](./queries/relations).
Such a query is not bound to a database, and every `Db` whose schema includes its tables and relations executes it with `$execute`:

```ts
export const publishedForms = formsSchema.form
  .where({ published: true })
  .select("id", "name")
  .select(form => ({
    fields: form.fields.select("id", "label"),
  }))
```

Start [other nested queries](./queries/relations#other-queries) from `formsSchema` too.

## Binding

Bind the tenant schema to the PostgreSQL schema of [the current request](./schemas#postgresql-schemas), and the SaaS schema to `saas`:

```ts
export const tenantDb = database.bind(tenantSchema, { schemaName: () => useTenant().schema })
export const saasDb = database.bind(saasSchema, { schemaName: "saas" })

await tenantDb.$execute(publishedForms) // FROM "tenant_1"."form"
await saasDb.$execute(publishedForms) // FROM "saas"."form"
```

Start queries specific to one side from its `Db`:

```ts
const answers = await tenantDb.answer.where({ fieldId }).select("id", "value")
```

A `Db` rejects queries that use tables or relations outside its schema and queries bound to another `Db`, so tenant answers cannot be queried through `saasDb` by mistake.

Both schemas are bound to the same database and share its [transactions](./transactions), so a transaction started through either `Db` also covers the queries of the other.

## Shared code

To run the same code on the tenant and SaaS databases, take the `Db` as a parameter of type `DbOf` of the common schema:

```ts
import type { DbOf } from "kern-orm"

export async function getFieldLabels(db: DbOf<typeof formsSchema>, formId: string) {
  return await db.field.where({ formId }).orderBy("position").pluck("label")
}

await getFieldLabels(tenantDb, formId)
await getFieldLabels(saasDb, formId)
```

The `Db` of every schema that includes `formsSchema` fits, and the code uses only the tables and relations of `formsSchema`.

### Dependency injection

When shared code gets its `Db` from dependency injection rather than from a parameter, type the dependency with `DbOf` of the common schema and provide the `Db` of the side that runs the code, such as with [Ripple DI](https://github.com/IlyaSemenov/ripple-di):

```ts
import { defineDependency, provide, withOverrides } from "ripple-di"

export const useFormsDb = defineDependency<DbOf<typeof formsSchema>>(() => tenantDb)

export async function getFieldLabels(formId: string) {
  return await useFormsDb().field.where({ formId }).orderBy("position").pluck("label")
}

// Runs the same code on the form templates of the SaaS schema.
await withOverrides(provide(useFormsDb, saasDb), () => getFieldLabels(formId))
```
