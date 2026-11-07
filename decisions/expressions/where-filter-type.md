# Filter of `where` as a conditional type

`where` takes its filter as `QueryWhereFilter`, a conditional type of the state of the query, so that the callback types a literal that it returns by its column, such as of an enum:

```ts
const form = defineTable("form", {
  id: t.uuid.primaryKey(),
  status: t.enum("form_status", ["draft", "live"]),
})

db.form.where(() => ({ status: "live" }))
```

A plain `WhereFilter<S["table"], S["schema"]>` leaves `S` unresolved in the body of the callback, which widens `"live"` to `string`.
`QueryWhereFilter` is the filter of both overloads of `where`:

```ts
// Keeps the state of a query whose row no relation guarantees
where<Q extends QueryOf<UnguaranteedQueryState>>(this: Q, filter: QueryWhereFilter<Q["types"]>): Q
// Changes the state, such as of a query of a required relation
where<S extends SelectQueryState, Kind extends SelectQueryKind>(
  this: SelectQuery<S, Kind>,
  filter: QueryWhereFilter<S>,
): SelectQuery<FilteredState<S>, Kind>

type QueryWhereFilter<S extends SelectQueryState> = [S] extends [unknown]
  ? WhereFilter<S["table"], S["schema"]>
  : never
```

- `QueryWhereFilter` adds about 8 instantiations to a filter, which is 2% to 4%, and up to about 4% to the first query or helper of a table ([benchmark](../../benchmarks/types/queries.bench.ts)).
- A general alias that takes the filter as an argument, rather than reading it only in the branch of `QueryWhereFilter`, resolves it on every call, which takes about 25 more instantiations.
- A type parameter of the filter, as of the callback of `update`, would type the body too, but gives `or` and `and` passed as the filter, without a callback, no columns to infer their objects from:

  ```ts
  db.form.where(or({ status: "live" }, { status: "draft" }))
  // With `filter: F` of `F extends WhereFilter<S["table"], S["schema"]>`, TypeScript 7.1 reports:
  //   Object literal may only specify known properties, and 'status' does not exist in type 'ConditionOperand<never, boolean>'.
  ```

- On a query that the overload that keeps its state rejects, such as of a required relation or of a helper, a literal of an object that a callback without parameters returns requires an object or a callback with a parameter:

  ```ts
  db.field.select(field => ({
    form: field.form.where(() => ({ status: "live" })), // rejected: "live" widens to string
  }))
  db.field.select(field => ({
    form: field.form.where({ status: "live" }),
  }))
  ```

  The checks of the state that would type it lose the type of the query in a function generic over it, such as of a query of any state, or take more than the case is worth:
  - A conditional type of `this` stays unresolved in such a function, which then takes the overload that changes the state.
  - An intersection of `this` with an interface of the state rejects a query of any state in the first pass of overload resolution, which compares by subtypes.
  - An intersection of `this` with a whole query takes about 200 more instantiations for each query.
  - The overload that changes the state, placed first and guarded by the state, rejects a function generic over the state of its query and adds about 208 instantiations to a query.
  - A further overload of concrete queries before the one of the constraint types every form and keeps generic functions, but takes about 27% more instantiations for a filter of a value of a query and 16% for a filter of a required relation, and shows in declarations and editors.
