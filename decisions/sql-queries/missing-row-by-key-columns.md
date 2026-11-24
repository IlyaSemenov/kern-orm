# A missing row told by the key columns

`nullable` of the [columns of a record](../../architecture/sql-queries.md#columns-of-records) makes the record `null` without its row, such as of a table joined with `LEFT JOIN`.
Decoding tells a missing row by the result columns of the key of the record, such as its primary key, being all `NULL`, so the columns must include their key, or `nullable` takes the columns to read in `by`.

```ts
const job = columnsOf(db.job, { alias: "j" }).nullable()

// Columns without the primary key name the columns that are never NULL in a row
const summary = columnsOf(db.job, { alias: "j", columns: ["task", "runAt"] }).nullable({
  by: ["task"],
})
```

The alternatives:

- Adding the columns of the key to the fragment as result columns that the record does not have, when the columns do not include them, would let any columns of a source with a key, such as a table with a primary key, be nullable without `by`.
  But `nullable` would then change the SQL of the columns, so that a statement that interpolates the columns before `nullable` selects without what the selection reads, and the statement would return columns that it does not list.
- Telling a missing row by all the columns of the record being `NULL` needs no key, also for a view.
  But a row whose selected columns are all nullable and `NULL` would read as missing, and decoding would check the columns of a row up to the first that is not `NULL`, every column of a missing row, rather than those of the key.
- Checking the other columns of a missing row, to reject a row whose key is `NULL` beside a value, and the columns that are not nullable of a present row, would catch a statement that the columns do not describe.
  But it adds a check of every column to every row, while the other fields of a query of SQL text decode `NULL` by their type without one; only a key of several columns with some of them `NULL` rejects, which costs nothing for a key of one column.
- Making every field of the record nullable instead of the record needs no way to tell a missing row, but code would check each field of a row that the join guarantees as a whole.
