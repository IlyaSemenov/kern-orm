# Sort keys of packed rows

Packed rows are aggregated in the order of the query by the sort keys of their derived source.

For the fields of each form in order:

```ts
const forms = await db.form.select("id").select(form => ({
  fields: form.fields.orderBy("position").select("id", "label"),
}))
```

The derived source selects the sort key, and the aggregate sorts by it, shown without the packing of the rows:

```sql
SELECT coalesce(json_agg(json_build_array(...) ORDER BY "subquery"."$order1"), '[]'::json) AS "rows"
FROM (SELECT "form_field"."id" AS "id", "form_field"."label" AS "label", "form_field"."position" AS "$order1" FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id") AS "subquery"
```

Numbering the rows instead, as the benchmark does:

```sql
SELECT coalesce(json_agg(json_build_array(...) ORDER BY "subquery"."number"), '[]'::json) AS "rows"
FROM (SELECT row_number() OVER (ORDER BY "form_field"."position") AS "number", "form_field"."id" AS "id", "form_field"."label" AS "label" FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id") AS "subquery"
```

- Numbering would be 8 to 26% slower ([benchmark](../../benchmarks/suites/sort-keys.ts)), and could not sort by a window function, which PostgreSQL rejects in a window definition.
