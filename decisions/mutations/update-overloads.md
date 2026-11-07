# Overloads of `update`

`update` has an overload that infers the type of a callback for the relations of its values, and then one of a value of `UpdateSet`.

```ts
// Chosen
update<F extends (columns: ColumnRefs<T> & RelationRefs<C>) => UpdateValues<T>>(
  callback: F,
): MutationQuery<InitialMutationState<T, C, Rows, OperandUses<ReturnType<F>[keyof ReturnType<F>]>>>
update(set: UpdateSet<T, C>): MutationQuery<InitialMutationState<T, C, Rows>>

// An overload that infers the values of the callback
update<V extends UpdateValues<T>>(
  callback: (columns: ColumnRefs<T> & RelationRefs<C>) => V,
): MutationQuery<InitialMutationState<T, C, Rows, OperandUses<V[keyof V]>>>
```

- One signature that infers the values of a callback takes about 10% more instantiations for a callback and 1% for an object ([benchmark](../../benchmarks/types/queries.bench.ts)), and a variable of `UpdateSet` could not be passed to a signature of a callback and one of an object.
- The overload infers the callback rather than its values, so that the constraint of the callback types its body by the columns of the table: with a type parameter of the values, the body of the callback sees no specific table, which widens a literal of a column, such as of an enum, and a callback keeps that type for every overload.
- A conditional type of a callback that infers its values, as `where` takes its filter ([decision](../expressions/where-filter-type.md)), takes about 5% to 15% more instantiations for each form of `update` ([benchmark](../../benchmarks/types/queries.bench.ts)).
