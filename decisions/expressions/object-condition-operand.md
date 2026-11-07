# Operand of an object condition read from the column type

An object condition reads the operand of the `eq` of `equalityOperators` from the type of its column, such as the operand of `published` in `db.form.where({ published: true })`:

```ts
type EqValue<T extends AnyTable, K extends keyof T["columns"]> =
  ColumnOperators<T, K> extends { readonly eq: EqualityOperator<ComparisonSignature> }
    ? Operand<TypeOutput<T["columns"][K]["type"]>, TypeInput<T["columns"][K]["type"]>>
    : EqOperand<ColumnRefs<T>[K]>

type EqOperand<E> = E extends { eq: (value: infer V) => Predicate } ? V : never
```

- Inferring it from the method of the column with a check that its result is a predicate, as `EqOperand` does for another `eq`, adds about 165 instantiations, 42%, to a query of an object condition of a column used for the first time ([benchmark](../../benchmarks/types/queries.bench.ts)).
