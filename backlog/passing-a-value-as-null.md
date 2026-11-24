# Passing a value as `NULL`

A type that maps `NULL` and a value both ways: a type of [`nullableAs`](../architecture/types.md#values-of-null) returns a value for `NULL`, such as `undefined`, and a query still passes `NULL` as `null`, so it cannot pass back the value that a result has, and `jsonb` cannot take a JSON `null` value as `null`.
The same applies to a type that decodes a value to `null`, such as `""` of a `varchar` column that is not nullable.
`jsonWithJsonNull` and `jsonbWithJsonNull` tell a JSON `null` value from `NULL` both ways, also with a shape, by the marker `jsonNull` ([types](../architecture/types.md)); this item would add `null` as the JSON `null` value itself, with another value for `NULL`.

- Preliminary decision: the type maps `NULL` and the value both ways: a query passes the value as `NULL`, and an object condition of the value is `IS NULL`, while `null` is a value of the type like any other, such as a JSON `null` value of `jsonb`.
  - An insert omits `undefined` and an update keeps it, so a query cannot pass `undefined` as `NULL`: decide what passes `NULL` for a type that decodes it to `undefined`, such as a constant of `NULL` or `null` as in Orchid ORM, which a JSON `null` value then cannot take.
  - Queries take the values of a type, unlike those of Orchid ORM, which take the database values, so decide what `isNull` means for such a type, and what `coalesce` and aggregates give for it.
- It needs nullability apart from the values in types and expressions, which a prototype measured, as [the decision of nullability](../decisions/types/nullability-of-accepted-values.md) records with its pitfalls; measure again with these conversions before choosing a design.
  - It would let `nullableAs` apply to a type of the ORM whose values have no `null`, such as `text` read as `string | undefined` for an application that has no `null`, or `jsonb` with a shape of `of`: types reject it, since the result of an operator of such an expression, such as `eq`, would have no `null` in types.
  - It would let `of` and `transform` apply after `nullableAs`, which rejects them.
