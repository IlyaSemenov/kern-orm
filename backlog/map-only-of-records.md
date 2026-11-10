# `map` only of records

`map` converts the records of a query, but also applies to a query of values, such as of `get`, `pluck`, or an aggregate method, where it has no records to convert; it should reject a query of one value, whose value `transform` converts.

- Decide whether it rejects a query of `pluck` too.
