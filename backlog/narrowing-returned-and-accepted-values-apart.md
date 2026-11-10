# Narrowing returned and accepted values apart

`of<T>()` narrows the values that a type returns and accepts to the same `T`, so a type that accepts more values than it returns loses them, such as the `Date` that `timestamptz` accepts beside its strings.
Orchid ORM 1.78.47 narrows the input, output, and query types of a column apart with `narrowAllTypes` ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/common-column-methods.md#narrowalltypes)).
