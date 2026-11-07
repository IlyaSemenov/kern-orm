# One signature of `in`

`in` has one signature of a union of a list and a query rather than overloads.
For a column of values `T` and inputs `I`:

```ts
// One signature
in<const L extends readonly Operand<T, I>[] | ValuesQuery<NonNullable<T> | null>>(
  list: L,
): Expression<...>

// Overloads
in<const L extends readonly Operand<T, I>[]>(list: L): Expression<...>
in<const L extends ValuesQuery<NonNullable<T> | null>>(list: L): Expression<...>
```

- An overload of a query after that of a list makes the error of a wrong list name the overload of the query, as TypeScript 7.1 reports:

  ```ts
  db.field.where(field => field.position.in(["1", "2"]))
  // One signature, at each item:
  //   Type 'string' is not assignable to type 'Operand<number, number>'.
  // Overloads:
  //   No overload matches this call.
  //     The last overload gave the following error.
  //       Type 'string[]' is missing the following properties from type 'ValuesQuery<number | null>': types, exists
  ```

- An overload of a query before that of a list adds about 8% to the instantiations of a filter of a list ([benchmark](../../benchmarks/types/queries.bench.ts)).
