# Keys of `groupBy` name columns

A string of `groupBy` always names a column, and a query needs no selection to be grouped.

```ts
db.submission.groupBy("formId").count() // the number of the forms with submissions

const labels = db.field.select(field => ({
  label: field.label.lower(),
  total: count(),
}))

labels.groupBy("label") // the column label: "Email" and "email" are two groups
labels.groupBy((field, selected) => selected.label) // the field label: one group
```

```sql
-- labels.groupBy("label")
SELECT lower("form_field"."label") AS "label", count(*) AS "total" FROM "form_field" AS "form_field" GROUP BY "form_field"."label"
-- labels.groupBy((field, selected) => selected.label)
SELECT lower("form_field"."label") AS "label", count(*) AS "total" FROM "form_field" AS "form_field" GROUP BY 1
```

- Orchid ORM `group` takes a selected alias before a column and compiles it to a position, and it requires a selection in types ([source](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/packages/pqb/src/query/sql/to-sql.ts)).
  There, `group("label")` of the same selection groups by the field.
