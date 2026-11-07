# The `valueType` part of the state

The `valueType` part holds the input values and the operators of the value of a query as one object, typed as `unknown` by `SelectQueryState` and narrowed only by the states of `expr` and `coalesce`:

```ts
interface SelectQueryState extends QueryState {
  // …
  readonly valueType: unknown
}

// The part of a query of a column, such as of `pluck` or `max`
type ColumnValueType<T extends AnyTable, K extends keyof T["columns"]> = {
  readonly input: ColumnValues<T>[K]
  readonly operators: ColumnOperators<T, K>
}

// The state of `expr`
interface ExpressionQueryState extends ScalarQueryState {
  readonly valueType: QueryValueType
}

// The state of `coalesce`
type CoalesceQueryState = ValueQueryState & {
  readonly valueType: { readonly input: unknown }
}
```

These choices limit the cost of a query that does not call `expr` ([benchmark](../../benchmarks/types/queries.bench.ts)):

- Separate parts of the input and the operators add about 11% to an aggregate of a column and 2.5% to an unbound query:

  ```ts
  interface SelectQueryState extends QueryState {
    readonly valueInput: unknown
    readonly valueOperators: unknown
  }
  ```

- A part narrowed by `SelectQueryState` adds about 3% to `find`, and one narrowed by `ScalarQuery` about 8% to a comparison with an aggregate of a relation:

  ```ts
  interface SelectQueryState extends QueryState {
    readonly valueType: QueryValueType
  }
  ```

- With these choices, an aggregate of a column takes about 3% more than without the part, and an aggregate with a fallback about 4% more.
