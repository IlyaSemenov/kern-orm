# No guaranteed order of the rows of `insertMany`

`insertMany` does not promise the order of the rows it returns, so matching them to its records requires a key.

```ts
// The fields of one form, each at a position of its own
const fields = await db.field
  .insertMany(labels.map((label, position) => ({ formId, position, label })))
  .select("id", "position")

// Chosen: by a column whose values are unique among the records
const idByPosition = new Map(fields.map(field => [field.position, field.id]))
// By array position, which is not promised: the field for `labels[0]`
const firstId = fields[0].id
```

- PostgreSQL returns the rows of `INSERT ... VALUES` in the order of `VALUES`, but does not document it, and Tom Lane declined to guarantee it: "the current implementation happens to act like that, but there is no reason that we should make it guaranteed behavior" ([pgsql-hackers](https://www.postgresql.org/message-id/19445.1350482182%40sss.pgh.pa.us)).
- Django relies on it: `bulk_create` pairs the returned rows with its objects by position ([`django/db/models/query.py`](https://github.com/django/django/blob/6.0.10/django/db/models/query.py#L824)).
