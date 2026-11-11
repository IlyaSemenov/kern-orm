# Decoding `NULL` to a value

A type that decodes `NULL` to a value, such as `false`, or `undefined` that tells it from a JSON `null` value, like [`parseNull`](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/common-column-methods.md#parsenull) of Orchid ORM 1.78, and passes the value as `NULL`, or that decodes a value to `null`, such as `""` of a `varchar` column that is not nullable.

- Replace the recipe of [JSON `null` values](../docs/orm/types.md#json-null-values), a sentinel of a JSON `null` value and `map`, with native support, and remove the recipe: projects need to read `NULL` of a `jsonb` column as `undefined` and a JSON `null` value as `null`.
- Preliminary decision: the type maps `NULL` and the value both ways: a result decodes `NULL` to the value, a query passes the value as `NULL`, and an object condition of the value is `IS NULL`, while `null` is a value of the type like any other, such as a JSON `null` value of `jsonb`.
  - An insert omits `undefined` and an update keeps it, so a query cannot pass `undefined` as `NULL`: decide what passes `NULL` for a type that decodes it to `undefined`, such as `null` as in Orchid ORM, which a JSON `null` value then cannot take.
  - Queries take the values of a type, unlike those of Orchid ORM, which take the database values, so decide what `isNull` means for such a type, and what `coalesce` and aggregates give for it.
- It needs nullability apart from the values in types and expressions, which a prototype measured, as [the decision of nullability](../decisions/types/nullability-of-accepted-values.md) records with its pitfalls; measure again with these conversions before choosing a design.
