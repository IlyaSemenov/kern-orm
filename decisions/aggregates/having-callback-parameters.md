# One callback type of `having`

The callback of `having` has one type of two parameters, the columns and the selected fields, whose second parameter adds about 21 instantiations, 10%, also to a call whose callback reads no field.

```ts
// Chosen: `having(filter: QueryHavingFilter<S>)`
type QueryHavingFilter<S> =
  | WhereCondition<T>
  | ((columns: ColumnRefs<T> & RelationRefs<C>, selected: HavingFields<S>) => WhereCondition<T>)

// Overloads of a callback of one parameter and then of two
having(filter: (columns: ColumnRefs<T> & RelationRefs<C>) => WhereCondition<T>)
having(filter: (columns: ColumnRefs<T> & RelationRefs<C>, selected: HavingFields<S>) => WhereCondition<T>)
```

- The overloads do not avoid the cost: TypeScript gives the parameters of a callback their types from the first overload that it tries, so it leaves both parameters of a callback of two without types, such as `submission` and `selected` of `having((submission, selected) => selected.submissions.gt(1))`.
