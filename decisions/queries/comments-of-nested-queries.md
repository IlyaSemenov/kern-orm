# Comments of nested queries left out

Only the query that runs a statement writes its comment; the comment of a query nested in it is left out.

```ts
const owners = db.field.comment("fields:owners").pluck("formId")

await owners
// /* fields:owners */ SELECT "form_field"."form_id" AS "formId" FROM "form_field" AS "form_field"

await db.form.where(form => form.id.in(owners)).comment("forms:with-fields")
// Chosen: the comment of the nested query is left out
// /* forms:with-fields */ SELECT FROM "form" AS "form" WHERE "form"."id" IN (SELECT "form_field"."form_id" AS "formId" FROM "form_field" AS "form_field")
// Alternative: the comment is written before the subquery
// /* forms:with-fields */ SELECT FROM "form" AS "form" WHERE "form"."id" IN (/* fields:owners */ SELECT "form_field"."form_id" AS "formId" FROM "form_field" AS "form_field")
```

A query with a comment can be nested as any other, such as a query of a library that labels its statements, and the label of a statement names the operation that runs it.

- Writing the comment before the subquery would show where each part of the statement comes from, in the text that `pg_stat_activity` and the log show.
  It gives the compiler a comment at each place that it compiles a query, among them a packed query and the derived sources of its rows, and `pg_stat_activity` truncates the text, so the labels of subqueries at its end may not show.
- Rejecting a nested query with a comment, when lowering finds it, would tell at once that the comment does not reach the statement.
  It rejects a query that labels its statement wherever it is nested, so a caller that nests the query of a library must remove its comment with `comment(null)` first.
