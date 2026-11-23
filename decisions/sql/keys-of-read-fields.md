# Keys of fields read by a read expression

A query selects a field of a type with a [read expression](../types/read-expression-of-a-type.md) by the expression, so the projection of the field has the result of the expression rather than the value.
An executed query sorts and groups by the value itself: by the column, which it repeats, or through a derived source of the values when a clause can take the value only from its projection.

```ts
await db.job.select("id", "runAt").orderBy("runAt")
await db.job
  .groupBy("queueId")
  .select(job => ({
    queueId: job.queueId,
    last: max(job.runAt),
  }))
  .orderBy((job, selected) => selected.last)
```

```sql
SELECT "job"."id" AS "id", extract(epoch from "job"."runAt") AS "runAt"
FROM "job" AS "job" ORDER BY "job"."runAt"

SELECT "subquery"."queueId" AS "queueId", extract(epoch from "subquery"."last") AS "last"
FROM (
  SELECT "job"."queueId" AS "queueId", max("job"."runAt") AS "last"
  FROM "job" AS "job" GROUP BY 1
) AS "subquery"
ORDER BY "subquery"."last"
```

The derived source serves a query of `distinct` with such a field, and a sort key, a key of `GROUP BY`, or a key of `DISTINCT ON` that is the selected expression of such a field other than a column.

The alternatives:

- Sorting and grouping by the position of the field, as for any other field, would keep one statement without a derived source.
  But the order and the groups would be those of the result of the expression, which only an expression that keeps the order and the equality of the values, such as the seconds of a timestamp, leaves as they are: the text of GeoJSON sorts as text, and an expression that rounds merges different values.
- Repeating the selected expression in `ORDER BY`, `GROUP BY`, or `DISTINCT ON` would also need no derived source.
  But PostgreSQL would evaluate it again, with parameters of its own other than of casts, so that a volatile expression sorts by another value than the query returns, and PostgreSQL rejects such a key of `GROUP BY` or `DISTINCT ON` as different from the selected expression; `SELECT DISTINCT` takes a sort key only from its select list.
- Rejecting such a query, with an error that names the clause, would cost no code of a derived source.
  But sorting groups by a selected aggregate of such a column, such as the latest time of each queue, is an ordinary query, which would fail only for a type with a read expression.
- Reading every query with such a field from a derived source would need no rule of which clauses take the value.
  But the common query, which selects and sorts by a column, would pay for a derived source that it does not need.
