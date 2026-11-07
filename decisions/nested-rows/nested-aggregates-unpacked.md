# Nested aggregate queries unpacked

A nested aggregate query without a conversion is selected as a scalar subquery of its statement, decoded by the type of the aggregate, rather than packed.

For the number of fields of each form:

```ts
const forms = await db.form.select("id").select(form => ({
  fieldCount: form.fields.count(),
}))
```

The compiler selects the statement of the count:

```sql
SELECT "form"."id" AS "id",
  (SELECT count(*) AS "count" FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id") AS "fieldCount"
FROM "form" AS "form"
```

Packed, as the compiler builds it when `map` converts the count, the field is a JSON array of the text of the count:

```sql
SELECT "form"."id" AS "id",
  (SELECT json_build_array(CASE WHEN "subquery"."count" IS NOT DISTINCT FROM NULL THEN NULL ELSE format('%s', "subquery"."count") END) AS "rows"
    FROM (SELECT count(*) AS "count" FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id" OFFSET 0) AS "subquery") AS "fieldCount"
FROM "form" AS "form"
```

- For a count of 1000 and 10000 parents of 10 rows each, PostgreSQL evaluates it in 20 to 25% less time than the packed number, and the round trips are within their noise ([benchmark](../../benchmarks/suites/nested-count.ts)).
