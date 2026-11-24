# `NULL` decoded to a value by a nullable type

A nullable type returns `null` for `NULL`, which an application that has no `null` converts in every row, and which a `jsonb` column does not tell from a JSON `null` value.
`nullableAs` creates a nullable type from a function that returns the value that a result has for `NULL` instead:

```ts
const job = defineTable("job", {
  id: t.uuid.primaryKey().hasDefault(),
  payload: t.jsonb.nullableAs(() => undefined), // undefined for NULL, null for a JSON null value
})

// kern-db, which has no expressions
const note = text.nullableAs(() => undefined) // string | undefined
```

It changes only what a result returns: the type accepts `null`, which a query passes as `NULL`, as every nullable type does, so that inserts, updates, object conditions, `isNull`, and `coalesce` stay as they are.
The function is the member `decodeNull` of the contract of a type, which every place that decodes a value calls for `NULL` alone.
The values that such a type returns do not tell in types what its `NULL` decodes to, so its `transform`, `of`, `nullable`, and `nullableAs` reject when they are called, and `nullableAs` is the last change of the values of a type.

The types of expressions of the ORM tell `NULL` by `null` among the values, so `nullableAs` of a type of the ORM applies only when its values include `null` beside that of `NULL`, such as the `unknown` values of `json` and `jsonb` without a shape, and types reject another type, such as `text`.
`nullableAs` of a type of `kern-db`, which has no expressions, applies whatever its values.

It changed 4 of the 106 counts of the [type benchmarks](../../benchmarks/types/): a query of SQL text of fields of types from 65 to 69 instantiations, the first unbound query from 2632 to 2648, the first query of a deep relation graph from 7223 to 7239, and a chain of `nullable`, `transform`, and `with` from 150 to 145.

The alternatives:

- A value that the type maps to `NULL` both ways, so that a query also passes it as `NULL`, and `null` is a value of the type like any other, such as a JSON `null` value of `jsonb`.
  The values that a type returns are then the values that it accepts, and a record that a query returns writes back the same row.
  But an insert omits `undefined`, an update keeps its column, and a parameter rejects it, so that a missing value does not turn into SQL silently, and `undefined` is the value that applications want for `NULL`; and `null` that a query passes is `NULL` wherever types read [nullability from the accepted values](nullability-of-accepted-values.md), which would need nullability apart from the values in types and expressions, whose prototype added up to 14% to the instantiations of queries in expressions.
  The [backlog](../../backlog/passing-a-value-as-null.md) keeps it.
- `encodeNull` beside `decodeNull`, the text that the type passes for `null` instead of `NULL`, such as `"null"` of `jsonb`, would write a JSON `null` value as `null`.
  It is the same change of what `null` means in a query, for one type: `where({ payload: null })` would have to compare with the value, `null` among the accepted values would no longer make a column nullable, and no plain value would pass `NULL` to an update.
  A `sql` fragment writes a JSON `null` value instead.
- An option of `nullable`, such as `nullable({ decodeNull: () => undefined })`, would keep one method that makes a type nullable.
  But it would be an overload, which TypeScript reads by its last signature alone in `ReturnType<typeof t.text.nullable>` and in the inferred result of `options.map(t.text.nullable)`.
  With the option last, `ReturnType<typeof t.text.nullable>` is the type that `nullable` returns with the option; with it first, the result of `options.map(t.text.nullable)` is typed as of `nullable()` while it decodes `NULL` to a value, past the check of the values of a type of the ORM.
- The value itself, such as `nullableAs(undefined)`, is shorter.
  But one object, such as an array, would be shared by every row, and `nullableAs()` without a value would read `NULL` as `undefined`.
- A method named as the member of the contract that it sets, `decodeNull(() => undefined)` after `nullable()`, would read as `transform` does.
  But the type would not be nullable without `nullable` before it.
- An option of `transform`, beside `decode`, would keep the conversions of a type in one place.
  But `transform` requires a decoder of the other values, and a later `transform`, which types as returning `null` for `NULL`, would have to drop it.
- A type parameter of `Type` for what `NULL` decodes to would let `of` and `transform` follow it in types, in any order.
  It would cost instantiations for every type that user code derives, for the order of two calls.
- Applying `nullableAs` to every type of the ORM, with its exact values, such as `string | undefined` of `text`, would give an application that has no `null` its columns as `undefined`.
  But the result of an operator of another type, such as `hint.eq("a")` or `hint.length()`, would be typed without `null` although it is `null` for `NULL`, and `coalesce(hint, "")` would keep `undefined`; typing both needs nullability apart from the values, which the backlog keeps.
- Keeping `null` among the values of every such type in types, such as `string | null | undefined`, would type the expressions without a restriction.
  But the code of an application would still handle a `null` that a result never has, which is what the method removes.
- An attribute of a column rather than of its type would leave the types of expressions as they are.
  But the columns of a record of SQL text and a field of an expression have only a type, so a record would read `NULL` differently by how a query selects the column.

Orchid ORM has it as `parseNull` of a column, which changes what a result returns, but on node-postgres also for a JSON `null` value of `jsonb`, which the driver parses to `null` before it ([comparison](../../comparison/schemas.md#null-read-as-another-value)).
