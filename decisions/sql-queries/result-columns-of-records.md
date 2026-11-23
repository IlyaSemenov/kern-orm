# Result columns of a record named by its fragment

The [columns of a record](../../architecture/sql-queries.md#columns-of-records) are a fragment that selects each column under the name of a result column of its own, the key of the column after the prefix of the columns, which is their alias by default, and `select` reads the record from the result columns of these names.

```ts
const job = columnsOf(db.job, { alias: "j" })

await db.$query`
  UPDATE ${db.job} j SET locked_by = ${worker} WHERE j.id = ${jobId}
  RETURNING ${job}
`.select({
  job,
})
```

```sql
-- Chosen: the fragment names the result columns
UPDATE "job" j SET locked_by = $1 WHERE j.id = $2
RETURNING "j"."id" AS "j__id", "j"."run_at" AS "j__runAt"

-- By the names of the columns of the table: the statement selects them itself
UPDATE "job" j SET locked_by = $1 WHERE j.id = $2
RETURNING j.*
```

The alternatives:

- Reading the record from the result columns of the physical names of its columns, such as `run_at`, needs no fragment in the statement, which may return `j.*`, and a statement written without kern-orm decodes as it is.
  But the columns of two tables of one statement that share a name, such as `id`, cannot be told apart in the result of a join, so the statement would have to rename them by hand.
- Reading the record by the positions of its columns in the result needs no names, but a statement that returns them in another order, or between other columns, decodes values of one type as those of another silently, which [reading by names](../../architecture/sql-queries.md#results) rules out for every field.
- Naming the result columns by the key of the field of `select`, such as `claimed__id` for `claimed: job`, would need no prefix.
  But the fragment would have no SQL of its own for `text`, and one fragment could not be read under different keys, such as `job` and `claimed` of two selections of one statement.
- A prefix only from its option, rather than the alias by default, names the result columns of a table with an alias by their keys alone, which a statement around it reads more easily, such as of a `WITH` query.
  But a join of tables whose result columns would have one name, such as of keys that the tables share, would need a prefix written in the call, which the alias by default spares a usual join.
