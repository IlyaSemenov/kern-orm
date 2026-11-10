# Arithmetic operators

Operators of numeric expressions, such as `+` and `-`, and the increment of a column, such as of the number of comments of a record, which an update writes as ``sql(t.integer)`${record.commentsCount} + 1` ``, as `increment` and `decrement` of Orchid ORM 1.78.47 ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/update.md#increment)).

- They are a capability of numeric types, which [aggregates by the type of their argument](aggregates-by-the-type-of-their-argument.md) would read too.
- Decide the type of the result of operands of different types, such as `integer` and `bigint`, and of dates and intervals.
- They add to the operators of every numeric column reference, so measure their cost with `bench:types`.
