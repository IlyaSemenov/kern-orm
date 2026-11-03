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

Without the related record, a [required relation](../schemas#relations) makes the query reject with `RequiredRelationError`, and a relation that is not required gives `null`.
Add `optional` to get `undefined` instead, or `nullable` to get `null` from a required relation.

To get the related record only when it matches a filter, such as the form of each field only when it is published, call `where` on the relation; a required relation then gives `null` without a matching record:

```ts
const fields = await db.field.select("id").select(field => ({
  publishedForm: field.form.where({ published: true }).select("name"),
}))
// fields: { id: string; publishedForm: { name: string } | null }[]
```

Add `required` to make such a query reject without a matching record instead.

`get` gives a value of the related record, such as `field.form.get("name")`.
Without the record, it gives `undefined` for a relation that is not required or after a filter, and rejects for a required relation unless you add `optional`, as for [one value](./selecting#one-value).

## Aggregates of related records

To get the number of the related records of each row, such as the number of fields of each form, or [another aggregate](./selecting#aggregates) of them, select it on the relation:

```ts
const forms = await db.form.select("id").select(form => ({
  fieldCount: form.fields.count(),
  lastPosition: form.fields.max("position"),
}))
// forms: { id: string; fieldCount: number; lastPosition: number | null }[]
```

To get a value instead of `null` for a row without related records, pass it to [`coalesce`](./selecting#aggregates), such as `form.fields.max("position").coalesce(0)`; it also takes an expression, such as a column of the row.

## Whether related records exist

To tell whether each row has related records, such as whether each form has fields, select [`exists`](./selecting#whether-rows-exist) of the relation:

```ts
const forms = await db.form.select("id").select(form => ({
  hasFields: form.fields.exists(),
  hasEmail: form.fields.where({ label: "Email" }).exists(),
}))
// forms: { id: string; hasFields: boolean; hasEmail: boolean }[]
```

To load only the rows that have related records, pass `exists` to `where`, as [Filtering](./filtering#related-records) describes.

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
