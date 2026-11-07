# `OFFSET 0` only on sources of scalar expressions

A derived source of packed rows that selects scalar expressions other than table columns gets `OFFSET 0`, and a source of table columns has no barrier.

For the labels of the fields of each form, as they are and in upper case:

```ts
const forms = await db.form.select("id").select(form => ({
  labels: form.fields.select("id", "label"),
  upperLabels: form.fields.select(field => ({
    label: field.label.upper(),
  })),
}))
```

The compiler reads the columns of `labels` from a source without the barrier, and the expression of `upperLabels` from a source with it, whose value packing reads twice:

```sql
-- labels
FROM (SELECT "form_field"."id" AS "id", "form_field"."label" AS "label" FROM "form_field" AS "form_field" WHERE "form_field"."form_id" = "form"."id") AS "subquery"

-- upperLabels
SELECT coalesce(json_agg(json_build_array(CASE WHEN "subquery_2"."label" IS NOT DISTINCT FROM NULL THEN NULL ELSE format('%s', "subquery_2"."label") END)), '[]'::json) AS "rows"
FROM (SELECT upper("form_field_2"."label") AS "label" FROM "form_field" AS "form_field_2" WHERE "form_field_2"."form_id" = "form"."id" OFFSET 0) AS "subquery_2"
```

Without the barrier, PostgreSQL can merge the source into the aggregating query and evaluate the expression at both places.

- A barrier on a source of table columns would add up to 8% there; with `md5` of each column instead, the barrier makes the query 38 to 45% faster ([benchmark](../../benchmarks/suites/offset-barrier.ts)).
