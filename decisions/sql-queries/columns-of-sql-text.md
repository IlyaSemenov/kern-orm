# Columns of SQL text checked after the statement

A query of SQL text reads its fields from the result columns of their keys after the statement runs, and decodes the text of each value by the type of its field.

```ts
// Rejects with `ResultDecodeError` after the update, since the statement returns no column `published`
await db.$query`
  UPDATE ${db.form} SET published = true WHERE id = ${formId}
  RETURNING id, name
`.select({
  id: t.uuid,
  name: t.text,
  published: t.boolean,
})
```

```sql
-- Chosen: the statement as it is written
UPDATE "form" SET published = true WHERE id = $1
RETURNING id, name

-- Wrapped: PostgreSQL rejects q."published" before the update runs
WITH q AS (
  UPDATE "form" SET published = true WHERE id = $1
  RETURNING id, name
)
SELECT q."id", q."name", q."published" FROM q
```

- Wrapping the statement would let PostgreSQL check the columns before the statement runs, but it would rewrite the SQL of users and reject statements that `WITH` does not take, such as `EXPLAIN` and `SHOW`.
