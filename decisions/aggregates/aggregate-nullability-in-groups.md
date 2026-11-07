# Nullability of aggregates in groups

Directly selected, unfiltered aggregates in a query of groups have the nullability of their arguments.
With ordinary expressions as grouping keys, a group has a row, so a non-null argument needs no artificial fallback:

```ts
const positions = await db.field.groupBy("formId").select(field => ({
  formId: field.formId,
  total: sum(field.position), // number
}))
```

Grouping sets such as `()` and `ROLLUP` can return a group without input rows and are outside the contract of `groupBy`.

A marker on an aggregate expression carries its value in a group through `fieldTypes`, `valueType`, and helper effects.
`groupBy` derives its state through an interface, with `aggregate: false & Grouped`, and narrows earlier selections too, since grouping by a selected expression requires `select` first.
With the same implementation otherwise, a mapped `ChangeState<S, { result: GroupedResult<S>; aggregate: false & Grouped }>` requires 36.0% more type instantiations for grouping a column, 20.7% more for `having` an aggregate, and 4.7–12.7% more for the other grouping benchmarks than the interface ([benchmark](../../benchmarks/types/queries.bench.ts)).
Compared with retaining nullable aggregate values, type instantiations increase by 20.6% for grouping a column, 22.4% for grouping a selected field, 34.3% for `having` an aggregate, and 15.3% for `having` a selected field.
Selecting aggregates after grouping adds 7.4%, grouping after selecting them 26.0%, and `pluck` of an aggregate after grouping 8.1%.
Other changed benchmarks add at most 3.4%; these increases are accepted for more precise results.
Deriving a state also means that `groupBy` rejects a union of queries of different states, as other state-changing methods do; conditional reassignment to the original variable still works.

Types do not identify source occurrences, so lowering checks the ownership of directly selected unfiltered aggregates other than counts.
An aggregate of only enclosing sources can return `NULL` despite the inner groups, so it requires explicitly nullable SQL, such as ``sql(t.integer.nullable())`sum(${outer.position})` ``.
This restricts direct aggregate functions for that SQL scenario rather than changing their SQL meaning or giving a false non-null guarantee.
Tracking source identity throughout expression types would avoid the runtime restriction but require a broader model of query scopes and expression dependencies.

Filters and nullable arguments retain `null`, as do operators and functions of an aggregate, which do not carry its group marker.
References of `having` to selected aggregates keep the marker and standalone nullability when reused in other queries.
Kysely instead types `sum` and `avg` without `null` even without groups, and recommends adding it by hand for empty input ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/query-builder/function-module.ts#L216)).
