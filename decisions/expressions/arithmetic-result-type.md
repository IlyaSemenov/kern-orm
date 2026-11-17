# Result of arithmetic of the type of the expression

The result of `add`, `sub`, `mul`, `div`, and `mod` has the type of the expression the operator is called on, and the operand takes the values of that type.

```ts
// Chosen: the type of `visits`, with an operand of its values
visits.add(1)
// A `bigint` operand beside an `integer` requires `sql`
sql(t.bigint)`${visits} + ${total}`

// Alternative: a result read from the types of both operands
visits.add(total) // an expression of `bigint`
```

- A result read from both operands follows PostgreSQL for operands of different types, such as `bigint` for `integer` and `bigint`, and `numeric` for `integer` and `numeric`, so it takes an expression of another number type without `sql`.
  It requires a table of the result types of the pairs of the built-in types, and a custom type, such as one of `transform`, would have no entry, so its operators would need a table of their own; the operand of every call would instantiate a lookup of the pair.
- The chosen result needs no such table: it is the rule of the first operand of `coalesce`, and a type derived with `transform` keeps its representation in the result.
  The type of the expression reads the value in the common type, so a wider operand must be the expression, as for the first operand of a function.
- Kysely types the result of `eb('age', '+', 1)` by the reference on the left ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/expression/expression-builder.ts#L172-L190)).
