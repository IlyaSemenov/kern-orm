# Nullability read from the accepted values

A type is nullable when it accepts `null`, which a query always passes as `NULL`, so `primaryKey`, the keys of a table, `of`, and `transform` read nullability from the values that a type accepts rather than from those that it returns.
It adds no instantiations to any of the [type benchmarks](../../benchmarks/types/).
The values of `json` and `jsonb` are `unknown`, which includes a JSON `null` value, and they accept `{}`:

```ts
const event = defineTable("event", {
  payload: t.jsonb, // returns unknown, accepts {}
  extra: t.jsonb.nullable().of<{ source: string }>(), // { source: string } | null
})
```

`null` among the values that a type returns still stands for `NULL` where an expression reads it, such as in `coalesce` and in the results of operators.
Expressions of `unknown` values are therefore taken for ones that may be `NULL`:

```ts
await db.event.take().select(event => ({
  isEmpty: event.payload.eq({}), // boolean | null, though the column is not nullable
}))
```

A shape of `of` has no `null`, so a comparison of a column of a shape that is not nullable with a value is `boolean`.

The alternatives:

- The values of `json` and `jsonb` as `{}`, which leaves `null` out, so that `nullable` adds it and `of` keeps it from the values that a type returns.
  Expressions of a JSON column that is not nullable are then never `NULL` in types, but a JSON `null` value read from such a column, such as one that another program wrote, has the type `{}`.

- Nullability apart from the values of a type, as a part of types and expressions of what their `NULL` is, which operators, functions, aggregates, and queries in expressions carry.
  It types expressions of JSON values exactly, and it would let a type decode `NULL` to a value, such as `false`, and pass a value as `NULL`, as [`parseNull`](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/common-column-methods.md#parsenull) of Orchid ORM decodes it by the type of the database value, which Orchid ORM keeps apart from the decoded one.
  A prototype without these conversions, without object conditions, `matches`, the values of groups, and `in` of a query, added 1.5% to the instantiations of all the [type benchmarks](../../benchmarks/types/), 6.1% to the first unbound query, and 7–14% to queries in expressions, such as 13.6% to an update of an aggregate of a relation and 8.5% to a filter of a value of a query.
  - The part of a type is invariant, so `never` of a type that is not nullable rejects `any` of `AnyType`, and a type needs a mark instead.
  - A function that takes a type of any nullability, such as `caseWhen`, must infer the part, or TypeScript compares the types by their members, which added 155% to a case of two branches.
  - The signature of a generic operator reads the part from `this`, and `BooleanResult` reads it instead of the values, which changes the custom operators of users.
