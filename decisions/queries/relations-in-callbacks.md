# Relations in the references of callbacks

The references of the callbacks of a query, such as of `where`, `orderBy`, `get`, `pluck`, the aggregate methods, and `update`, have the relations of its table beside its columns, so that a callback reads related records:

```ts
db.form.where(form => form.fields.count().expr().gt(3))
```

- The relations add about 35 instantiations to a call of `where` with a callback on a query of a table with relations, 19% of a query of `where` of a callback and `pluck`, about 30 to a call of `orderBy` with a callback, 22% of a query of `orderBy` of a callback and `pluck`, about 32 to `get`, `pluck`, and an aggregate method with a callback, 12% to 23% of such a query, and about 35 to `update` with a callback, 13% of a query of `find` and `update` ([benchmark](../../benchmarks/types/queries.bench.ts)).
- References of the columns alone would spare this cost, and callbacks would not read related records.
