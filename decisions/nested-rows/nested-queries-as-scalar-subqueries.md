# Nested queries as scalar subqueries

A nested query is selected as a scalar subquery rather than as a `LATERAL` join.

For a page of forms with their fields:

```ts
const forms = await db.form
  .orderBy("name")
  .limit(20)
  .select("id")
  .select(form => ({
    fields: form.fields.orderBy("position").select("id", "label"),
  }))
```

The compiler builds a scalar subquery of the select list, shown without the packing of the rows:

```sql
SELECT "form"."id" AS "id",
  (SELECT coalesce(json_agg(json_build_array(...) ORDER BY "subquery"."$order1"), '[]'::json) AS "rows"
    FROM (SELECT ... FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id") AS "subquery") AS "fields"
FROM "form" AS "form"
ORDER BY "form"."name"
LIMIT $1
```

A `LATERAL` join, as the benchmark builds it, joins the same subquery to the forms:

```sql
SELECT "form"."id" AS "id", "fields"."rows" AS "fields"
FROM "form" AS "form"
LEFT JOIN LATERAL (SELECT coalesce(json_agg(...), '[]'::json) AS "rows" FROM (...) AS "subquery") AS "fields" ON TRUE
ORDER BY "form"."name"
LIMIT $1
```

- With a limit, PostgreSQL evaluates a scalar subquery of the select list after the sort of the parent and stops once it has the rows of the limit, while it joins a `LATERAL` subquery to every row before them unless an index gives the order.
- On a page of 20 of 1000 parents ordered by a column without an index, the scalar subquery is 38 to 48 times faster, and the two are within 8% for all parents and for a page ordered by an index ([benchmark](../../benchmarks/suites/nested-placement.ts)).
