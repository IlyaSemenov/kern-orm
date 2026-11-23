# Values of the columns of a record told by key

The record of `createSqlColumns` has a property for each key of its columns, required when the list guarantees the key, by the rule of [`select` by keys](../queries/dynamic-column-keys.md).
A list whose type does not tell each column, such as with a spread array or a key that is a union, does not tell which column a key reads either.
The record gives a key the values of every column of the list that names it, and a key of an index signature, `string` or a template, the values of every column, so that types need not compare the names that it may have with the keys of the other columns.

```ts
const id = { key: "id", name: "id", type: t.integer } as const
const extras: (SqlColumn<"id", typeof t.text> | SqlColumn<"name", typeof t.text>)[] = []

createSqlColumns([id, ...extras])
// SqlColumns<{ id: number | string; name?: string }, false>

createSqlColumns([id, { key: slotKey, name: "slot", type: t.text }, meta])
// slotKey: `key${number}`, meta: SqlColumn<"meta">
// SqlColumns<{ [key: `key${number}`]: any; id: number; meta: any }, false>
```

For keys typed as string literals, `string`, or templates, a property is never narrower than the values that the statement returns for it, and the record is `PickSelectedColumns` of one row, the rule that `select` and `columnsOf` share.
A list of columns of single known keys, such as written in the call, has the values of each column under its key.

The alternatives:

- Reading the values of a required key from the column at the position of the list that guarantees it would type `id` of the first call as `number`: `createSqlColumns` rejects a column twice, so `extras` has no column of key `id` when the columns are created.
  But the record would differ from the union only for a list whose type has two columns of one key.
- Giving a key the values of only the columns whose keys overlap its possible names would leave `meta` out of the index signature of the second call, since `` `key${number}` `` cannot name it.
  But names overlap in ways that the comparison must each handle, such as a template with a literal, a member of a string enum with its value, and a branded `string` with any name.

A variant of both, which maps the required keys to their own columns and each other key to the columns that it may name, keeps a rule of its own beside that of `select`, and typed a key that is a member of a string enum beside its value as `never`.
By the [benchmarks of the columns of a builder](../../benchmarks/types/builder.bench.ts), it takes 314 instantiations instead of 287 for a list of four columns written in the call.
For a list of 21 columns chosen at runtime, it takes 446 instead of 588 for the query alone, and 881 instead of 743 once the consumer reads four fields of the record: a query alone leaves the types of the fields to whoever reads them.
