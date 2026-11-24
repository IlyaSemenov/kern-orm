# Column keys typed as string literals

The keys of columns that `select` of a query or a mutation, the list of keys of `columnsOf`, and `createSqlColumns` take must be typed as string literals, `string`, or templates.
A key typed as a member of a string enum is not told as the column of its value: TypeScript keeps the member and its value apart as keys of a type, so that `Pick<Row, Column.Id | "id">` has no property.

```ts
enum Column {
  Id = "id",
  Tag = "tag",
}

db.job.select(Column.Id, Column.Tag)
// { id: number; tag: string }[]

db.job.select(column, key)
// column: Column, key: "id" | "note"
// { tag?: string; note?: string }[], without id

db.job.select(Column.Id, "id")
// {}[]

db.job.select(() => ({ id: sql(t.text)`'x'` })).select(Column.Id)
// { id: never }[]

columnsOf(db.job, [Column.Id])
// SqlColumns<{ id: number }, false>, although the columns include the primary key
```

A member selects its field when no key of the selection, and no field selected before, has its value.

The alternatives:

- Naming each field of a selection by the name of its key, `${Key}`, in the mapped type that picks the fields, would give every selection above its field `id`, of the type of the column.
  But every selection by keys pays for it: by the [type benchmarks](../../benchmarks/types/queries.bench.ts), `select` of two column keys takes 311 instantiations instead of 267 (+16.5%), `update` 561 instead of 517 (+8.5%), and the first unbound query 2714 instead of 2632 (+3.1%).
  The primary key of `columnsOf` needs a change of its own beside it.
- Naming the fields by the names of their keys only for a list that does not guarantee each key costs a list of fixed keys nothing.
  But it leaves `select(Column.Id, "id")`, the replaced field, and the primary key as they are, so that a member is the column of its value in some selections and not in others.
