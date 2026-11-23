# Return type of `columnsOf` kept out of inference

`columnsOf` takes the keys of its `columns` option as a type parameter, which is `never` without the option, and returns the columns of the record of those keys.
Its return type is wrapped in `NoInfer`.

```ts
await db.$query`...`.select({
  form: columnsOf(db.form, { alias: "f" }),
  field: columnsOf(db.field, { alias: "d" }).nullable(),
  total: t.integer,
})
```

A call in a field of `select` has the type of the field as the type that its result is expected to have, and TypeScript infers a type parameter also from the return type against it.
A call without `columns` gives the keys no other source, so the inference computes the record of every column of the table as a list of keys.
`NoInfer` keeps the return type out of the inference, so that the keys stay `never`, which stands for every column.

By the [type benchmarks](../../benchmarks/types/queries.bench.ts), in instantiations:

| Benchmark                                      | `NoInfer` | Plain return type | Two overloads |
| ---------------------------------------------- | --------- | ----------------- | ------------- |
| Query of SQL text of the columns of two tables | 174       | 492               | 636           |
| Columns of a table                             | 51        | 50                | 114           |
| Nullable columns of some columns of a table    | 154       | 153               | 233           |

The alternatives:

- The plain return type reads as the simpler signature and costs a call outside a selection one instantiation less.
  But the query above, which is how the documentation shows the calls, takes 2.8 times the instantiations.
- Two overloads, one without the `columns` option and one that requires it, give the keys a source in every call, so that neither needs `NoInfer`.
  But every call costs more than with either signature of one type parameter, also outside a selection.
