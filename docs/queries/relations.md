# Related Records

To load the related records of each row, such as the fields of each form, select the [relation](../schemas#relations) in the callback of `select`:

```ts
const forms = await db.form.select("id").select(form => ({
  fields: form.fields.select("id", "label"),
}))
// forms: { id: string; fields: { id: string; label: string }[] }[]
```

The query runs as one SQL statement, and a form without fields gets an empty array.

The callback receives the relations of the table beside its columns.
A relation gives a query of the related records of the row, which you refine like any query:

```ts
const forms = await db.form.select("id").select(form => ({
  nameLabels: form.fields.where(field => field.label.ilike("%name%")).pluck("label"),
}))
// forms: { id: string; nameLabels: string[] }[]
```

The query of a relation has the relations of its own table, so related records nest at any depth, such as the answers to each field:

```ts
const forms = await db.form.select("id").select(form => ({
  fields: form.fields.select("label").select(field => ({
    answers: field.answers.pluck("value"),
  })),
}))
// forms: { id: string; fields: { label: string; answers: string[] }[] }[]
```

To get one related record instead of an array, call `take`; when the record may be missing, add `nullable` to get `null` instead, or `optional` to get `undefined`, as for [one row](./selecting#one-row):

```ts
const forms = await db.form.select("id").select(form => ({
  emailField: form.fields.where({ label: "Email" }).select("id").take().nullable(),
}))
// forms: { id: string; emailField: { id: string } | null }[]
```

To load the related record of a relation declared with `one`, such as the form of each field, select the relation the same way; it gives the record instead of an array:

```ts
const fields = await db.field.select("id").select(field => ({
  form: field.form.select("id", "name"),
}))
// fields: { id: string; form: { id: string; name: string } }[]
```

Without the related record, a [required relation](../schemas#relations) makes the query reject, and a relation that is not required gives `null`.
Add `optional` to get `undefined` instead, or `nullable` to get `null` from a required relation.

`get` gives a value of the related record, such as `field.form.get("name")`, and rejects without the record unless you add `optional`, as for [one value](./selecting#one-value).

## Sorting and pagination

To load related records in order, such as the fields of each form by position, call [`orderBy`](./sorting) on the relation; `limit` and `offset` then apply to the records of each row:

```ts
const forms = await db.form.select("id").select(form => ({
  fields: form.fields.orderBy("position").select("id", "label"),
  firstLabels: form.fields.orderBy("position").limit(3).pluck("label"),
}))
// forms: { id: string; fields: { id: string; label: string }[]; firstLabels: string[] }[]
```

Each form gets all its fields in order and the labels of its first three fields.

## Helpers

To reuse a selection of related records, define a [helper](./composing#helpers):

```ts
import { defineHelper } from "kern-orm"

const withFields = defineHelper(db.form, form =>
  form.select(columns => ({
    fields: columns.fields.select("id", "label"),
  })),
)

const forms = await db.form.select("id").use(withFields)
```

Such a helper also applies to queries of other Dbs whose schemas have these relations, such as the tenant and SaaS Dbs of [shared code](../multiple-schemas#shared-code).

## Other queries

A field can also hold the rows of another query, such as the submissions of each form when the schema relates only a submission to its form:

```ts
const forms = await db.form.select("id").select(form => ({
  submissions: db.submission.where(submission => submission.formId.eq(form.id)).select("id"),
}))
// forms: { id: string; submissions: { id: string }[] }[]
```

Start such a query from the same `Db` as the query that selects it.
