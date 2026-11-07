# Pages and first rows from derived sources

A query that selects nested queries reads its page after an offset, and its first rows of `distinctOn`, from a derived source, so that its nested queries run only for those rows.

For a page of forms after an offset:

```ts
const forms = await db.form
  .orderBy("name")
  .limit(20)
  .offset(900)
  .select("id")
  .select(form => ({
    fields: form.fields.orderBy("position").select("id", "label"),
  }))
```

The compiler reads the page from a derived source and sorts it again, shown without the nested query:

```sql
SELECT "form"."id" AS "id", (SELECT ... WHERE "form_field"."form_id" = "form"."id" ...) AS "fields"
FROM (SELECT "form_2"."id" AS "id", "form_2"."name" AS "$order1" FROM "form" AS "form_2" ORDER BY 2 LIMIT $1 OFFSET $2) AS "form"
ORDER BY "form"."$order1"
```

On the table, the query would be:

```sql
SELECT "form"."id" AS "id", (SELECT ... WHERE "form_field"."form_id" = "form"."id" ...) AS "fields"
FROM "form" AS "form"
ORDER BY "form"."name"
LIMIT $1 OFFSET $2
```

For the field of each form with the largest position, with the name of its form:

```ts
const fields = await db.field
  .distinctOn("formId")
  .orderBy("formId", { position: "desc" })
  .select("id")
  .select(field => ({
    form: field.form.select("name"),
  }))
```

The compiler reads the first rows from a derived source that applies `DISTINCT ON`:

```sql
SELECT "form_field"."id" AS "id", (SELECT ... WHERE "form"."id" = "form_field"."formId") AS "form"
FROM (SELECT DISTINCT ON (2) "form_field_2"."id" AS "id", "form_field_2"."form_id" AS "formId", "form_field_2"."position" AS "$order2" FROM "form_field" AS "form_field_2" ORDER BY 2, 3 DESC) AS "form_field"
ORDER BY "form_field"."formId", "form_field"."$order2" DESC
```

On the table, the query would be:

```sql
SELECT DISTINCT ON ("form_field"."form_id") "form_field"."id" AS "id", (SELECT ... WHERE "form"."id" = "form_field"."form_id") AS "form"
FROM "form_field" AS "form_field"
ORDER BY "form_field"."form_id", "form_field"."position" DESC
```

Reading them on the table evaluates the nested queries for the rows that the offset skips and for the rows of a group after its first:

- For a page of 20 of 1000 parents, the source is 4 to 6 times faster after an offset of 100 and 26 to 45 times after 900, and within 4% after an offset of 0 ([benchmark](../../benchmarks/suites/offset-page.ts)).
- For a page of 20 of 1000 groups of 10 rows, it is 1.8 to 3.8 times faster after an offset of 100 and 8 to 26 times after 900, and within 3% after an offset of 0 ([benchmark](../../benchmarks/suites/group-page.ts)).
- For the first rows of 1000 parents with nested rows of 3 to 30 fields, it is 7.7 to 10.6 times faster for groups of 10 parents and 26 to 48 times for groups of 50, 1.3 to 1.7 times faster for a page of 10 after an offset of 10, and within the noise for a page of 10 without an offset, whose select list PostgreSQL evaluates only for the rows of the limit anyway ([benchmark](../../benchmarks/suites/distinct-on.ts)).
- For 1000 groups of `GROUP BY` of 10 rows each and 100 keys of `DISTINCT ON` of 10 groups each, it is 5.5 to 9.5 times faster for the first groups of all keys, 1.1 to 1.4 times faster for a page of 10 after an offset of 10, and within 2% for a page of 10 without an offset ([benchmark](../../benchmarks/suites/group-page.ts)).
