# Return type of `columnsOf` kept out of inference

`columnsOf` takes its columns, `"*"` or a list of keys, as a type parameter, and returns the columns of the record of those keys.
Its return type is wrapped in `NoInfer`.

```ts
await db.$query`...`.select({
  form: columnsOf(db.form, "*", { alias: "f" }),
  field: columnsOf(db.field, "*", { alias: "d" }).nullable(),
  total: t.integer,
})
```

A call in a field of `select` has the type of the field as the type that its result is expected to have, and TypeScript infers a type parameter also from the return type against it.
The inference compares the record of the columns with the type of the field even when the argument gives the columns.
`NoInfer` keeps the return type out of the inference, so that only the argument gives the columns.

By the [type benchmarks](../../benchmarks/types/queries.bench.ts), in instantiations:

| Benchmark                                      | `NoInfer` | Plain return type | Two overloads |
| ---------------------------------------------- | --------- | ----------------- | ------------- |
| Query of SQL text of the columns of two tables | 170       | 530               | 634           |
| Columns of a table                             | 49        | 48                | 113           |
| Nullable columns of some columns of a table    | 154       | 153               | 223           |

The alternatives:

- The plain return type reads as the simpler signature and costs a call outside a selection one instantiation less.
  But the query above, which is how the documentation shows the calls, takes 3.1 times the instantiations.
- Two overloads, one of `"*"` and one of a list of keys, each without a conditional type of the columns, read as the simpler signatures.
  But every call costs more than with either signature of one type parameter, also outside a selection, and neither overload takes columns typed as a union of `"*"` and a list, such as `"*" | readonly ["id"]`.
